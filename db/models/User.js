import mongoose from "mongoose";
import bcrypt from "bcrypt";
const userSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, max: 64 },
  email: {
    type: String,
    required: true,
    trim: true,
    unique: true,
    lowercase: true,
  },
  password: { type: String, required: true },
  profileImage: {
    type: String,
    default:
      "https://res.cloudinary.com/di24dufhu/image/upload/v1790556130/fallBackUser_h1depb.png",
    required: false,
  },
  terms: { type: Boolean, default: false },
  role: {
    type: String,
    enum: ["admin", "superadmin", "user"],
    default: "user",
  },
  // Soft delete, so a deactivated account keeps its posts and comments and can
  // be brought back. A hard delete would orphan both.
  status: {
    type: String,
    enum: ["active", "deactivated"],
    default: "active",
  },
  deactivatedAt: { type: Date, default: null },
  tokenVersion: { type: Number, default: 0 },
});
// Hash the password before saving
userSchema.pre("save", async function (next) {
  if (!this.isModified("password")) {
    return next();
  }
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

const User = mongoose.model("User", userSchema);

export default User;
