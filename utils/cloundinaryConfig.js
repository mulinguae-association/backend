import dotenv from "dotenv";
import { v2 as cloudinary } from "cloudinary";
dotenv.config();

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true,
});

async function handleUpload(file, img) {
  const res = await cloudinary.uploader.upload(file, {
    resource_type: "auto",
    folder: img === "teacherImg" ? "teacherImg" : "usersAvatar",
  });
  return res;
}

export { cloudinary, handleUpload };
