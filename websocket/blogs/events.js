// Blog realtime contract, mirroring websocket/comments/events.js: every producer
// builds its payload here and every consumer keys off the same event names, so
// the wire shape is described once.
//
// An existing post publishes to its own room, `blog:<id>`. A post appearing in
// several feeds is not a reason for a feed-specific room - the room is keyed by
// the post itself, so one event reaches every reader displaying it however they
// reached it.
import { idOf, publish, publishToFeed } from "../publisher.js";

export const BLOG_EVENT = {
  CREATED: "blog.created",
  UPDATED: "blog.updated",
  DELETED: "blog.deleted",
  INTERACTION_UPDATED: "blog.interactionUpdated",
};

// The public feed, so subscribers see a new post without refetching the page.
// Carries the same projection the read API returns: the author's summary is
// already populated, because a payload without it would land in a client's cache
// as a post with no name or avatar, which no list entry ever looks like.
export const blogCreated = (blogPost) =>
  publishToFeed(BLOG_EVENT.CREATED, { blog: blogPost?.toObject?.() ?? blogPost });

// The whole post rather than the changed fields: an edit can be raced by
// moderation, and a partial patch would leave a client holding content the
// server never accepted.
export const blogUpdated = (blogId, blogPost) =>
  publish(blogId, BLOG_EVENT.UPDATED, {
    blog: blogPost?.toObject?.() ?? blogPost,
  });

// Just the id. The row is gone, so there is nothing left to describe, and the
// server has already decided what a reader loses with it.
export const blogDeleted = (blogId) =>
  publish(blogId, BLOG_EVENT.DELETED, { blogId: idOf(blogId) });

// One event for all three reactions, like the comment side: the buckets are the
// whole state, and splitting it per action would make a client reassemble a
// toggle it can read directly.
export const blogInteractionUpdated = (blogId, event = {}) =>
  publish(blogId, BLOG_EVENT.INTERACTION_UPDATED, {
    likes: (event.likes || []).map(idOf).filter(Boolean),
    loves: (event.loves || []).map(idOf).filter(Boolean),
    unlikes: (event.unlikes || []).map(idOf).filter(Boolean),
  });
