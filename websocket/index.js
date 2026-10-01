import { WebSocketServer } from "ws";
import authenticateUpgrade from "./authenticate.js";
import { connectToDatabase } from "../db/db.js";
import { addClient, removeClient } from "./clientManager.js";
import { joinRooms, pruneSocket } from "./roomManager.js";
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

export function setupWebSocket(server) {
  const wss = new WebSocketServer({ server, maxPayload: MAX_FRAME_BYTES });

  wss.on("connection", (ws, req) => {
    // Only subscription frames are acted on; the client advertises its full
    // desired topic set, so the server just reconciles membership from it.
    const handleMessage = (raw) => {
      let message;
      try {
        message = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (message?.op !== "subscribe" || !Array.isArray(message.topics)) return;
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
