import multer from 'multer';
import AppError from '../utils/appError.js';

// Configure multer storage (in-memory)
const storage = multer.memoryStorage();

// File filter to allow only images
const fileFilter = (req, file, cb) => {
  if (file.mimetype.startsWith('image/')) {
    cb(null, true);
  } else {
    cb(new AppError('Not an image! Please upload only images.', 400), false);
  }
};

// Initialize multer
export const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB limit
});

/**
 * Middleware to handle file uploads with validation
 */
export const handleFileUpload = (req, res, next) => {
  upload.single('file')(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      return next(new AppError(`Multer error: ${err.message}`, 400));
    } else if (err) {
      return next(new AppError(`File upload error: ${err.message}`, 400));
    }
    next();
  });
};
