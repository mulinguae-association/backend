// The comment realtime contract, in one place.
//
// Every producer builds its payload here and every consumer keys off the same
// event names, so the wire shape is described once instead of being rediscovered
// from each broadcast call. A new event is a new builder plus a name here, not
// new transport: the socket, the room fan-out and the client subscription are
// already generic.
//
// Delivery stays room-scoped. A socket is in a blog's room only while it still
// wants that blog, so an edit or a delete reaches exactly the readers that
// display the comment and nobody else.
import { broadcastToRoom } from "./publisher.js";
import { blogRoomTopic } from "./roomManager.js";

export const COMMENT_EVENT = {
  CREATED: "comment.created",
  UPDATED: "comment.updated",
  DELETED: "comment.deleted",
};

// Normalizes whatever a caller happens to hold into the id string a room is
// keyed by. A Mongoose ObjectId is the trap here: it is not a string, and it
// carries neither _id nor id, so a naive check discards it. That silently
// dropped every update and delete on the floor, because those publish from
// `comment.blogId` (an ObjectId) while create publishes from a route param
// (a string). Stringifying an ObjectId yields the hex id, which is what
// blogRoomTopic expects.
const idOf = (value) => {
  if (!value) return null;
  if (typeof value === "string") return value;
  if (value._id) return String(value._id);
  if (value.id) return String(value.id);
  const text = String(value);
  return text === "[object Object]" ? null : text;
};

// Returns false when the blog cannot be addressed, so a caller never believes it
// published when it did not.
function publish(blogId, event, data) {
  const id = idOf(blogId);
  // The room is always derived from the normalized id, never from the raw
  // argument, so a caller cannot address a different room than the payload says.
  const room = blogRoomTopic(id);
  if (!room) return false;
  broadcastToRoom(room, event, { blogId: id, ...data });
  return true;
}

// A comment in the exact shape the read API returns, so a client can write it
// straight into a cache entry without reconciling fields.
export function toCommentPayload(comment, author) {
  return {
    ...comment.toObject(),
    postedBy: author
      ? {
          _id: author._id,
          name: author.name,
          profileImage: author.profileImage,
          role: author.role,
        }
      : undefined,
  };
}

// A root comment or a reply. Clients route on this: a reply is inserted into its
// parent's replies cache and bumps repliesCount, a root goes into the thread
// list and the feed preview.
export const commentCreated = (blogId, comment) =>
  publish(blogId, COMMENT_EVENT.CREATED, { comment });

// Carries the whole comment, not just the changed text: an edit can be raced by
// moderation, and a partial patch would leave a client holding a body the server
// never accepted.
export const commentUpdated = (blogId, comment) =>
  publish(blogId, COMMENT_EVENT.UPDATED, { comment });

// `removedIds` is the complete set the server removed, which is not the same as
// the set a client can see. Deleting a comment cascades to its whole subtree on
// the server, so a client that only pruned what it had loaded left descendants
// on screen that no longer exist. The full list lets every client converge on
// the server's answer without a refetch, and an id it never held is simply
// ignored.
//
// `removedParents` pairs each removed id with the parent it hung from, for the
// ids that were not themselves removed. Those are the only parents whose
// repliesCount has to drop; a parent inside `removedIds` disappears with its
// own entry, so its counter never has to be corrected.
export const commentDeleted = (
  blogId,
  { commentId, removedIds, removedParents = [], removedAt = new Date() },
) =>
  publish(blogId, COMMENT_EVENT.DELETED, {
    commentId: idOf(commentId),
    removedIds: (removedIds || []).map(idOf).filter(Boolean),
    removedParents,
    removedAt,
  });
