import { Router } from "express";
import { asyncHandler } from "../middleware/async-handler.js";
import { requirePermission } from "../middleware/rbac.js";
import { membershipEnterpriseService } from "../services/membership-enterprise.service.js";
import { validateBody } from "../validators/request-validator.js";

export const membershipEnterpriseRouter = Router();

membershipEnterpriseRouter.get(
  "/membership-enterprise/plans",
  requirePermission("read", () => "memberships"),
  asyncHandler((req, res) => {
    res.json(membershipEnterpriseService.listPlans(req.query, req.access));
  })
);

membershipEnterpriseRouter.post(
  "/membership-enterprise/plans",
  requirePermission("write", () => "memberships"),
  validateBody({ required: ["name"] }),
  asyncHandler((req, res) => {
    res.status(201).json(membershipEnterpriseService.createPlan(req.body, req.access));
  })
);

membershipEnterpriseRouter.get(
  "/membership-enterprise/plans/:id",
  requirePermission("read", () => "memberships"),
  asyncHandler((req, res) => {
    res.json(membershipEnterpriseService.getPlan(req.params.id, req.access));
  })
);

membershipEnterpriseRouter.patch(
  "/membership-enterprise/plans/:id",
  requirePermission("write", () => "memberships"),
  asyncHandler((req, res) => {
    res.json(membershipEnterpriseService.updatePlan(req.params.id, req.body, req.access));
  })
);

membershipEnterpriseRouter.get(
  "/membership-enterprise/plans/:id/360",
  requirePermission("read", () => "memberships"),
  asyncHandler((req, res) => {
    res.json(membershipEnterpriseService.plan360(req.params.id, req.access));
  })
);

membershipEnterpriseRouter.get(
  "/membership-enterprise/client/:clientId/eligibility",
  requirePermission("read", () => "memberships"),
  asyncHandler((req, res) => {
    res.json(membershipEnterpriseService.eligibility(req.params.clientId, req.query, req.access));
  })
);

membershipEnterpriseRouter.get(
  "/membership-enterprise/client/:clientId/wallet",
  requirePermission("read", () => "memberships"),
  asyncHandler((req, res) => {
    res.json(membershipEnterpriseService.membershipWallet(req.params.clientId, req.query, req.access));
  })
);

membershipEnterpriseRouter.get(
  "/membership-enterprise/client/:clientId/self-service",
  requirePermission("read", () => "memberships"),
  asyncHandler((req, res) => {
    res.json(membershipEnterpriseService.membershipSelfServiceSummary(req.params.clientId, req.query, req.access));
  })
);

membershipEnterpriseRouter.post(
  "/membership-enterprise/client/:clientId/self-service/status-link",
  requirePermission("write", () => "memberships"),
  asyncHandler((req, res) => {
    res.status(201).json(membershipEnterpriseService.createSelfServiceStatusLink(req.params.clientId, req.body, req.access));
  })
);

membershipEnterpriseRouter.post(
  "/membership-enterprise/client/:clientId/self-service/whatsapp-summary",
  requirePermission("write", () => "memberships"),
  asyncHandler((req, res) => {
    res.status(201).json(membershipEnterpriseService.createWhatsAppMembershipSummary(req.params.clientId, req.body, req.access));
  })
);

membershipEnterpriseRouter.get(
  "/membership-enterprise/self-service/public/:token",
  asyncHandler((req, res) => {
    res.json(membershipEnterpriseService.publicSelfServiceStatus(req.params.token));
  })
);

membershipEnterpriseRouter.post(
  "/membership-enterprise/self-service/public/:token/renew-link",
  asyncHandler((req, res) => {
    res.status(201).json(membershipEnterpriseService.publicRenewPaymentLink(req.params.token, req.body));
  })
);

membershipEnterpriseRouter.post(
  "/membership-enterprise/self-service/public/:token/cancel-request",
  asyncHandler((req, res) => {
    res.status(201).json(membershipEnterpriseService.publicCancelRequest(req.params.token, req.body));
  })
);

