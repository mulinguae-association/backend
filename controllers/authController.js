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
import { handleUpload, cloudinary } from "../utils/cloundinaryConfig.js";

async function register(req, res) {
  try {
    const { name, email, password, confirmPassword, terms, token } = req.body;
    // check human validation
    if (!token) {
      res.status(400).json({ error: "recaptcha token is missing!" });
    }
    const human = await validateHuman(token);
    if (human) {
      // Check if name i entered
      if (!name) {
        return res.status(400).json({ error: `Name is required` });
      }
      if (!email) {
        return res.status(400).json({ error: `Email is required` });
      }
      if (!validator.isEmail(email)) {
        return res.status(400).json({ error: "Email is not valid" });
      }
      if (!terms) {
        return res.status(400).json({ error: `Terms is required` });
      }
      // Check is password is good
      if (!validator.isStrongPassword(password)) {
        return res.status(400).json({ error: `password is not strong` });
      }
      if (!password || password.length < 8) {
        return res.status(400).json({
          error: `Password is required and should be at least 8 characters long`,
        });
      }
      if (password !== confirmPassword) {
        return res.status(400).json({ error: "passwords don't match" });
      }
      // Check if email already exists
      const existingUser = await User.findOne({ email });
      if (existingUser) {
        return res.status(400).json({ error: "email already exists." });
      }
      const newUser = new User({ name, email, password, terms });
      await newUser.save();
      return res.status(200).json({ message: "Registered successfully" });
    } else {
      res.status(400).json({ error: "Please, you're not folling us, bot." });
      return;
    }
  } catch (error) {
    console.error("Error during registration:", error);
    return res.status(500).json({ error: "Internal server error" });
  }
}

async function login(req, res) {
  const { email, password } = req.body;
  try {
    const user = await User.findOne({ email });
    if (!user) {
      return res.json({ error: "Invalid Credentials" });
    }
    if (user.status === "deactivated") {
      return res.status(403).json({
        error:
          "Your account is deactivated. Please contact support or an administrator.",
      });
    }
    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      return res.json({ error: "Invalid Credentials" });
    }

    const userData = {
      userId: user._id,
      role: user.role,
      name: user.name,
      email: user.email,
      profileImage: user.profileImage,
    };

    jwt.sign(
      userData,
      process.env.JWT_SECRET,
      {
        expiresIn: "3d",
      },
      (err, token) => {
        if (err) throw err;
        res
          .cookie("token", token, {
            httpOnly: true,
            sameSite: process.env.NODE_ENV === "production" ? "Lax" : "Strict",
            secure: process.env.NODE_ENV === "production",
            path: "/",
          })
          .json(userData);
      },
    );
  } catch (error) {
    return res.status(500).json({ error: "Internal server error" });
  }
}
const getProfile = async (req, res) => {
  try {
    const user = req.user;

    console.log(user);
    if (!user) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    return res.json(user);
  } catch (err) {
    console.log(err);
    return res.status(500).json({ error: "Internal server error" });
  }
};

const logout = (req, res) => {
  res.clearCookie("token", {
    httpOnly: true,
    sameSite: process.env.NODE_ENV === "production" ? "Lax" : "Strict",
    secure: process.env.NODE_ENV === "production",
    path: "/",
  });
  res.status(200).json("Logout success");
};

async function forgotPassword(req, res) {
  const { email, lang } = req.body;

  try {
    if (!email) {
      return res.status(400).json({ error: "email is required" });
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
        return res.status(400).json({ message: "Faild to send email" });
      }
    } else {
      return res.status(400).json({ error: "Invaild Email" });
    }
  } catch (err) {
    return res.status(400).json({ error: err });
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
            return res.status(400).json({ message: "Link has been Expired" });
          }
        } catch (err) {
          return res.status(400).json({ message: "Link has been Expired" });
        }
      } else {
        return res
          .status(400)
          .json({ message: "password and confirm password doesn't match" });
      }
    } else {
      return res.status(400).json({ message: "All fields are required" });
    }
  } catch (err) {
    return res.status(400).json({ message: err });
  }
}

function generateToken(user) {
  const token = jwt.sign(
    {
      userId: user._id,
      role: user.role,
      name: user.name,
      email: user.email,
      profileImage: user.profileImage,
    },
    process.env.JWT_SECRET,
    {
      expiresIn: "3d", // Set the token expiration time
    },
  );
  return token;
}
async function updateProfile(req, res) {
  const { name, email } = req.body;

  const userId = req.user._id;
  try {
    if (!name && !email && !req.file) {
      return res
        .status(400)
        .json({ error: "Name OR Email OR avatar are required" });
    }

    const user = await User.findById(userId);

    if (!user) {
      return res.status(400).json({ error: "User Not Found!" });
    }
    // Check if the email already exists in the database
    if (email !== user.email) {
      const existingUser = await User.findOne({ email });

      if (existingUser) {
        return res.status(400).json({ error: "Email already exists" });
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
              console.error(error);
              return res.status(500).json({
                message: "Error deleting previous image from Cloudinary",
              });
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
    const updatedToken = generateToken(user);
    res.cookie("token", updatedToken, {
      httpOnly: true,
      sameSite: process.env.NODE_ENV === "production" ? "Lax" : "Strict",
      secure: process.env.NODE_ENV === "production",
      path: "/",
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
    return res.status(400).json({ error: err.message });
  }
}
export {
  register,
  login,
  getProfile,
  updateProfile,
  logout,
  forgotPassword,
  ResetPassword,
};
