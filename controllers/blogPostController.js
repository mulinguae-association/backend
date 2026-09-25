import BlogPost from "../db/models/BlogPost.js";
import User from "../db/models/User.js";
import { isAdminRole } from "../utils/isAdminRole.js";
import {
  moderateBlogPost,
  ModerationUnavailableError,
} from "../services/moderationService.js";
import problem from "../utils/problem.js";

const REJECTED_STATUS = 422;
const UNAVAILABLE_STATUS = 503;

export async function createBlogPost(req, res) {
  try {
    const { title, subTitle, content } = req.body;
    const authorId = req.userId;
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

    const blogPost = new BlogPost({ title, subTitle, content, postedBy: author, status: "accepted" });
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

    if (blogPost.authorId == userId || isAdminRole(req.role)) {
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
  const searchQuery = req.query.q;
  try {
    const searchRegex = new RegExp(searchQuery, "i"); // Case-insensitive search
    // find users matching the query 
    const users = await User.find({
      name: { $regex: searchRegex }
    }).exec();

    const userIds = users.map(user => user._id);
    const searchResults = await BlogPost.find({
      status: "accepted",
      $or: [
        { title: { $regex: searchRegex } },
        { postedBy: { $in: userIds } },
      ],
    }).sort({ createdAt: -1 })
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
