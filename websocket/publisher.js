import {
  getRoomSockets,
  removeSocketFromRoom,
  blogRoomTopic,
  acceptedFeedTopic,
} from "./roomManager.js";

// Normalizes whatever a caller holds into the id string a room is keyed by. A
// Mongoose ObjectId carries neither _id nor id, so a naive check discards it -
// and that silently dropped every update and delete, since those publish from
// `comment.blogId` (an ObjectId) while create publishes from a route param.
export const idOf = (value) => {
  if (!value) return null;
  if (typeof value === "string") return value;
  if (value._id) return String(value._id);
  if (value.id) return String(value.id);
  const text = String(value);
  return text === "[object Object]" ? null : text;
};

// Room-scoped fan-out. Delivery is by room, not by user: a socket is in a
// blog's room only while it still wants that blog, so this reaches exactly the
// interested sockets and nothing else.
//
// `except` omits one socket from the delivery - for an event about the sender's
// own action, where echoing it back would make the actor see themselves.
export function broadcastToRoom(topic, event, data, except = null) {
  const members = getRoomSockets(topic);
  if (members.size === 0) return;
  const message = JSON.stringify({
    event,
    data,
  });

  for (const ws of [...members]) {
    if (ws === except) continue;
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

// Publishes an event about one blog to everyone in that blog's room, tagging the
// payload with the id so a client can tell which blog the event concerns without
// parsing the topic. Returns false when the blog cannot be addressed, so a caller
// never believes it published when it did not.
export function publish(blogId, event, data) {
  const id = idOf(blogId);
  // Derived from the normalized id, never the raw argument, so a caller cannot
  // address a room other than the one its payload names.
  const room = blogRoomTopic(id);
  if (!room) return false;
  broadcastToRoom(room, event, { blogId: id, ...data });
  return true;
}

// The same, for an event about the sender's own action: delivered to the blog's
// room but never back to the socket that caused it. The sender already knows,
// and echoing it would make an actor appear in their own "someone is typing".
export function publishToOthers(ws, blogId, event, data) {
  const id = idOf(blogId);
  const room = blogRoomTopic(id);
  if (!room) return false;
  broadcastToRoom(room, event, { blogId: id, ...data }, ws);
  return true;
}

// The same, for a reader who has no blog id yet: only the discovery feed exists,
// so a new post is announced to everyone watching for posts rather than to a
// room keyed by an id nobody holds. The topic is a constant here, so unlike
// publish there is no addressing failure to report.
export function publishToFeed(event, data) {
  broadcastToRoom(acceptedFeedTopic(), event, data);
}
