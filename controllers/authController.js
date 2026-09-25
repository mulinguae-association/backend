import User from "../db/models/User.js";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { convertToWebp } from "../utils/imageConversion.js";
import { __dirname } from "../utils/dirname.js";
import { promises as fs } from "fs";
import path from "path";
import { sendEmail } from "../utils/emailSender.js";
import { validateHuman } from "../utils/validateHuman.js";
import validator from "validator";
import problem from "../utils/problem.js";
import { handleUpload, cloudinary } from "../utils/cloundinaryConfig.js";
import {
  ACCESS_COOKIE,
  REFRESH_COOKIE,
  generateAccessToken,
  generateRefreshToken,
  verifyToken,
  setAuthCookies,
  clearAuthCookies,
} from "../services/tokenService.js";

const toUserData = (user) => ({
  userId: user._id,
  role: user.role,
  name: user.name,
  email: user.email,
  profileImage: user.profileImage,
});
async function register(req, res) {
  try {
    const { name, email, password, confirmPassword, terms, token } = req.body;
    // check human validation
    if (!token) {
      // Without this return the request carried on into validateHuman(undefined)
      // and tried to write a second response after the 400 was already sent.
      return problem(res, {
        req,
        status: 400,
        code: "AUTH_RECAPTCHA_REQUIRED",
        title: "Human verification is required",
      });
    }
    const human = await validateHuman(token);
    if (human) {
      // Check if name i entered
      if (!name) {
        return problem(res, { req, status: 400, code: "AUTH_NAME_REQUIRED", title: "Name is required" });
      }
      if (!email) {
        return problem(res, { req, status: 400, code: "AUTH_EMAIL_REQUIRED", title: "Email is required" });
      }
      if (!validator.isEmail(email)) {
        return problem(res, { req, status: 400, code: "AUTH_EMAIL_INVALID", title: "Email is not valid" });
      }
      if (!terms) {
        return problem(res, { req, status: 400, code: "AUTH_TERMS_REQUIRED", title: "Terms is required" });
      }
      // Check is password is good
      if (!validator.isStrongPassword(password)) {
        return problem(res, { req, status: 400, code: "AUTH_PASSWORD_WEAK", title: "Password is not strong" });
      }
      if (!password || password.length < 8) {
        return problem(res, {
          req,
          status: 400,
          code: "AUTH_PASSWORD_TOO_SHORT",
          title: "Password is too short",
          detail: "Password is required and should be at least 8 characters long",
        });
      }
      if (password !== confirmPassword) {
        return problem(res, { req, status: 400, code: "AUTH_PASSWORD_MISMATCH", title: "Passwords do not match" });
      }
      // Check if email already exists
      const existingUser = await User.findOne({
        email: String(email || "").trim().toLowerCase(),
      });
      if (existingUser) {
        return problem(res, { req, status: 400, code: "AUTH_EMAIL_EXISTS", title: "Email already exists" });
      }
      const newUser = new User({ name, email, password, terms });
      await newUser.save();
      return res.status(200).json({ message: "Registered successfully" });
    } else {
      problem(res, { req, status: 400, code: "AUTH_RECAPTCHA_FAILED", title: "Human verification failed" });
      return;
    }
  } catch (error) {
    console.error("Error during registration:", error);
    return problem(res, { req, status: 500, code: "INTERNAL_ERROR", title: "Internal server error" });
  }
}

async function login(req, res) {
  const { email, password } = req.body;
  try {
    const user = await User.findOne({
      email: String(email || "").trim().toLowerCase(),
    });
    if (!user) {
      return problem(res, { req, status: 401, code: "AUTH_INVALID_CREDENTIALS", title: "Invalid credentials" });
    }
    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      return problem(res, { req, status: 401, code: "AUTH_INVALID_CREDENTIALS", title: "Invalid credentials" });
    }

    const accessToken = generateAccessToken(user);
    const refreshToken = generateRefreshToken(user);
    setAuthCookies(res, { accessToken, refreshToken });

    return res.json(toUserData(user));
  } catch (error) {
    return problem(res, { req, status: 500, code: "INTERNAL_ERROR", title: "Internal server error" });
  }
}

