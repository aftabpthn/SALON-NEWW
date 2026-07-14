import multer from "multer";
import { AppError, badRequest } from "../utils/app-error.js";
import { staffClientMediaMimeTypes } from "../utils/staff-client-media-file.util.js";

const upload = multer({
  storage: multer.memoryStorage(),
  preservePath: true,
  limits: {
    fileSize: 5 * 1024 * 1024,
    files: 1,
    fields: 2,
    parts: 4,
    fieldNameSize: 40,
    fieldSize: 256
  },
  fileFilter: (_req, file, callback) => {
    if (!staffClientMediaMimeTypes.has(String(file.mimetype || "").toLowerCase())) {
      callback(badRequest("Only JPEG, PNG, and WebP media are allowed"));
      return;
    }
    callback(null, true);
  }
}).single("file");

export function staffClientMediaUpload(req, res, next) {
  upload(req, res, (error) => {
    if (!error) {
      if (!req.file) return next(badRequest("Multipart file field 'file' is required"));
      next();
      return;
    }
    if (error instanceof multer.MulterError) {
      const status = error.code === "LIMIT_FILE_SIZE" ? 413 : 400;
      next(new AppError(error.code === "LIMIT_FILE_SIZE" ? "Media file must not exceed 5 MB" : "Invalid multipart media upload", status));
      return;
    }
    next(error);
  });
}
