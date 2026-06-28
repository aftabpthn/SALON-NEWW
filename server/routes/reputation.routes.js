import { Router } from "express";
import { asyncHandler } from "../middleware/async-handler.js";
import { requirePermission } from "../middleware/rbac.js";
import { feedbackIntelligenceService } from "../services/reputation/feedback-intelligence.service.js";
import { reputationService } from "../services/reputation/reputation.service.js";
import { validateBody } from "../validators/request-validator.js";

export const reputationRouter = Router();
export const reputationPublicRouter = Router();

reputationPublicRouter.get(
  "/reputation/public/requests/:id",
  asyncHandler((req, res) => {
    res.json(reputationService.publicReviewRequest(req.params.id));
  })
);

reputationPublicRouter.post(
  "/reputation/public/requests/:id/feedback",
  validateBody({ required: ["rating"] }),
  asyncHandler((req, res) => {
    res.status(201).json(reputationService.submitPublicFeedback(req.params.id, req.body));
  })
);

reputationRouter.get(
  "/reputation/dashboard",
  requirePermission("read", () => "reputation"),
  asyncHandler((req, res) => {
    res.json(reputationService.dashboard(req.query, req.access));
  })
);

reputationRouter.get(
  "/reputation/dashboard/score",
  requirePermission("read", () => "reputation"),
  asyncHandler((req, res) => {
    res.json(reputationService.score(req.query, req.access));
  })
);

reputationRouter.get(
  "/reputation/reviews",
  requirePermission("read", () => "reputation"),
  asyncHandler((req, res) => {
    res.json(reputationService.reviews(req.query, req.access));
  })
);

reputationRouter.get(
  "/reputation/reviews/:id",
  requirePermission("read", () => "reputation"),
  asyncHandler((req, res) => {
    res.json(reputationService.review(req.params.id, req.access));
  })
);

reputationRouter.patch(
  "/reputation/reviews/:id",
  requirePermission("write", () => "reputation"),
  asyncHandler((req, res) => {
    res.json(reputationService.updateReview(req.params.id, req.body, req.access));
  })
);

reputationRouter.post(
  "/reputation/reviews/:id/assign",
  requirePermission("write", () => "reputation"),
  validateBody({ required: ["assignedTo"] }),
  asyncHandler((req, res) => {
    res.json(reputationService.assignReview(req.params.id, req.body, req.access));
  })
);

reputationRouter.post(
  "/reputation/reviews/:id/resolve",
  requirePermission("write", () => "reputation"),
  asyncHandler((req, res) => {
    res.json(reputationService.resolveReview(req.params.id, req.body, req.access));
  })
);

reputationRouter.post(
  "/reputation/reviews/:id/reply",
  requirePermission("write", () => "reputation"),
  validateBody({ required: ["replyText"] }),
  asyncHandler((req, res) => {
    res.status(201).json(reputationService.createReply(req.params.id, req.body, req.access));
  })
);

reputationRouter.post(
  "/reputation/reviews/:id/ai-draft-replies",
  requirePermission("write", () => "reputation"),
  asyncHandler((req, res) => {
    res.json(reputationService.draftReplies(req.params.id, req.body, req.access));
  })
);

reputationRouter.post(
  "/reputation/replies/:id/approve",
  requirePermission("write", () => "reputation"),
  asyncHandler((req, res) => {
    res.json(reputationService.approveReply(req.params.id, req.body, req.access));
  })
);

reputationRouter.post(
  "/reputation/replies/:id/post",
  requirePermission("write", () => "reputation"),
  asyncHandler((req, res) => {
    res.json(reputationService.postReply(req.params.id, req.body, req.access));
  })
);

reputationRouter.get(
  "/reputation/platforms",
  requirePermission("read", () => "reputation"),
  asyncHandler((req, res) => {
    res.json(reputationService.platforms(req.query, req.access));
  })
);

reputationRouter.post(
  "/reputation/platforms/connect/:code",
  requirePermission("write", () => "reputation"),
  asyncHandler((req, res) => {
    res.status(201).json(reputationService.connectPlatform(req.params.code, req.body, req.access));
  })
);

