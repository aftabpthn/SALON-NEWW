import { extname } from "node:path";
import { badRequest } from "./app-error.js";

const TYPES = {
  "image/jpeg": { extension: ".jpg", matches: (buffer) => buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff },
  "image/png": { extension: ".png", matches: (buffer) => buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  "image/webp": { extension: ".webp", matches: (buffer) => buffer.length >= 12 && buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP" }
};

export const staffClientMediaMimeTypes = new Set(Object.keys(TYPES));

export function validateStaffClientMediaFile(file) {
  if (!file?.buffer?.length) throw badRequest("A non-empty media file is required");
  const claimedType = String(file.mimetype || "").toLowerCase();
  const detectedType = Object.entries(TYPES).find(([, definition]) => definition.matches(file.buffer))?.[0];
  if (!detectedType) throw badRequest("File bytes are not a valid JPEG, PNG, or WebP image");
  if (claimedType !== detectedType) throw badRequest("Claimed MIME type does not match file bytes");

  const originalName = String(file.originalname || "");
  if (!originalName || originalName.includes("/") || originalName.includes("\\") || originalName.includes("\0")) {
    throw badRequest("Invalid media filename");
  }
  const extension = extname(originalName).toLowerCase();
  const validExtensions = detectedType === "image/jpeg" ? new Set([".jpg", ".jpeg"]) : new Set([TYPES[detectedType].extension]);
  if (!validExtensions.has(extension)) throw badRequest("Filename extension does not match file content");

  return { mimeType: detectedType, extension: TYPES[detectedType].extension };
}