async function refresh(req, res) {
  const refreshToken = req.cookies?.[REFRESH_COOKIE];
  if (!refreshToken) {
    return problem(res, { req, status: 401, code: "AUTH_NO_REFRESH_TOKEN", title: "No refresh token" });
  }

  try {
    const decoded = verifyToken(refreshToken);
    const user = await User.findById(decoded.userId);
    if (!user || (user.tokenVersion || 0) !== decoded.tokenVersion) {
      clearAuthCookies(res);
      return problem(res, { req, status: 401, code: "AUTH_REFRESH_TOKEN_INVALID", title: "Invalid refresh token" });
    }

    const accessToken = generateAccessToken(user);
    user.tokenVersion = (user.tokenVersion || 0) + 1;
    const newRefreshToken = generateRefreshToken(user);
    await user.save();

    setAuthCookies(res, { accessToken, refreshToken: newRefreshToken });
    return res.json({ userData: toUserData(user) });
  } catch (err) {
    clearAuthCookies(res);
    return problem(res, { req, status: 401, code: "AUTH_REFRESH_TOKEN_EXPIRED", title: "Refresh token expired or invalid" });
  }
}
const getProfile = (req, res) => {
  const { token } = req.cookies;
  jwt.verify(
    token,
    process.env.JWT_SECRET,
    { expiresIn: "3d" },
    (err, user) => {
      if (err) {
        if (err.name === "TokenExpiredError") {
          return problem(res, { req, status: 401, code: "AUTH_TOKEN_EXPIRED", title: "Token expired" });
        }
        // Handle other JWT errors here, if needed
        return problem(res, { req, status: 401, code: "AUTH_INVALID_TOKEN", title: "Invalid token" });
      }
      return res.json(user);
    },
  );
};

async function logout(req, res) {
  try {
    const refreshToken = req.cookies?.[REFRESH_COOKIE];
    if (refreshToken) {
      const decoded = verifyToken(refreshToken);
      if (decoded?.userId) {
        await User.findByIdAndUpdate(decoded.userId, {
          $inc: { tokenVersion: 1 },
        });
      }
    }
  } catch {
    // Ignore invalid/expired refresh tokens; they are revoked by rotation anyway.
  }

  clearAuthCookies(res);
  return res.status(200).json("Logout success");
}

