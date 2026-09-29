import User from "../db/models/User.js";
import { verifyToken } from "../services/tokenService.js";

const readCookie = (request, name) => {
  const header = request.headers?.cookie;
  if (!header) return null;

  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return null;
};

async function authenticateUpgrade(request) {
  const token = readCookie(request, "token");
  if (!token) return null;

  let decoded;

  try {
    decoded = verifyToken(token);
  } catch {
    return null;
  }

  const user = await User.findById(decoded.userId);
  if (!user || user.status === "deactivated") {
    return null;
  }
  return user;
}

export default authenticateUpgrade;
