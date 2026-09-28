import mongoose from "mongoose";
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

/**
 * Load a post the caller is allowed to edit. Responds and returns null when the
 * post does not exist or the caller may not touch it, so both the read and the
 * write path answer identically.
 */
const loadEditablePost = async (req, res) => {
  const blogPost = await BlogPost.findById(req.params.id);
  if (!blogPost) {
    problem(res, {
      req,
      status: 404,
      code: "BLOG_NOT_FOUND",
      title: "Blog post not found",
    });
    return null;
  }

  // The author lives on `postedBy`; the schema has no `authorId`. Both sides are
  // stringified because one is an ObjectId and the other may be a string.
  if (
    String(blogPost.postedBy) !== String(req.userId) &&
    !isAdminRole(req.role)
  ) {
    problem(res, {
      req,
      status: 403,
      code: "BLOG_NOT_EDITABLE",
      title: "No permission to edit blog post",
    });
    return null;
  }

  return blogPost;
};

/** The shape the feed serves, so an edited card keeps its author fields. */
const populateAuthor = { path: "postedBy", model: "User", select: "_id name profileImage role" };

/**
 * Screen a blog before it is persisted. Returns true when it may be saved, and
 * sends the response and returns false when it may not. Shared by creation and
 * editing so both refuse the same content under the same problem codes.
 */
