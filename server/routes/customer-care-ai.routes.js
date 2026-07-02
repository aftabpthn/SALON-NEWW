import { Router } from "express";
import {
  answerCustomerCareQuestion,
  createCustomerCareTicket,
  escalateCustomerCareTicket,
  getCustomerCareAiContext,
  listCustomerCareHistory,
  listCustomerCareTickets,
  lookupCustomerCareCustomer
} from "../services/customer-care-ai.service.js";

export const customerCareAiRouter = Router();

const rateWindowMs = 10 * 60 * 1000;
const rateLimit = 40;
const buckets = new Map();

customerCareAiRouter.get("/customer-care-ai/context", rateLimiter, (req, res) => {
  res.json(getCustomerCareAiContext());
});

customerCareAiRouter.get("/customer-care-ai/customers/lookup", rateLimiter, (req, res) => {
  res.json(lookupCustomerCareCustomer(req.query || {}, req.access || headerAccess(req)));
});

customerCareAiRouter.get("/customer-care-ai/history", rateLimiter, (req, res) => {
  res.json(listCustomerCareHistory(req.query || {}, req.access || headerAccess(req)));
});

customerCareAiRouter.get("/customer-care-ai/tickets", rateLimiter, (req, res) => {
  res.json(listCustomerCareTickets(req.query || {}, req.access || headerAccess(req)));
});

customerCareAiRouter.post("/customer-care-ai/tickets", rateLimiter, (req, res, next) => {
  try {
    res.status(201).json(createCustomerCareTicket(req.body || {}, req.access || headerAccess(req)));
  } catch (error) {
    next(error);
  }
});

customerCareAiRouter.post("/customer-care-ai/escalations", rateLimiter, (req, res, next) => {
  try {
    res.status(201).json(escalateCustomerCareTicket(req.body || {}, req.access || headerAccess(req)));
  } catch (error) {
    next(error);
  }
});

customerCareAiRouter.post("/customer-care-ai/chat", rateLimiter, async (req, res, next) => {
  try {
    const message = String(req.body?.message || "").trim();
    if (!message) {
      res.status(400).json({ error: "message is required" });
      return;
    }
    const answer = await answerCustomerCareQuestion(req.body || {}, req.access || headerAccess(req));
    res.json(answer);
  } catch (error) {
    next(error);
  }
});

function headerAccess(req) {
  return {
    tenantId: req.headers["x-tenant-id"] || "",
    branchId: req.headers["x-branch-id"] || "",
    role: req.headers["x-user-role"] || ""
  };
}

function rateLimiter(req, res, next) {
  const key = [
    req.headers["x-tenant-id"] || "tenant",
    req.headers["x-branch-id"] || "branch",
    req.ip || req.socket?.remoteAddress || "unknown"
  ].join(":");
  const now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + rateWindowMs });
    next();
    return;
  }
  if (bucket.count >= rateLimit) {
    res.status(429).json({ error: "Too many Customer Care AI requests. Please try again shortly." });
    return;
  }
  bucket.count += 1;
  next();
}
