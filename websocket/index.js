import { WebSocketServer } from "ws";
import authenticateUpgrade from "./authenticate.js";
import { connectToDatabase } from "../db/db.js";
import { addClient, removeClient } from "./clientManager.js";
import {
  blogRoomTopic,
  isRoomMember,
  joinRooms,
  pruneSocket,
} from "./roomManager.js";
import { commentTyping } from "./comments/events.js";
import { wsLog, wsWarn } from "./log.js";
const UNAUTHORIZED_CODE = 1008; // policy violation: unauthenticated

// A subscribe frame is the client's whole topic list, ~30 bytes per blog, so
// 64 KB is orders of magnitude above any real feed. ws defaults to 100 MiB,
// which let a client push a very large frame on every connection.
const MAX_FRAME_BYTES = 64 * 1024;
// Frames buffered while the auth lookup is in flight. A well-behaved client
// sends one subscribe frame on open, so a handful is generous; this bounds what
// an unauthenticated socket can make the server hold before it is refused.
const MAX_PENDING_FRAMES = 8;
const TOO_MANY_PENDING_CODE = 1008;

// A keystroke arrives per character, so an unthrottled client would fan one
// "typing" notification out to every reader in the room several times a second.
// The client already throttles well below this; the server limit is what makes
// that a guarantee rather than a convention, because it also bounds a hostile or
// a stuck client. Frames inside the window are dropped silently - the next one
// outside it carries the same information.
const TYPING_MIN_INTERVAL_MS = 400;

// "X is typing on blog Y" is only true for a socket that is actually reading that
// blog, so the room has to be one it is already a member of. Without this check
// the frame is an open relay: any authenticated client could drive the indicator
// on any post, including ones it cannot see, and every reader there would be told
// someone is typing.
function handleTyping(ws, message) {
  const topic = blogRoomTopic(
    typeof message.blogId === "string" ? message.blogId : "",
  );
  if (!topic || !isRoomMember(ws, topic)) return;

  const now = Date.now();
  if (ws.lastTypingAt && now - ws.lastTypingAt < TYPING_MIN_INTERVAL_MS) return;
  ws.lastTypingAt = now;

  // The identity comes from the socket, never from the frame, so a client cannot
  // announce a typing user other than itself. The id is passed through
  // un-normalized on purpose: commentTyping resolves it the same way the room
  // lookup above did, so there is no second code path that could disagree.
  commentTyping(ws, message.blogId, ws.user);
}

export function setupWebSocket(server) {
  const wss = new WebSocketServer({ server, maxPayload: MAX_FRAME_BYTES });

  wss.on("connection", (ws, req) => {
    // Only subscription and typing frames are acted on. Subscription advertises
    // the client's full desired topic set, so the server just reconciles room
    // membership from it; typing is an ephemeral signal about one of those rooms.
    const handleMessage = (raw) => {
      let message;
      try {
        message = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (!message || typeof message.op !== "string") return;

      if (message.op === "typing") {
        handleTyping(ws, message);
        return;
      }

      if (message.op !== "subscribe" || !Array.isArray(message.topics)) return;
      const dropped = joinRooms(ws, message.topics);
      if (dropped > 0) {
        wsWarn(
          `WebSocket topic cap hit, dropped ${dropped} topic(s) for user ${String(ws.userId)}`,
        );
      }
    };

    // Attach before auth resolves so frames sent on open are not dropped;
    // queue any that land while authentication is still in progress. Bounded,
    // because this socket is not yet known to be legitimate.
    const pending = [];
    ws.on("message", (message) => {
      if (!ws.user) {
        if (pending.length >= MAX_PENDING_FRAMES) {
          ws.close(TOO_MANY_PENDING_CODE, "Too many frames before auth");
          return;
        }
        pending.push(message);
      } else {
        handleMessage(message);
      }
    });

    (async () => {
      let user;

      try {
        await connectToDatabase();
        user = await authenticateUpgrade(req);
      } catch (error) {
        console.error("WebSocket authentication failed:", error);
        ws.close(1011, "Internal error");
        return;
      }

      if (!user) {
        wsLog(
          `WebSocket connection refused for origin "${req.headers?.origin || "unknown"}" (no valid token)`,
        );
        ws.close(UNAUTHORIZED_CODE, "Unauthorized");
        return;
      }

      if (ws.readyState !== ws.OPEN) return;

      ws.userId = String(user._id);
      ws.user = user;
      ws.userRole = user.role;
      addClient(ws.userId, ws);

      wsLog(`WebSocket client connected ${ws.userId}`);

      pending.splice(0).forEach(handleMessage);
    })();

    ws.on("close", () => {
      if (ws.userId) {
        removeClient(ws.userId, ws);
        wsLog(`WebSocket client disconnected ${ws.userId}`);
      }
      pruneSocket(ws);
    });

    // ws emits this when a peer exceeds maxPayload; without a listener the
    // error is an unhandled 'error' event and takes the process down.
    ws.on("error", (error) => {
      console.error("WebSocket socket error:", error);
    });
  });

  return wss;
}
