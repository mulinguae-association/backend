// Server-side rooms for scoped realtime delivery. A socket joins the room of
// every blog it is currently interested in; events fan out to room members
// only, so uninterested sockets receive nothing on the wire.
const rooms = new Map();

const TOPIC_PREFIX = "blog:";
const OBJECT_ID = /^[0-9a-fA-F]{24}$/;

// Ceiling on how many blogs one socket may be in at once. A feed sends its full
// loaded set, and a page of ids is ~30 bytes each, so this is orders of
// magnitude above any real membership (a 100-post feed needs 100). It exists to
// stop one frame from creating an unbounded number of rooms: before the cap, a
// single client could open 5000 rooms and every later broadcast would walk them.
const MAX_TOPICS_PER_SOCKET = 500;

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
// sends its full desired set, so this is idempotent and race-free. The set is
// capped (see MAX_TOPICS_PER_SOCKET): an oversized frame is truncated rather
// than refused, so a client that legitimately grows past the cap still keeps its
// existing membership and the first MAX_TOPICS_PER_SOCKET blogs stay live.
// Returns the number of requested topics that were dropped, for the caller's log.
export function joinRooms(ws, topics) {
  const next = new Set();
  let dropped = 0;
  for (const topic of topics) {
    if (next.size >= MAX_TOPICS_PER_SOCKET) {
      dropped += 1;
      continue;
    }
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
  return dropped;
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
