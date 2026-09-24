import BlogPost from "../db/models/BlogPost.js";
import Comment from "../db/models/Comment.js";

async function updateInteraction(req, res) {
  try {
    const { modelType, id, action } = req.params;
    const userId = req.userId;
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

    // Toggle atomically with mtomic operators: addToSet/pull are idempotent
    // and never touch __v, so even concurrent like plus love clicks cannot
    // throw a Mongoose VersionError.
    const others = ["likes", "unlikes", "loves"].filter(
      (type) => type !== interactionType,
    );

    const already = await model.exists({
      _id: id,
      [interactionType]: userId,
    });

    const doc = await model.findOneAndUpdate(
      { _id: id },
      already
        ? { $pull: { [interactionType]: userId } }
        : {
            $addToSet: { [interactionType]: userId },
            $pull: {
              [others[0]]: userId,
              [others[1]]: userId,
            },
          },
      { new: true },
    );

    if (!doc) {
      return res.status(404).json({ error: `${modelType} not found` });
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
