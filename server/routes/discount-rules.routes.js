import { Router } from "express";
import { asyncHandler } from "../middleware/async-handler.js";
import { discountAuditLogRepo } from "../repositories/discount-audit-log.repo.js";
import { discountRulesRepo } from "../repositories/discount-rules.repo.js";
import { ruleApprovalsRepo } from "../repositories/rule-approvals.repo.js";
import { badRequest, forbidden, notFound } from "../utils/app-error.js";
import { checkApprovalNeeded, normalizeApprovalRole } from "../utils/approval-gate.js";
import { buildContext } from "../utils/context-builder.js";
import { policyAwareRulesEngine } from "../utils/policy-aware-rules-engine.js";
import { ruleConflictDetector } from "../utils/rule-conflict-detector.js";
import { emitDiscountWebhook } from "../utils/webhook-dispatcher.js";

export const discountRulesRouter = Router();

const VALID_STATUSES = new Set(["draft", "pending_approval", "active", "paused", "expired"]);

function scope(req) {
  return {
    tenantId: req.header("x-tenant-id") || req.access?.tenantId || req.body?.tenantId || req.query?.tenantId || "",
    branchId: req.header("x-branch-id") || req.access?.branchId || req.body?.branchId || req.query?.branchId || "",
    role: req.header("x-user-role") || req.access?.role || "",
    userId: req.access?.userId || req.header("x-user-id") || ""
  };
}

function requireScope(req) {
  const current = scope(req);
  if (!current.tenantId || !current.branchId) throw badRequest("tenantId and branchId are required");
  return current;
}

function idScope(req) {
  const id = Number.parseInt(req.params.id, 10);
  if (!id) throw badRequest("valid rule id is required");
  return { ...requireScope(req), id };
}

function requireRule(rule) {
  if (!rule) throw notFound("Discount rule not found");
  return rule;
}

function bodyWithScope(req) {
  const current = requireScope(req);
  return {
    ...req.body,
    tenantId: current.tenantId,
    branchId: current.branchId,
    createdBy: req.body.createdBy || current.userId || null
  };
}

function approvalGate(body, current) {
  const check = checkApprovalNeeded({
    role: current.role,
    rule: body,
    requestedStatus: body.status
  });
  if (!check.approvalNeeded) return { body, check, approvalNeeded: false };
  return {
    body: { ...body, status: "pending_approval" },
    check,
    approvalNeeded: true
  };
}

function createApproval(rule, check, current, note = "") {
  return ruleApprovalsRepo.create({
    tenantId: current.tenantId,
    branchId: current.branchId,
    ruleId: rule.id,
    requestedBy: current.userId,
    requestedRole: check.role,
    requestedPercent: check.requestedPercent,
    roleLimitPercent: check.roleLimitPercent,
    requestedStatus: "active",
    note: note || `Requested active rule at ${check.requestedPercent}% over ${check.roleLimitPercent}% role limit`,
    ruleSnapshot: rule
  });
}

function ensureApprover(current) {
  const role = normalizeApprovalRole(current.role);
  if (!new Set(["regional_head", "admin", "owner"]).has(role)) {
    throw forbidden("Discount rule approvals require regional_head, admin or owner access");
  }
  return role;
}

function audit(eventType, current, payload = {}) {
  try {
    discountAuditLogRepo.log({
      tenantId: current.tenantId,
      branchId: current.branchId,
      actorUserId: current.userId,
      actorRole: current.role,
      eventType,
      gstImpactPaise: 0,
      gstImpactNote: "Rule administration event; GST delta unavailable and stored as 0.",
      ...payload
    });
  } catch {
    // Audit logging is best-effort and should not block rule administration.
  }
  if (new Set(["rule_created", "rule_updated", "rule_approved", "rule_rejected"]).has(eventType)) {
    void emitDiscountWebhook(eventType, current, {
      eventKey: `${eventType}:${payload.ruleId || "rule"}:${Date.now()}`,
      data: {
        ruleId: payload.ruleId || null,
        note: payload.note || "",
        metadata: payload.metadata || {}
      }
    });
  }
}

