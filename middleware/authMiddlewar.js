// authMiddleware.js

import jwt from "jsonwebtoken";
import User from "../db/models/User.js";
import problem from "../utils/problem.js";

const authenticateUser = async (req, res, next) => {
  const token = req.cookies.token;
  if (!token)
    return problem(res, {
      req,
      status: 401,
      code: "AUTH_REQUIRED",
      title: "Authentication required",
      detail: "Authentication required. Please log in",
    });

  try {
    // Verify the token and decode its payload
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Find the authenticated user
    const user = await User.findById(decoded.userId);
    if (!user) {
      throw new Error();
    }

    if (user.status === "deactivated") {
      return problem(res, {
        req,
        status: 403,
        code: "ACCOUNT_DEACTIVATED",
        title: "Account deactivated",
        detail: "This account has been deactivated.",
      });
    }
    // Attach the user's details to the request object
    req.user = user;
    req.userId = user._id;
    req.userName = user.name;
    req.avatar = user.profileImage;
    req.role = user.role || "user";
    // Continue to the next middleware or route handler
    next();
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      return problem(res, {
        req,
        status: 401,
        code: "AUTH_TOKEN_EXPIRED",
        title: "Token expired",
        detail: "Token has expired. Please log in again.",
      });
    }
    return problem(res, {
      req,
      status: 401,
      code: "AUTH_INVALID_TOKEN",
      title: "Invalid token",
      detail: "Invalid token.",
    });
  }
};

export default authenticateUser;
