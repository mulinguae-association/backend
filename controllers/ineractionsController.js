import mongoose from "mongoose";
import BlogPost from "../db/models/BlogPost.js";
import Comment from "../db/models/Comment.js";
import { commentInteractionUpdated } from "../websocket/comments/events.js";

// The bucket toggle is decided against the document as it stands at the moment
// of the write, and the user is dropped from the other two buckets in that same
// update, so a reaction can never end up in more than one of them.
const toggleBucket = (field, userId) => {
  const current = { $ifNull: [`$${field}`, []] };
  return {
    $cond: [
      { $in: [userId, current] },
      { $filter: { input: current, cond: { $ne: ["$$this", userId] } } },
      { $concatArrays: [current, [userId]] },
    ],
  };
};

const dropFromBucket = (field, userId) => ({
  $filter: {
    input: { $ifNull: [`$${field}`, []] },
    cond: { $ne: ["$$this", userId] },
  },
});

async function updateInteraction(req, res) {
  try {
    const { modelType, id, action } = req.params;
    // Buckets are ObjectId-typed and a pipeline update is not cast by Mongoose.
    const userId = new mongoose.Types.ObjectId(String(req.userId));
    let model;

    if (modelType === "comment") {
      model = Comment;
    } else if (modelType === "blog") {
      model = BlogPost;
    } else {
      return res.status(400).json({ error: "Invalid model type" });
    }

    const interactionType =
      action === "like"
        ? "likes"
        : action === "unlike"
          ? "unlikes"
          : action === "love"
            ? "loves"
            : "";

    if (!interactionType) {
      return res.status(400).json({ error: "Invalid action" });
    }

    // A tombstone has cleared its reactions, so a like landing on one would put
    // the user back in a bucket that no longer exists and resurrect state that
    // was deliberately discarded. The UI hides the controls entirely, so this
    // only has to stop a crafted or stale request. BlogPost has no tombstone
    // concept, so the guard is scoped to comments.
    const filter =
      modelType === "comment" ? { _id: id, status: { $ne: "deleted" } } : { _id: id };

    const others = ["likes", "unlikes", "loves"].filter(
      (type) => type !== interactionType,
    );

    // One atomic write. $addToSet and $pull are each atomic, but choosing
    // between them needs a read first, so two opposing clicks can interleave
    // between that read and the write. A pipeline update is evaluated against
    // the committed document, so the later write sees the earlier one's result
    // and clears the buckets it no longer needs. It leaves __v alone, so no
    // VersionError under concurrency either.
    const doc = await model.findOneAndUpdate(
      filter,
      [
        {
          $set: {
            [interactionType]: toggleBucket(interactionType, userId),
            [others[0]]: dropFromBucket(others[0], userId),
            [others[1]]: dropFromBucket(others[1], userId),
          },
        },
      ],
      { new: true },
    );

    if (!doc) {
      return res.status(404).json({ error: `${modelType} not found` });
    }

    // Mongo is authoritative; the room only tells the readers who were not the
    // one clicking. A blog post has no room of its own - it lives in whichever
    // blog's feed it appears in - so only a comment is broadcast, and it is
    // published from the stored blogId rather than the request, which carries
    // none. The acting tab receives this too and writes the same values twice.
    if (modelType === "comment") {
      commentInteractionUpdated(doc.blogId, {
        commentId: doc._id,
        likes: doc.likes || [],
        loves: doc.loves || [],
        unlikes: doc.unlikes || [],
      });
    }

    res.status(200).json({
      message: `${interactionType} status updated`,
      likes: doc.likes || [],
      loves: doc.loves || [],
      unlikes: doc.unlikes || [],
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "An error occurred" });
  }
}
export default updateInteraction;
