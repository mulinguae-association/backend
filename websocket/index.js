import { WebSocketServer } from "ws";
import authenticateUpgrade from "./authenticate.js";
import { connectToDatabase } from "../db/db.js";
import { addClient, removeClient } from "./clientManager.js";
import { joinRooms, pruneSocket } from "./roomManager.js";
const UNAUTHORIZED_CODE = 1008; // policy violation: unauthenticated

export function setupWebSocket(server) {
  const wss = new WebSocketServer({ server });

  wss.on("connection", (ws, req) => {
    // Only subscription frames are acted on; the client advertises its full
    // desired topic set, so the server just reconciles membership from it.
    const handleMessage = (raw) => {
      console.log("the RAW: " + raw);
      let message;
      try {
        message = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (message?.op !== "subscribe" || !Array.isArray(message.topics)) return;
      console.log("the RAW: " + message);
      joinRooms(ws, message.topics);
    };

    // Attach before auth resolves so frames sent on open are not dropped;
    // queue any that land while authentication is still in progress.
    const pending = [];
    ws.on("message", (message) => {
      if (!ws.user) pending.push(message);
      else handleMessage(message);
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
        console.log(
          `WebSocket connection refused for origin "${req.headers?.origin || "unknown"}" (no valid token)`,
        );
        ws.close(UNAUTHORIZED_CODE, "Unauthorized");
        return;
      }

      if (ws.readyState !== ws.OPEN) return;
      console.log("Registering WebSocket", {
        userId: String(user._id),
        readyState: ws.readyState,
      });

      ws.userId = String(user._id);
      ws.user = user;
      ws.userRole = user.role;
      addClient(ws.userId, ws);

      console.log("WebSocket registered", {
        userId: ws.userId,
      });
      console.log(`WebSocket client connected ${ws.userId}`);

      pending.splice(0).forEach(handleMessage);
    })();

    ws.on("close", () => {
      console.log("WebSocket close", {
        userId: ws.userId,
        readyState: ws.readyState,
      });

      if (ws.userId) {
        removeClient(ws.userId, ws);
        console.log(`WebSocket client disconnected ${ws.userId}`);
      }
      pruneSocket(ws);
    });
  });

  return wss;
}
