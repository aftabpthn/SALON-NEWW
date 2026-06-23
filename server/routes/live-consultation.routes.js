import { Router } from "express";
import { createLiveConsultation } from "../services/live-consultation.service.js";

export const liveConsultationRouter = Router();

liveConsultationRouter.post("/public/live-consultations", async (req, res, next) => {
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
