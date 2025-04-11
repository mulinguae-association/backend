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

    const doc = await model.findById(id);

    if (!doc) {
      return res.status(404).json({ error: `${modelType} not found` });
    }

    // Create an array to hold the current interaction
    let interactionArray = [];
    let interactionType = '';

    // Determine the interaction array and type based on the action
    if (action === 'like') {
      interactionArray = ['likes'];
      interactionType = 'likes';
    } else if (action === 'unlike') {
      interactionArray = ['unlikes'];
      interactionType = 'unlikes';
    } else if (action === 'love') {
      interactionArray = ['loves'];
      interactionType = 'loves';
    } else {
      return res.status(400).json({ error: 'Invalid action' });
    }

    // Remove all other interaction types for this user
    ['likes', 'loves', 'unlikes'].forEach((type) => {
      if (type !== interactionType) {
        const index = doc[type].indexOf(userId);
        if (index !== -1) {
          doc[type].splice(index, 1);
        }
      }
    });

    // Check if the user already performed the interaction
    const alreadyPerformed = doc[interactionType].includes(userId);

    if (alreadyPerformed) {
      doc[interactionType].pull(userId);
    } else {
      doc[interactionType].push(userId);
    }

    await doc.save();

    res.status(200).json({
      message: `${interactionType} status updated`,
      likes: doc.likes || [],
      loves: doc.loves || [],
      unlikes: doc.unlikes || [],
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'An error occurred' });
  }
}
export default updateInteraction