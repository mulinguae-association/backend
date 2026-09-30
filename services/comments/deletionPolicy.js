// Deletion policy, free of I/O so the controller and the tests agree.
import { isAdminRole } from "../../utils/isAdminRole.js";

// Single-row: a leaf is deleted, a comment with replies becomes a tombstone so
// those replies keep a parent.
export const LIVE_COMMENT_STATUS = "accepted";
export const DELETED_COMMENT_STATUS = "deleted";

// Rendered from, but not counted as.
export const LISTABLE_COMMENT_STATUSES = [LIVE_COMMENT_STATUS, DELETED_COMMENT_STATUS];

export const DELETION_MODE = {
  REMOVED: "removed",
  TOMBSTONED: "tombstoned",
};

// Recorded because both removals look identical once the text is gone.
export const DELETION_ACTOR = {
  AUTHOR: "author",
  ADMIN: "admin",
};

// Role, not authorship: an admin deleting their own comment still acted as one.
export const resolveDeletionActor = ({ actorRole } = {}) =>
  isAdminRole(actorRole) ? DELETION_ACTOR.ADMIN : DELETION_ACTOR.AUTHOR;

export const isTombstone = (comment) => comment?.status === DELETED_COMMENT_STATUS;

// A tombstoned child keeps the count above zero, so repliesCount alone answers
// "is this a leaf" without a second query.
export const resolveDeletionMode = ({ repliesCount } = {}) =>
  (repliesCount ?? 0) > 0
    ? DELETION_MODE.TOMBSTONED
    : DELETION_MODE.REMOVED;

// Text, author and reactions are cleared, not flagged. Only the avatar is kept,
// so the row holds a comment's space in the thread without naming anyone.
export const buildTombstoneUpdate = (
  now = new Date(),
  { deletedAuthorAvatar = null, deletedBy = null } = {},
) => ({
  $set: {
    status: DELETED_COMMENT_STATUS,
    deletedAt: now,
    updatedAt: now,
    content: "",
    postedBy: null,
    deletedAuthorAvatar: deletedAuthorAvatar ?? null,
    deletedBy: deletedBy ?? null,
    likes: [],
    unlikes: [],
    loves: [],
  },
});

// removedParents is set only for a removed reply - the one case where a
// surviving parent loses a row it was counting.
export const buildDeletionEvent = ({
  commentId,
  parentCommentId = null,
  mode,
  tombstone = null,
  removedAt = new Date(),
}) => {
  const id = String(commentId);
  return {
    commentId: id,
    mode,
    removedIds: [id],
    removedParents:
      mode === DELETION_MODE.REMOVED && parentCommentId
        ? [{ id, parentCommentId: String(parentCommentId) }]
        : [],
    tombstone,
    removedAt,
  };
};
