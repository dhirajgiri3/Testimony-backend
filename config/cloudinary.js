import { v2 as cloudinary } from "cloudinary";
import dotenv from "dotenv";
import { logger } from "../utils/logger.js";

dotenv.config();

// ✅ Correct Cloudinary configuration
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// ✅ Use `cloudinary.api.ping()` to verify connection (not cloudinary.verify())
cloudinary.api
  .ping()
  .then(() => {
    logger.info("✅ Cloudinary Configured and Verified Successfully");
  })
  .catch((error) => {
    logger.error("❌ Cloudinary Configuration Error:", error);
    process.exit(1); // Terminate the app if Cloudinary is not configured correctly
  });

// ✅ Upload file to Cloudinary using `uploader.upload_stream`
export const uploadToCloudinary = (buffer) => {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { resource_type: "auto" }, // Automatically determine the file type (image, video, etc.)
      (error, result) => {
        if (error) {
          logger.error("❌ Cloudinary Upload Error:", error);
          reject(error);
        } else {
          logger.info("✅ Cloudinary Upload Successful:", result.secure_url);
          resolve(result.secure_url);
        }
      }
    );
    stream.end(buffer); // Stream ends after uploading the buffer
  });
};

export default cloudinary;