async function forgotPassword(req, res) {
  const { email, lang } = req.body;

  try {
    if (!email) {
      return problem(res, { req, status: 400, code: "AUTH_EMAIL_REQUIRED", title: "Email is required" });
    }
    const user = await User.findOne({ email });
    if (user) {
      // Create a secret key using user ID and JWT secret
      const secretKey = user._id + process.env.JWT_SECRET;
      const token = jwt.sign({ userId: user._id }, secretKey, {
        expiresIn: "15m",
      });

      // read html file
      const templatePath = path.join(
        __dirname,
        "../email_templates/reset_password.html",
      );
      const htmlTemplate = await fs.readFile(templatePath, "utf-8");

      const link = `${process.env.FRONTEND_URL}/${lang}/reset/${user._id}/${token}`;
      const formateHtml = htmlTemplate.replace("{{resetLink}}", link);

      const mailOptions = {
        from: "ascmulingua@gmail.com",
        to: email,
        subject: "Password Rest Request",
        html: formateHtml,
      };

      try {
        await sendEmail(mailOptions);
        return res.status(200).json({ message: "Email Sent" });
      } catch (error) {
        return problem(res, { req, status: 400, code: "AUTH_EMAIL_SEND_FAILED", title: "Failed to send email" });
      }
    } else {
      return problem(res, { req, status: 400, code: "AUTH_EMAIL_INVALID", title: "Invalid email" });
    }
  } catch (err) {
    return problem(res, { req, status: 400, code: "AUTH_REQUEST_FAILED", title: "Request could not be processed" });
  }
}
async function ResetPassword(req, res) {
  const { password, confirmPassword } = req.body;
  const { id, token } = req.params;

  try {
    if (password && confirmPassword && id && token) {
      if (password === confirmPassword) {
        const user = await User.findById(id);
        // Create a secret key using user ID and JWT secret
        const secretKey = user._id + process.env.JWT_SECRET;
        try {
          const isValid = jwt.verify(token, secretKey);
          if (isValid) {
            // hash password
            const genSalt = await bcrypt.genSalt(10);
            const hashedPass = await bcrypt.hash(password, genSalt);
            const isSuccess = await User.findByIdAndUpdate(user._id, {
              $set: {
                password: hashedPass,
              },
            });
            if (isSuccess) {
            }
            return res.status(200).json({
              message: "Password Changed Successfully",
            });
          } else {
            return problem(res, { req, status: 400, code: "AUTH_RESET_LINK_EXPIRED", title: "Reset link has expired" });
          }
        } catch (err) {
          return problem(res, { req, status: 400, code: "AUTH_RESET_LINK_EXPIRED", title: "Reset link has expired" });
        }
      } else {
        return problem(res, {
          req,
          status: 400,
          code: "AUTH_PASSWORD_MISMATCH",
          title: "Passwords do not match",
        });
      }
    } else {
      return problem(res, { req, status: 400, code: "AUTH_FIELDS_REQUIRED", title: "All fields are required" });
    }
  } catch (err) {
    return problem(res, { req, status: 400, code: "AUTH_REQUEST_FAILED", title: "Request could not be processed" });
  }
}

async function updateProfile(req, res) {
  const { name, email } = req.body;

  const userId = req.userId;
  try {
    if (!name && !email && !req.file) {
      return problem(res, { req, status: 400, code: "AUTH_FIELDS_REQUIRED", title: "Name, email or avatar are required" });
    }

    const user = await User.findById(userId);

    if (!user) {
      return problem(res, {
        req,
        status: 400,
        code: "AUTH_USER_NOT_FOUND",
        title: "User not found",
      });
    }
    // Check if the email already exists in the database
    if (email !== user.email) {
      const existingUser = await User.findOne({
        email: String(email || "").trim().toLowerCase(),
      });

      if (existingUser) {
        return problem(res, { req, status: 400, code: "AUTH_EMAIL_EXISTS", title: "Email already exists" });
      }
    }
    if (req.file) {
      // Remove previous profile image from Cloudinary
      if (user.profileImage) {
        const publicId = user.profileImage.split("/").pop().split(".")[0];
        await cloudinary.uploader.destroy(
          `usersAvatar/${publicId}`,
        async (error) => {
          if (error) {
            // Logged only: this callback fires after the response has already
            // been sent, so answering here would be a second write and throw
            // ERR_HTTP_HEADERS_SENT, which takes the process down.
            console.error("Cloudinary cleanup of the previous avatar failed:", error);
          }
        },
        );
      }
      const croppedImage = await convertToWebp(req.file.buffer, "personalImg");
      const b64 = croppedImage.toString("base64");
      const dataURI = "data:" + req.file.mimetype + ";base64," + b64;
      const cldRes = await handleUpload(dataURI);
      user.profileImage = cldRes.secure_url;
    }

    user.name = name;
    user.email = email;

    await user.save();
    user.tokenVersion = (user.tokenVersion || 0) + 1;
    setAuthCookies(res, {
      accessToken: generateAccessToken(user),
      refreshToken: generateRefreshToken(user),
    });
    return res.status(200).json({
      data: {
        userId,
        name: user.name,
        email,
        profileImage: user.profileImage,
        role: user.role,
      },
      message: "Profile updated successfully",
    });
  } catch (err) {
    return problem(res, { req, status: 400, code: "AUTH_REQUEST_FAILED", title: "Request could not be processed" });
  }
}
export {
  register,
  login,
  refresh,
  getProfile,
  updateProfile,
  logout,
  forgotPassword,
  ResetPassword,
};
