import { getRoomSockets, removeSocketFromRoom } from "./roomManager.js";

// Room-scoped fan-out. Delivery is by room, not by user: a socket is in a
// blog's room only while it still wants that blog, so this reaches exactly the
// interested sockets and nothing else.
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
    } catch {
      removeSocketFromRoom(ws, topic);
    }
  }
}