membershipEnterpriseRouter.post(
  "/membership-enterprise/self-service/public/:token/payment-method-update",
  asyncHandler((req, res) => {
    res.status(201).json(membershipEnterpriseService.publicPaymentMethodUpdateRequest(req.params.token, req.body));
  })
);

membershipEnterpriseRouter.get(
  "/membership-enterprise/client/:clientId/suggestion",
  requirePermission("read", () => "memberships"),
  asyncHandler((req, res) => {
    res.json(membershipEnterpriseService.posSuggestion(req.params.clientId, req.query, req.access));
  })
);

membershipEnterpriseRouter.post(
  "/membership-enterprise/sell",
  requirePermission("write", () => "memberships"),
  validateBody({ required: ["clientId", "planId"] }),
  asyncHandler((req, res) => {
    res.status(201).json(membershipEnterpriseService.sellMembership(req.body, req.access));
  })
);

membershipEnterpriseRouter.get(
  "/membership-enterprise/ledger",
  requirePermission("read", () => "memberships"),
  asyncHandler((req, res) => {
    res.json(membershipEnterpriseService.ledgerList(req.query, req.access));
  })
);

membershipEnterpriseRouter.post(
  "/membership-enterprise/memberships/:id/proration-preview",
  requirePermission("read", () => "memberships"),
  asyncHandler((req, res) => {
    res.json(membershipEnterpriseService.prorationPreview(req.params.id, req.body, req.access));
  })
);

membershipEnterpriseRouter.get(
  "/membership-enterprise/memberships/:id/360",
  requirePermission("read", () => "memberships"),
  asyncHandler((req, res) => {
    res.json(membershipEnterpriseService.membership360(req.params.id, req.access));
  })
);

membershipEnterpriseRouter.post(
  "/membership-enterprise/memberships/:id/renew",
  requirePermission("write", () => "memberships"),
  asyncHandler((req, res) => {
    res.json(membershipEnterpriseService.lifecycle(req.params.id, "renew", req.body, req.access));
  })
);

membershipEnterpriseRouter.post(
  "/membership-enterprise/memberships/:id/upgrade",
  requirePermission("write", () => "memberships"),
  asyncHandler((req, res) => {
    res.json(membershipEnterpriseService.lifecycle(req.params.id, "upgrade", req.body, req.access));
  })
);

membershipEnterpriseRouter.post(
  "/membership-enterprise/memberships/:id/downgrade",
  requirePermission("write", () => "memberships"),
  asyncHandler((req, res) => {
    res.json(membershipEnterpriseService.lifecycle(req.params.id, "downgrade", req.body, req.access));
  })
);

membershipEnterpriseRouter.post(
  "/membership-enterprise/memberships/:id/cancel",
  requirePermission("write", () => "memberships"),
  asyncHandler((req, res) => {
    res.json(membershipEnterpriseService.lifecycle(req.params.id, "cancel", req.body, req.access));
  })
);

membershipEnterpriseRouter.post(
  "/membership-enterprise/memberships/:id/self-service/renew-link",
  requirePermission("write", () => "memberships"),
  asyncHandler((req, res) => {
    res.status(201).json(membershipEnterpriseService.createRenewPaymentLink(req.params.id, req.body, req.access));
  })
);

membershipEnterpriseRouter.post(
  "/membership-enterprise/memberships/:id/self-service/cancel-request",
  requirePermission("write", () => "memberships"),
  asyncHandler((req, res) => {
    res.status(201).json(membershipEnterpriseService.createCancelRequest(req.params.id, req.body, req.access));
  })
);

membershipEnterpriseRouter.post(
  "/membership-enterprise/memberships/:id/self-service/payment-method-update",
  requirePermission("write", () => "memberships"),
  asyncHandler((req, res) => {
    res.status(201).json(membershipEnterpriseService.createPaymentMethodUpdateRequest(req.params.id, req.body, req.access));
  })
);