discountRulesRouter.post(
  "/evaluate",
  asyncHandler(async (req, res) => {
    const current = requireScope(req);
    const context = await buildContext({
      ...req.body,
      tenantId: current.tenantId,
      branchId: current.branchId,
      cartItems: req.body.cartItems || req.body.items || []
    });
    res.json({
      context,
      ...policyAwareRulesEngine.evaluate({
        ...context,
        policyScopeBranchId: req.body.policyScopeBranchId || req.header("x-policy-scope-branch-id") || undefined,
        actorUserId: current.userId,
        actorRole: current.role,
        auditDiscountApplication: Boolean(req.body.auditDiscountApplication || req.body.recordAudit || req.body.source === "discount_application"),
        auditSource: req.body.source || "discount-rules/evaluate"
      })
    });
  })
);

discountRulesRouter.get(
  "/",
  asyncHandler((req, res) => {
    const current = requireScope(req);
    const status = VALID_STATUSES.has(req.query.status) ? req.query.status : undefined;
    res.json(discountRulesRepo.list({
      tenantId: current.tenantId,
      branchId: current.branchId,
      status,
      limit: req.query.limit,
      offset: req.query.offset
    }));
  })
);

discountRulesRouter.get(
  "/conflicts",
  asyncHandler((req, res) => {
    const current = requireScope(req);
    const status = VALID_STATUSES.has(req.query.status) ? req.query.status : undefined;
    const rows = discountRulesRepo.list({
      tenantId: current.tenantId,
      branchId: current.branchId,
      status,
      limit: req.query.limit || 500,
      offset: req.query.offset
    }).rows;
    const result = ruleConflictDetector.detect(rows);
    res.json({
      ...result,
      scope: { tenantId: current.tenantId, branchId: current.branchId },
      status: status || "all"
    });
  })
);

discountRulesRouter.post(
  "/conflicts/check",
  asyncHandler((req, res) => {
    const current = requireScope(req);
    const rows = discountRulesRepo.list({
      tenantId: current.tenantId,
      branchId: current.branchId,
      limit: 500,
      offset: 0
    }).rows;
    const draft = {
      ...req.body,
      tenantId: current.tenantId,
      branchId: current.branchId,
      id: req.body?.id || "draft",
      name: req.body?.name || "Draft rule",
      status: req.body?.status || "draft"
    };
    const result = ruleConflictDetector.detect([draft, ...rows]);
    res.json({
      ...result,
      draftConflictCount: result.conflicts.filter((row) => row.ruleIds.includes(draft.id)).length,
      conflicts: result.conflicts.filter((row) => row.ruleIds.includes(draft.id))
    });
  })
);

discountRulesRouter.post(
  "/",
  asyncHandler((req, res) => {
    const current = requireScope(req);
    const body = bodyWithScope(req);
    if (!body.name) throw badRequest("rule name is required");
    const gated = approvalGate(body, current);
    const rule = discountRulesRepo.create(gated.body);
    const approval = gated.approvalNeeded ? createApproval(rule, gated.check, current, req.body.approvalNote) : null;
    audit("rule_created", current, {
      ruleId: rule.id,
      note: approval ? "Rule created pending approval due to role discount limit." : "Rule created.",
      metadata: { rule, approvalRequired: Boolean(approval), approvalGate: gated.check }
    });
    res.status(201).json(approval ? { ...rule, approvalRequired: true, approval } : rule);
  })
);

discountRulesRouter.get(
  "/approvals/pending",
  asyncHandler((req, res) => {
    const current = requireScope(req);
    ensureApprover(current);
    res.json(ruleApprovalsRepo.listPending({
      tenantId: current.tenantId,
      branchId: current.branchId,
      limit: req.query.limit,
      offset: req.query.offset
    }));
  })
);

discountRulesRouter.post(
  "/approvals/:id/approve",
  asyncHandler((req, res) => {
    const current = requireScope(req);
    ensureApprover(current);
    const approval = requireRule(ruleApprovalsRepo.getById({ ...current, id: req.params.id }));
    if (approval.status !== "pending") throw badRequest("approval request is not pending");
    const changes = discountRulesRepo.updateStatus({ ...current, id: approval.ruleId, status: "active" });
    if (!changes) throw notFound("Discount rule not found");
    const decisionNote = req.body?.note || req.body?.decisionNote || "";
    const decided = ruleApprovalsRepo.approve({
      ...current,
      id: approval.id,
      decidedBy: current.userId,
      decisionNote
    });
    const rule = requireRule(discountRulesRepo.getById({ ...current, id: approval.ruleId }));
    audit("rule_approved", current, {
      ruleId: approval.ruleId,
      note: decisionNote || "Rule approved and activated.",
      metadata: { approval: decided, rule }
    });
    res.json({ approval: decided, rule });
  })
);

