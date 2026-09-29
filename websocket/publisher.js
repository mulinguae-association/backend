import { getAllClients, getClients, removeClient } from "./clientManager.js";
import { getRoomSockets, removeSocketFromRoom } from "./roomManager.js";

export function sendToUser(userId, event, data) {
  const clients = getClients(userId);
  console.log("Sending WebSocket event", {
    userId,
    connectedSocketsForUser: clients.size,
    sockets: [...clients].map((ws) => ({
      readyState: ws.readyState,
    })),
  });
  const message = JSON.stringify({
    event,
    data,
  });

  //   console.log(
  //     `[ws] publish "${event}" to ${userId}: ${clients.size} socket(s)`,
  //   );

  for (const ws of [...clients]) {
    if (ws.readyState !== ws.OPEN) {
      removeClient(userId, ws);
      continue;
    }

    try {
      ws.send(message);
    } catch (error) {
      removeClient(userId, ws);
    }
  }
}

export function broadcastToRoom(topic, event, data) {
  const members = getRoomSockets(topic);
  if (members.size === 0) return;
  const message = JSON.stringify({
    event,
    data,
  });

  for (const ws of [...members]) {
    if (ws.readyState !== ws.OPEN) {
      removeSocketFromRoom(ws, topic);
      continue;
    }

    try {
      ws.send(message);
    } catch (error) {
      removeSocketFromRoom(ws, topic);
    }
  }
}

export function broadcastExcept(excludedUserId, event, data) {
  const message = JSON.stringify({
    event,
    data,
  });

  for (const [userId, clients] of getAllClients()) {
    // if (userId === excludedUserId) continue;

    for (const ws of clients) {
      if (ws.readyState === ws.OPEN) {
        try {
          ws.send(message);
        } catch (error) {
          removeClient(userId, ws);
        }
      }
    }
  }
}