membershipEnterpriseRouter.post(
  "/membership-enterprise/memberships/:id/credit-adjustment-request",
  requirePermission("write", () => "memberships"),
  asyncHandler((req, res) => {
    res.status(201).json(membershipEnterpriseService.createManualCreditAdjustmentRequest(req.params.id, req.body, req.access));
  })
);

membershipEnterpriseRouter.post(
  "/membership-enterprise/family",
  requirePermission("write", () => "memberships"),
  validateBody({ required: ["primaryClientId", "memberClientId"] }),
  asyncHandler((req, res) => {
    res.status(201).json(membershipEnterpriseService.addFamilyMember(req.body, req.access));
  })
);

membershipEnterpriseRouter.get(
  "/membership-enterprise/reminders",
  requirePermission("read", () => "memberships"),
  asyncHandler((req, res) => {
    res.json(membershipEnterpriseService.reminders(req.query, req.access));
  })
);

membershipEnterpriseRouter.post(
  "/membership-enterprise/reminders/generate",
  requirePermission("write", () => "memberships"),
  asyncHandler((req, res) => {
    res.status(201).json(membershipEnterpriseService.generateReminders(req.body, req.access));
  })
);

membershipEnterpriseRouter.post(
  "/membership-enterprise/reminders/:id/approve",
  requirePermission("write", () => "memberships"),
  asyncHandler((req, res) => {
    res.json(membershipEnterpriseService.approveReminder(req.params.id, req.access));
  })
);

membershipEnterpriseRouter.get(
  "/membership-enterprise/auto-renew/queue",
  requirePermission("read", () => "memberships"),
  asyncHandler((req, res) => {
    res.json(membershipEnterpriseService.autoRenewQueue(req.query, req.access));
  })
);

membershipEnterpriseRouter.post(
  "/membership-enterprise/auto-renew/:membershipId/retry",
  requirePermission("write", () => "memberships"),
  asyncHandler((req, res) => {
    res.json(membershipEnterpriseService.retryAutoRenew(req.params.membershipId, req.body, req.access));
  })
);

membershipEnterpriseRouter.post(
  "/membership-enterprise/auto-renew/:membershipId/pause",
  requirePermission("write", () => "memberships"),
  asyncHandler((req, res) => {
    res.json(membershipEnterpriseService.pauseAutoRenew(req.params.membershipId, req.body, req.access));
  })
);

membershipEnterpriseRouter.post(
  "/membership-enterprise/auto-renew/:membershipId/resume",
  requirePermission("write", () => "memberships"),
  asyncHandler((req, res) => {
    res.json(membershipEnterpriseService.resumeAutoRenew(req.params.membershipId, req.body, req.access));
  })
);

membershipEnterpriseRouter.get(
  "/membership-enterprise/reports/revenue",
  requirePermission("read", () => "memberships"),
  asyncHandler((req, res) => {
    res.json(membershipEnterpriseService.revenueReport(req.query, req.access));
  })
);

membershipEnterpriseRouter.get(
  "/membership-enterprise/self-service/requests",
  requirePermission("read", () => "memberships"),
  asyncHandler((req, res) => {
    res.json(membershipEnterpriseService.selfServiceRequests(req.query, req.access));
  })
);

membershipEnterpriseRouter.post(
  "/membership-enterprise/self-service/requests/:id/approve",
  requirePermission("write", () => "memberships"),
  asyncHandler((req, res) => {
    res.json(membershipEnterpriseService.approveSelfServiceRequest(req.params.id, req.body, req.access));
  })
);

membershipEnterpriseRouter.post(
  "/membership-enterprise/self-service/requests/:id/reject",
  requirePermission("write", () => "memberships"),
  asyncHandler((req, res) => {
    res.json(membershipEnterpriseService.rejectSelfServiceRequest(req.params.id, req.body, req.access));
  })
);

