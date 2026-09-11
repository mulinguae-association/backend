// optionalAuthMiddleware.js
// Optional authentication: populates req.user when a valid token is present,
// but allows the request through without error for anonymous (guest) users.

import jwt from "jsonwebtoken";
import User from "../db/models/User.js";

const optionalAuth = async (req, res, next) => {
  const token = req.cookies?.token;
  if (!token) return next();

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(decoded.userId).select(
      "_id name email role status profileImage",
    );
    if (!user || user.status === "deactivated") {
      return next();
    }
    req.user = user;
  } catch {
    // Ignore invalid/expired tokens for optional endpoints
  }
  next();
};

export default optionalAuth;
