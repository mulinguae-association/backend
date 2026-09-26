import BlogPost, {
  BLOG_CATEGORIES,
  DEFAULT_BLOG_CATEGORY,
} from "../db/models/BlogPost.js";
import User from "../db/models/User.js";
import { isAdminRole } from "../utils/isAdminRole.js";
import {
  moderateBlogPost,
  ModerationUnavailableError,
} from "../services/moderationService.js";
import problem from "../utils/problem.js";

const REJECTED_STATUS = 422;
const UNAVAILABLE_STATUS = 503;

/** An absent or empty category means the default bucket, not an error. */
const resolveCategory = (value) => {
  if (value === undefined || value === null || value === "") {
    return DEFAULT_BLOG_CATEGORY;
  }
  return BLOG_CATEGORIES.includes(value) ? value : null;
};

 // Query condition for a category. General also matches documents with no 
const categoryCondition = (category) =>
  category === DEFAULT_BLOG_CATEGORY
    ? { $in: [DEFAULT_BLOG_CATEGORY, null] }
    : category;

/** A search term is matched literally, so a stray "(" cannot 500 the endpoint. */
const escapeRegex = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const invalidCategoryProblem = (req, res) =>
  problem(res, {
    req,
    status: REJECTED_STATUS,
    code: "CATEGORY_INVALID",
    title: "Unknown category",
    detail: "That category does not exist.",
  });

export async function createBlogPost(req, res) {
  try {
    const { title, subTitle, content, category } = req.body;
    const authorId = req.userId;

    // Checked before moderation: an unknown slug costs no Groq call, and the
    // category is only a label, so it is never worth spending the budget on.
    const resolvedCategory = resolveCategory(category);
    if (!resolvedCategory) {
      return invalidCategoryProblem(req, res);
    }
    const author = await User.findById(authorId)

    // Nothing is persisted unless both checks pass; an outage rejects too.
    try {
      const verdict = await moderateBlogPost({ title, subTitle, content });

      if (!verdict.allowed) {
        console.log("[moderation] rejected blog-safety");
        return problem(res, {
          req,
          status: REJECTED_STATUS,
          code: "CONTENT_REJECTED",
          title: "Content rejected",
          detail: "Your blog could not be published.",
        });
      }

      if (!verdict.relevant) {
        console.log("[moderation] rejected blog-relevance");
        return problem(res, {
          req,
          status: REJECTED_STATUS,
          code: "SCOPE_REJECTED",
          title: "Out of scope",
          detail:
            "Your blog could not be published because it does not match the site's content guidelines.",
        });
      }
    } catch (error) {
      if (error instanceof ModerationUnavailableError) {
        return problem(res, {
          req,
          status: UNAVAILABLE_STATUS,
          code: "MODERATION_UNAVAILABLE",
          title: "Moderation unavailable",
          detail: "Your blog could not be published. Please try again later.",
        });
      }
      throw error;
    }

    const blogPost = new BlogPost({ title, subTitle, content, postedBy: author, category: resolvedCategory, status: "accepted" });
    await blogPost.save();

    return res.json({
      message: "Blog post submitted successfully",
      blogPost: blogPost.toObject(),
    });
  } catch (error) {
    console.error("Error submitting blog post:", error);
    return problem(res, {
      req,
      status: 500,
      code: "INTERNAL_ERROR",
      title: "Internal server error",
    });
  }
}

export async function deleteBlogPost(req, res) {
  try {
    const { id } = req.params;
    const userId = req.userId;

    const blogPost = await BlogPost.findById(id);
    if (!blogPost) {
      return problem(res, {
        req,
        status: 404,
        code: "BLOG_NOT_FOUND",
        title: "Blog post not found",
      });
    }

    // The author lives on `postedBy`; the schema has no `authorId`. Both sides
    // are stringified because one is an ObjectId and the other may be a string.
    if (String(blogPost.postedBy) === String(userId) || isAdminRole(req.role)) {
      await BlogPost.findByIdAndDelete(id);
      return res
        .json({ message: "Blog post deleted successfully" });
    } else {
      return problem(res, {
        req,
        status: 403,
        code: "BLOG_NOT_DELETABLE",
        title: "No permission to delete blog post",
      });
    }

  } catch (error) {
    return problem(res, {
      req,
      status: 500,
      code: "INTERNAL_ERROR",
      title: "Internal server error",
    });
  }
}

export async function getAcceptedBlogPosts(req, res) {
  try {
    const limit = parseInt(req.query.limit) || 5;
    const cursor = req.query.cursor;
    const filter = { status: "accepted" };

    // No category param means the whole feed; the cursor is unchanged either
    // way, so paging stays consistent within whichever view was opened.
    if (req.query.category) {
      const category = resolveCategory(req.query.category);
      if (!category) {
        return invalidCategoryProblem(req, res);
      }
      filter.category = categoryCondition(category);
    }

    if (cursor) {
      const lastPost = await BlogPost.findById(cursor).select("createdAt _id").lean();
      if (lastPost) {
        filter.$or = [
          { createdAt: { $lt: lastPost.createdAt } },
          { createdAt: lastPost.createdAt, _id: { $lt: lastPost._id } },
        ];
      }
    }

    const posts = await BlogPost.find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .limit(limit + 1)
      .populate({
        path: "postedBy",
        model: "User",
        select: "_id name profileImage role"
      })
      .exec();

    const hasMore = posts.length > limit;
    if (hasMore) posts.pop();

    res.status(200).json({
      posts,
      nextCursor: hasMore ? posts[posts.length - 1]._id : null,
    });
  } catch (error) {
    console.error("Error retrieving accepted blog posts:", error);
    problem(res, { req, status: 500, code: "INTERNAL_ERROR", title: "Internal server error" });
  }
}

export async function searchBlogPosts(req, res) {
  const searchQuery = typeof req.query.q === "string" ? req.query.q : "";
  try {
    // Case-insensitive, matched literally so a term like "c++" or "(" is not
    // read as a pattern.
    const searchRegex = new RegExp(escapeRegex(searchQuery), "i");
    // find users matching the query
    const users = await User.find({
      name: { $regex: searchRegex }
    }).exec();

    const userIds = users.map(user => user._id);
    const filter = {
      status: "accepted",
      $or: [
        { title: { $regex: searchRegex } },
        // So typing a category name finds its posts. The stored value is the
        // slug, so this matches the English name and not the translated label.
        { category: { $regex: searchRegex } },
        { postedBy: { $in: userIds } },
      ],
    };

    // The category filter narrows the results, same rules as the feed.
    if (req.query.category) {
      const category = resolveCategory(req.query.category);
      if (!category) {
        return invalidCategoryProblem(req, res);
      }
      filter.category = categoryCondition(category);
    }

    const searchResults = await BlogPost.find(filter)
      .sort({ createdAt: -1 })
      .populate({
        path: "postedBy",
        model: "User",
        select: "_id name profileImage role"
      })

    res.status(200).json(searchResults);
  } catch (error) {
    console.error("Error searching blog posts:", error);
    problem(res, { req, status: 500, code: "INTERNAL_ERROR", title: "Internal server error" });
  }
}
