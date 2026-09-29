// Server-side rooms for scoped realtime delivery. A socket joins the room of
// every blog it is currently interested in; events fan out to room members
// only, so uninterested sockets receive nothing on the wire.
const rooms = new Map();

const TOPIC_PREFIX = "blog:";
const OBJECT_ID = /^[0-9a-fA-F]{24}$/;

// Canonical room topic for a blog id. Both sides of the room handshake (the
// client subscription and the server broadcast) must key the room identically,
// so broadcasts go through this same parser rather than the raw body string.
export function blogRoomTopic(id) {
  if (typeof id !== "string" || !OBJECT_ID.test(id)) return null;
  return `${TOPIC_PREFIX}${id.toLowerCase()}`;
}

function parseTopic(topic) {
  if (typeof topic !== "string" || !topic.startsWith(TOPIC_PREFIX)) return null;
  return blogRoomTopic(topic.slice(TOPIC_PREFIX.length));
}

function addToRoom(ws, topic) {
  const members = rooms.get(topic);
  if (members) members.add(ws);
  else rooms.set(topic, new Set([ws]));
}

function removeFromRoom(ws, topic) {
  const members = rooms.get(topic);
  if (!members) return;
  members.delete(ws);
  if (members.size === 0) rooms.delete(topic);
}

// Reconcile a socket's room membership to the requested topic set. The client
// sends its full desired set, so this is idempotent and race-free.
export function joinRooms(ws, topics) {
  const next = new Set();
  for (const topic of topics) {
    const parsed = parseTopic(topic);
    if (parsed) next.add(parsed);
  }
  const current = ws.topics || new Set();
  for (const topic of current) {
    if (!next.has(topic)) removeFromRoom(ws, topic);
  }
  for (const topic of next) {
    if (!current.has(topic)) addToRoom(ws, topic);
  }
  ws.topics = next;
}

// Drop a socket from every room it belongs to (used on disconnect).
export function pruneSocket(ws) {
  const topics = ws.topics;
  if (!topics) return;
  for (const topic of topics) removeFromRoom(ws, topic);
  ws.topics = new Set();
}

export function getRoomSockets(topic) {
  return rooms.get(topic) || new Set();
}

export function removeSocketFromRoom(ws, topic) {
  removeFromRoom(ws, topic);
}