async function screenBlogPost(req, res, { title, subTitle, content }) {
  try {
    const verdict = await moderateBlogPost({ title, subTitle, content });

    if (!verdict.allowed) {
      console.log("[moderation] rejected blog-safety");
      problem(res, {
        req,
        status: REJECTED_STATUS,
        code: "BLOG_CONTENT_REJECTED",
        title: "Content rejected",
        detail: "Your blog could not be saved.",
      });
      return false;
    }

    if (!verdict.relevant) {
      console.log("[moderation] rejected blog-relevance");
      problem(res, {
        req,
        status: REJECTED_STATUS,
        code: "BLOG_OUT_OF_SCOPE",
        title: "Out of scope",
        detail:
          "Your blog could not be saved because it does not match the site's content guidelines.",
      });
      return false;
    }

    return true;
  } catch (error) {
    // Fail closed: an unreachable moderator must never let content through.
    if (error instanceof ModerationUnavailableError) {
      problem(res, {
        req,
        status: UNAVAILABLE_STATUS,
        code: "MODERATION_UNAVAILABLE",
        title: "Moderation unavailable",
        detail: "Your blog could not be saved. Please try again later.",
      });
      return false;
    }
    throw error;
  }
}

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
    if (!(await screenBlogPost(req, res, { title, subTitle, content }))) {
      return;
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

/**
 * Read one post for the edit form. Restricted to the author and admins, so the
 * feed's paginated list does not have to already hold the post being edited.
 */
export async function getBlogPostForEdit(req, res) {
  try {
    const blogPost = await loadEditablePost(req, res);
    if (!blogPost) return;

    await blogPost.populate(populateAuthor);
    return res.json({ blogPost });
  } catch (error) {
    console.error("Error retrieving blog post:", error);
    return problem(res, {
      req,
      status: 500,
      code: "INTERNAL_ERROR",
      title: "Internal server error",
    });
  }
}

export async function updateBlogPost(req, res) {
  try {
    const blogPost = await loadEditablePost(req, res);
    if (!blogPost) return;

    const { title, subTitle, content, category } = req.body;

    // An absent category leaves the stored one alone, so an edit that only
    // rewrites the prose does not silently move the post to another topic.
    let resolvedCategory;
    if (category !== undefined) {
      resolvedCategory = resolveCategory(category);
      if (!resolvedCategory) {
        return invalidCategoryProblem(req, res);
      }
    }

    // Moderation judges the post as it will read after the edit, not the fields
    // that happened to be sent: a title-only request still has to be screened
    // against the content it keeps.
    const next = {
      title: title !== undefined ? title : blogPost.title,
      subTitle: subTitle !== undefined ? subTitle : blogPost.subTitle,
      content: content !== undefined ? content : blogPost.content,
    };

    // Screened after the ownership check, so an unauthorised edit costs no
    // moderation call, and the edit is all-or-nothing like creation.
    if (!(await screenBlogPost(req, res, next))) {
      return;
    }

    Object.assign(blogPost, next);
    if (resolvedCategory !== undefined) blogPost.category = resolvedCategory;

    await blogPost.save();
    await blogPost.populate(populateAuthor);

    return res.json({
      message: "Blog post updated successfully",
      blogPost: blogPost.toObject(),
    });
  } catch (error) {
    console.error("Error updating blog post:", error);
    return problem(res, {
      req,
      status: 500,
      code: "INTERNAL_ERROR",
      title: "Internal server error",
    });
  }
}

/**
 * Read one accepted post by id, for a shared link. The author-only GET /:id
 * cannot serve that: whoever follows a share is not signed in, and a malformed
 * id is answered with 404 rather than allowed to throw.
 */
export async function getPublicBlogPost(req, res) {
  try {
    const { id } = req.params;
    const blogPost = mongoose.isValidObjectId(id)
      ? await BlogPost.findById(id)
      : null;

    // 404 for anything not published, so a post that is not accepted is never
    // confirmed to exist.
    if (!blogPost || blogPost.status !== "accepted") {
      return problem(res, {
        req,
        status: 404,
        code: "BLOG_NOT_FOUND",
        title: "Blog post not found",
      });
    }

    await blogPost.populate(populateAuthor);
    return res.json({ blogPost });
  } catch (error) {
    console.error("Error retrieving blog post:", error);
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
      .populate(populateAuthor)
      // Read-only feed: hydration would rebuild a document per post, including
      // the `content` HTML the card only previews.
      .lean()
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

/**
 * The signed-in author's own posts, in the same shape as the public feed so the
 * client can reuse the same list. `status` is not filtered: an author can see
 * their rejected or pending post, otherwise it would vanish from their dashboard
 * with no explanation.
 */
export async function getMyBlogPosts(req, res) {
  try {
    const limit = parseInt(req.query.limit) || 5;
    const cursor = req.query.cursor;
    const filter = { postedBy: req.userId };

    // The same narrowing the public feed does, so the dashboard's category
    // chips and its search act on the list rather than only refetching it.
    if (req.query.category) {
      const category = resolveCategory(req.query.category);
      if (!category) {
        return invalidCategoryProblem(req, res);
      }
      filter.category = categoryCondition(category);
    }

    const searchQuery = typeof req.query.q === "string" ? req.query.q.trim() : "";

    // Search and cursor each build an `$or`; one must not overwrite the other,
    // so both go under `$and`. Otherwise a search on page two silently widened
    // back to "all my posts" and the pagination boundary filters out the term.
    const and = [];
    if (searchQuery) {
      // Scoped by postedBy above, so this can only ever match the caller's own
      // posts however the term is phrased.
      and.push({
        $or: [
          { title: { $regex: new RegExp(escapeRegex(searchQuery), "i") } },
          { subTitle: { $regex: new RegExp(escapeRegex(searchQuery), "i") } },
        ],
      });
    }

    if (cursor) {
      const lastPost = await BlogPost.findById(cursor).select("createdAt _id").lean();
      if (lastPost) {
        and.push({
          $or: [
            { createdAt: { $lt: lastPost.createdAt } },
            { createdAt: lastPost.createdAt, _id: { $lt: lastPost._id } },
          ],
        });
      }
    }

    if (and.length) {
      filter.$and = and;
    }

    const posts = await BlogPost.find(filter)
      .sort({ createdAt: -1, _id: -1 })
      .limit(limit + 1)
      .populate(populateAuthor)
      .lean()
      .exec();

    const hasMore = posts.length > limit;
    if (hasMore) posts.pop();

    res.status(200).json({
      posts,
      nextCursor: hasMore ? posts[posts.length - 1]._id : null,
    });
  } catch (error) {
    console.error("Error retrieving own blog posts:", error);
    problem(res, { req, status: 500, code: "INTERNAL_ERROR", title: "Internal server error" });
  }
}

export async function searchBlogPosts(req, res) {  const searchQuery = typeof req.query.q === "string" ? req.query.q : "";
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
      .populate(populateAuthor)

    res.status(200).json(searchResults);
  } catch (error) {
    console.error("Error searching blog posts:", error);
    problem(res, { req, status: 500, code: "INTERNAL_ERROR", title: "Internal server error" });
  }
}