discountRulesRouter.post(
  "/approvals/:id/reject",
  asyncHandler((req, res) => {
    const current = requireScope(req);
    ensureApprover(current);
    const approval = requireRule(ruleApprovalsRepo.getById({ ...current, id: req.params.id }));
    if (approval.status !== "pending") throw badRequest("approval request is not pending");
    const changes = discountRulesRepo.updateStatus({ ...current, id: approval.ruleId, status: "draft" });
    if (!changes) throw notFound("Discount rule not found");
    const decisionNote = req.body?.note || req.body?.decisionNote || "";
    const decided = ruleApprovalsRepo.reject({
      ...current,
      id: approval.id,
      decidedBy: current.userId,
      decisionNote
    });
    const rule = requireRule(discountRulesRepo.getById({ ...current, id: approval.ruleId }));
    audit("rule_rejected", current, {
      ruleId: approval.ruleId,
      note: decisionNote || "Rule rejected and returned to draft.",
      metadata: { approval: decided, rule }
    });
    res.json({ approval: decided, rule });
  })
);

discountRulesRouter.get(
  "/:id",
  asyncHandler((req, res) => {
    res.json(requireRule(discountRulesRepo.getById(idScope(req))));
  })
);

discountRulesRouter.patch(
  "/:id",
  asyncHandler((req, res) => {
    const current = idScope(req);
    const gated = approvalGate({ ...bodyWithScope(req), id: current.id }, current);
    const rule = requireRule(discountRulesRepo.update(gated.body));
    const approval = gated.approvalNeeded ? createApproval(rule, gated.check, current, req.body.approvalNote) : null;
    audit("rule_updated", current, {
      ruleId: rule.id,
      note: approval ? "Rule updated and moved to pending approval." : "Rule updated.",
      metadata: { rule, approvalRequired: Boolean(approval), approvalGate: gated.check }
    });
    res.json(approval ? { ...rule, approvalRequired: true, approval } : rule);
  })
);

discountRulesRouter.patch(
  "/:id/status",
  asyncHandler((req, res) => {
    if (!VALID_STATUSES.has(req.body.status)) throw badRequest("invalid rule status");
    const current = idScope(req);
    const currentRule = requireRule(discountRulesRepo.getById(current));
    const gated = approvalGate({ ...currentRule, status: req.body.status }, current);
    const changes = discountRulesRepo.updateStatus({ ...current, status: gated.body.status });
    if (!changes) throw notFound("Discount rule not found");
    const approval = gated.approvalNeeded ? createApproval({ ...currentRule, status: "pending_approval" }, gated.check, current, req.body.approvalNote) : null;
    if (gated.body.status === "paused") {
      audit("rule_paused", current, {
        ruleId: currentRule.id,
        note: "Rule paused.",
        metadata: { previousStatus: currentRule.status, requestedStatus: req.body.status }
      });
    } else if (approval) {
      audit("rule_updated", current, {
        ruleId: currentRule.id,
        note: "Rule activation moved to pending approval.",
        metadata: { previousStatus: currentRule.status, requestedStatus: req.body.status, approvalGate: gated.check }
      });
    }
    res.json(approval ? { changes, approvalRequired: true, approval } : { changes });
  })
);

discountRulesRouter.delete(
  "/:id",
  asyncHandler((req, res) => {
    const current = idScope(req);
    const rule = requireRule(discountRulesRepo.getById(current));
    const changes = discountRulesRepo.remove(current);
    if (!changes) throw notFound("Discount rule not found");
    audit("rule_deleted", current, {
      ruleId: rule.id,
      note: "Rule deleted.",
      metadata: { rule }
    });
    res.json({ changes });
  })
);