membershipEnterpriseRouter.get(
  "/membership-enterprise/reports/commission",
  requirePermission("read", () => "memberships"),
  asyncHandler((req, res) => {
    res.json(membershipEnterpriseService.membershipCommissionReport(req.query, req.access));
  })
);

membershipEnterpriseRouter.get(
  "/membership-enterprise/reports/risk",
  requirePermission("read", () => "memberships"),
  asyncHandler((req, res) => {
    res.json(membershipEnterpriseService.membershipRiskReport(req.query, req.access));
  })
);

membershipEnterpriseRouter.get(
  "/membership-enterprise/rewards/ledger",
  requirePermission("read", () => "memberships"),
  asyncHandler((req, res) => {
    res.json(membershipEnterpriseService.rewardsLedger(req.query, req.access));
  })
);

membershipEnterpriseRouter.get(
  "/membership-enterprise/rewards/roi",
  requirePermission("read", () => "memberships"),
  asyncHandler((req, res) => {
    res.json(membershipEnterpriseService.rewardRoiReport(req.query, req.access));
  })
);

membershipEnterpriseRouter.get(
  "/membership-enterprise/rewards/expiring",
  requirePermission("read", () => "memberships"),
  asyncHandler((req, res) => {
    res.json(membershipEnterpriseService.expiringRewards(req.query, req.access));
  })
);

membershipEnterpriseRouter.get(
  "/membership-enterprise/rewards/abuse-alerts",
  requirePermission("read", () => "memberships"),
  asyncHandler((req, res) => {
    res.json(membershipEnterpriseService.rewardAbuseAlerts(req.query, req.access));
  })
);

membershipEnterpriseRouter.post(
  "/membership-enterprise/rewards/:clientId/send-expiry-reminder",
  requirePermission("write", () => "memberships"),
  asyncHandler((req, res) => {
    res.status(201).json(membershipEnterpriseService.sendRewardExpiryReminder(req.params.clientId, req.body, req.access));
  })
);

membershipEnterpriseRouter.get(
  "/membership-enterprise/reports/enterprise",
  requirePermission("read", () => "memberships"),
  asyncHandler((req, res) => {
    res.json(membershipEnterpriseService.membershipEnterpriseReports(req.query, req.access));
  })
);

membershipEnterpriseRouter.get(
  "/membership-enterprise/reports/redeem",
  requirePermission("read", () => "memberships"),
  asyncHandler((req, res) => {
    res.json(membershipEnterpriseService.membershipRedeemReport(req.query, req.access));
  })
);

membershipEnterpriseRouter.get(
  "/membership-enterprise/reports/sales-by-customer",
  requirePermission("read", () => "memberships"),
  asyncHandler((req, res) => {
    res.json(membershipEnterpriseService.membershipSalesByCustomerReport(req.query, req.access));
  })
);

membershipEnterpriseRouter.get(
  "/membership-enterprise/reports/export/csv",
  requirePermission("read", () => "memberships"),
  asyncHandler((req, res) => {
    const csv = membershipEnterpriseService.membershipReportsCsv(req.query, req.access);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="membership-enterprise-reports.csv"');
    res.send(csv);
  })
);

membershipEnterpriseRouter.get(
  "/membership-enterprise/reports/export/pdf",
  requirePermission("read", () => "memberships"),
  asyncHandler((req, res) => {
    const pdf = membershipEnterpriseService.membershipReportsPdf(req.query, req.access);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", 'attachment; filename="membership-enterprise-reports.pdf"');
    res.send(Buffer.from(pdf, "binary"));
  })
);

membershipEnterpriseRouter.post(
  "/membership-enterprise/risk-signals/:id/review",
  requirePermission("write", () => "memberships"),
  asyncHandler((req, res) => {
    res.json(membershipEnterpriseService.reviewMembershipRiskSignal(req.params.id, req.body, req.access));
  })
);
