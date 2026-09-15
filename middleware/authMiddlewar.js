// authMiddleware.js

import jwt from "jsonwebtoken";
import User from "../db/models/User.js";

const authenticateUser = async (req, res, next) => {
  const token = req.cookies.token;
  if (!token)
    return res
      .status(401)
      .json({ error: "Authentication required. Please log in" });

  try {
    // Verify the token and decode its payload
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Find the authenticated user
    const user = await User.findById(decoded.userId);
    if (!user) {
      throw new Error();
    }
    // Attach the user's details to the request object
    req.user = user;
    req.userId = user._id;
    req.userName = user.name;
    req.avatar = user.profileImage;
    req.role = decoded.role || "user";
    // Continue to the next middleware or route handler
    next();
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      return res
        .status(401)
        .json({ error: "Token has expired. Please log in again." });
    }
    return res.status(401).json({ error: "Invalid token." });
  }
};

export default authenticateUser;