reputationRouter.post(
  "/reputation/platforms/:id/sync",
  requirePermission("write", () => "reputation"),
  asyncHandler(async (req, res) => {
    res.json(await reputationService.syncPlatform(req.params.id, req.body, req.access));
  })
);

reputationRouter.get(
  "/reputation/platforms/:id/oauth-url",
  requirePermission("read", () => "reputation"),
  asyncHandler((req, res) => {
    res.json(reputationService.oauthUrl(req.params.id, req.access));
  })
);

reputationRouter.get(
  "/reputation/request-campaigns",
  requirePermission("read", () => "reputation"),
  asyncHandler((req, res) => {
    res.json(reputationService.requestCampaigns(req.query, req.access));
  })
);

reputationRouter.post(
  "/reputation/request-campaigns",
  requirePermission("write", () => "reputation"),
  asyncHandler((req, res) => {
    res.status(201).json(reputationService.createRequestCampaign(req.body, req.access));
  })
);

reputationRouter.post(
  "/reputation/requests/send/:appointmentId",
  requirePermission("write", () => "reputation"),
  asyncHandler((req, res) => {
    res.status(201).json(reputationService.sendReviewRequest(req.params.appointmentId, req.body, req.access));
  })
);

reputationRouter.post(
  "/reputation/internal-feedback",
  requirePermission("write", () => "reputation"),
  validateBody({ required: ["rating"] }),
  asyncHandler((req, res) => {
    res.status(201).json(reputationService.internalFeedback(req.body, req.access));
  })
);

reputationRouter.get(
  "/reputation/alerts",
  requirePermission("read", () => "reputation"),
  asyncHandler((req, res) => {
    res.json(reputationService.alerts(req.query, req.access));
  })
);

reputationRouter.post(
  "/reputation/alerts/:id/acknowledge",
  requirePermission("write", () => "reputation"),
  asyncHandler((req, res) => {
    res.json(reputationService.acknowledgeAlert(req.params.id, req.body, req.access));
  })
);

reputationRouter.post(
  "/reputation/alerts/:id/resolve",
  requirePermission("write", () => "reputation"),
  asyncHandler((req, res) => {
    res.json(reputationService.resolveAlert(req.params.id, req.body, req.access));
  })
);

reputationRouter.get(
  "/reports/customer-feedback",
  requirePermission("read", () => "reputation"),
  asyncHandler((req, res) => {
    res.json(feedbackIntelligenceService.report(req.query, req.access));
  })
);

reputationRouter.get(
  "/reports/customer-feedback/staff-score",
  requirePermission("read", () => "reputation"),
  asyncHandler((req, res) => {
    res.json(feedbackIntelligenceService.staffScore(req.query, req.access));
  })
);

reputationRouter.get(
  "/reports/customer-feedback/service-score",
  requirePermission("read", () => "reputation"),
  asyncHandler((req, res) => {
    res.json(feedbackIntelligenceService.serviceScore(req.query, req.access));
  })
);

reputationRouter.post(
  "/reports/customer-feedback/:id/send-recovery-message",
  requirePermission("write", () => "reputation"),
  asyncHandler((req, res) => {
    res.status(201).json(feedbackIntelligenceService.sendRecoveryMessage(req.params.id, req.body, req.access));
  })
);

reputationRouter.post(
  "/reports/customer-feedback/:id/mark-reviewed",
  requirePermission("write", () => "reputation"),
  asyncHandler((req, res) => {
    res.json(feedbackIntelligenceService.markReviewed(req.params.id, req.body, req.access));
  })
);

reputationRouter.get(
  "/reports/customer-feedback/export.csv",
  requirePermission("read", () => "reputation"),
  asyncHandler((req, res) => {
    res.type("text/csv").send(feedbackIntelligenceService.csv(req.query, req.access));
  })
);

reputationRouter.get(
  "/reports/customer-feedback/owner.pdf",
  requirePermission("read", () => "reputation"),
  asyncHandler((req, res) => {
    res.json(feedbackIntelligenceService.ownerPdf(req.query, req.access));
  })
);
