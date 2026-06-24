import { Router } from "express";
import { createLiveConsultation } from "../services/live-consultation.service.js";

export const liveConsultationRouter = Router();
const consultationRateWindowMs = 15 * 60 * 1000;
const consultationRateLimit = 20;
const consultationRateBuckets = new Map();

liveConsultationRouter.post("/public/live-consultations", consultationRateLimiter, async (req, res, next) => {
  try {
    const payload = req.body || {};
    const message = String(payload.message || "").trim();
    const hasGoals = Array.isArray(payload.goals) && payload.goals.length > 0;
    const hasPhotos = Array.isArray(payload.photos) && payload.photos.length > 0;
    if (!message && !hasGoals && !hasPhotos) {
      res.status(400).json({ error: "Message, goal or photo is required for consultation" });
      return;
    }
    const consultation = await createLiveConsultation(payload);
    res.json(consultation);
  } catch (error) {
    next(error);
  }
});

function consultationRateLimiter(req, res, next) {
  const key = [
    req.headers["x-tenant-id"] || "public",
    req.headers["x-branch-id"] || "marketplace",
    req.ip || req.socket?.remoteAddress || "unknown"
  ].join(":");
  const now = Date.now();
  const bucket = consultationRateBuckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    consultationRateBuckets.set(key, { count: 1, resetAt: now + consultationRateWindowMs });
    next();
    return;
  }
  if (bucket.count >= consultationRateLimit) {
    res.status(429).json({ error: "Too many live consultation requests. Please try again shortly." });
    return;
  }
  bucket.count += 1;
  next();
}
