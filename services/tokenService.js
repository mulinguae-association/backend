import jwt from "jsonwebtoken";

export const ACCESS_COOKIE = "token";
export const REFRESH_COOKIE = "refreshToken";

export const ACCESS_TOKEN_TTL = "15m";
export const REFRESH_TOKEN_TTL = 30 * 24 * 60 * 60; // 30 days (seconds)

const ACCESS_COOKIE_MAX_AGE = 15 * 60 * 1000; // 15 minutes
const REFRESH_COOKIE_MAX_AGE = 30 * 24 * 60 * 60 * 1000; // 30 days

const cookieBase = () => ({
  httpOnly: true,
  sameSite: process.env.NODE_ENV === "production" ? "Lax" : "Strict",
  secure: process.env.NODE_ENV === "production",
  path: "/",
});

const cookieOptions = (maxAge) => ({ ...cookieBase(), maxAge });

const baseClaims = (user) => ({
  userId: user._id,
  role: user.role,
  name: user.name,
  email: user.email,
  profileImage: user.profileImage,
});

export const generateAccessToken = (user) =>
  jwt.sign(baseClaims(user), process.env.JWT_SECRET, {
    expiresIn: ACCESS_TOKEN_TTL,
  });

export const generateRefreshToken = (user) =>
  jwt.sign(
    { ...baseClaims(user), tokenVersion: user.tokenVersion || 0 },
    process.env.JWT_SECRET,
    { expiresIn: REFRESH_TOKEN_TTL },
  );

export const verifyToken = (token) => jwt.verify(token, process.env.JWT_SECRET);

export const setAuthCookies = (res, { accessToken, refreshToken }) => {
  res.cookie(ACCESS_COOKIE, accessToken, cookieOptions(ACCESS_COOKIE_MAX_AGE));
  res.cookie(REFRESH_COOKIE, refreshToken, cookieOptions(REFRESH_COOKIE_MAX_AGE));
};

export const clearAuthCookies = (res) => {
  res.clearCookie(ACCESS_COOKIE, cookieBase());
  res.clearCookie(REFRESH_COOKIE, cookieBase());
};