// Comment realtime contract: every producer builds its payload here and every
// consumer keys off the same event names, so the wire shape is described once.
// Delivery stays room-scoped: a socket is in a blog's room only while it wants
// that blog, so an edit or delete reaches exactly the readers displaying it.
import { broadcastToRoom } from "../publisher.js";
import { blogRoomTopic } from "../roomManager.js";

export const COMMENT_EVENT = {
  CREATED: "comment.created",
  UPDATED: "comment.updated",
  DELETED: "comment.deleted",
  INTERACTION_UPDATED: "comment.interactionUpdated",
};

// Normalizes whatever a caller holds into the id string a room is keyed by. A
// Mongoose ObjectId carries neither _id nor id, so a naive check discards it -
// and that silently dropped every update and delete, since those publish from
// `comment.blogId` (an ObjectId) while create publishes from a route param.
const idOf = (value) => {
  if (!value) return null;
  if (typeof value === "string") return value;
  if (value._id) return String(value._id);
  if (value.id) return String(value.id);
  const text = String(value);
  return text === "[object Object]" ? null : text;
};

// False when the blog cannot be addressed, so a caller never believes it
// published when it did not.
function publish(blogId, event, data) {
  // Derived from the normalized id, never the raw argument, so a caller cannot
  // address a room other than the one its payload names.
  const room = blogRoomTopic(idOf(blogId));
  if (!room) return false;
  broadcastToRoom(room, event, { blogId: idOf(blogId), ...data });
  return true;
}

// A comment in the read API's shape, so a client can cache it directly.
// Accepts a plain object too: toObject() only exists on a document, and a
// tombstone is built by merging over one.
export function toCommentPayload(comment, author) {
  const plain =
    typeof comment?.toObject === "function" ? comment.toObject() : comment;
  return {
    ...plain,
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

// A root comment or a reply. Clients route on this: a reply goes into its
// parent's replies cache and bumps repliesCount, a root into the thread list.
export const commentCreated = (blogId, comment) =>
  publish(blogId, COMMENT_EVENT.CREATED, { comment });

// Carries the whole comment, not just the changed text: an edit can be raced by
// moderation, and a partial patch would leave a client holding a body the server
// never accepted.
export const commentUpdated = (blogId, comment) =>
  publish(blogId, COMMENT_EVENT.UPDATED, { comment });

// `mode` says what the server actually did, because the cases look nothing alike:
//   "removed"    the row is gone, and it had no replies.
//   "tombstoned" the row survives with its content cleared, so a client replaces
//                the entry with `tombstone` and must NOT decrement the parent's
//                repliesCount - a tombstoned reply is still listed.
//
// `tombstone` is the canonical row in the read API's shape, carrying the computed
// repliesCount explicitly: without it the client's reply control would drop to
// zero and hide the very replies the tombstone exists to preserve.
//
// `removedParents` names a surviving parent that lost a row it was counting -
// only ever a removed reply.
//
// The whole contract carries `blogId`, and a tombstone keeps _id, blogId and
// parentComment, so a deep link survives. Navigate to the blog and treat the
// comment ids as hints that may no longer resolve.
export const commentDeleted = (blogId, event = {}) =>
  publish(blogId, COMMENT_EVENT.DELETED, {
    commentId: idOf(event.commentId),
    mode: event.mode,
    removedIds: (event.removedIds || []).map(idOf).filter(Boolean),
    removedParents: (event.removedParents || []).map((entry) => ({
      id: idOf(entry?.id),
      parentCommentId: idOf(entry?.parentCommentId),
    })),
    tombstone: event.tombstone || null,
    removedAt: event.removedAt,
  });

export const commentInteractionUpdated = (blogId, event = {}) =>
  publish(blogId, COMMENT_EVENT.INTERACTION_UPDATED, {
    commentId: idOf(event.commentId),
    likes: (event.likes || []).map(idOf).filter(Boolean),
    loves: (event.loves || []).map(idOf).filter(Boolean),
    unlikes: (event.unlikes || []).map(idOf).filter(Boolean),
  });
