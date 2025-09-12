// utils/imageConversion.js

import sharp from "sharp";
const convertToWebp = async (fileBuffer, type) => {
  // console.log(file.buffer)
  try {
    const croppedImage = await sharp(fileBuffer)
      .resize({
        width: type === "personalImg" ? 100 : 250,
        height: type === "personalImg" ? 100 : 250,
        fit: "cover",
        position: "top",
        background: { r: 51, g: 51, b: 51, alpha: 0.5 },
      })
      .modulate({ brightness: 1.1, contrast: 100 })
      .toFormat("webp")
      .toBuffer();
    return croppedImage;
  } catch (error) {
    console.error("Error:", error);
    throw error;
  }
};

export { convertToWebp };
