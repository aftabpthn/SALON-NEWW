import crypto from "node:crypto";
import { db } from "../db.js";
import { ensureProfitActionQueueSchema } from "./profit-action-queue-schema.service.js";
import { profitIntelligenceService } from "./profit-intelligence.service.js";

const TERMINAL_STATUSES = new Set(["completed", "dismissed"]);
const VALID_STATUSES = new Set(["pending", "approved", "completed", "dismissed"]);
const PRIORITY_RANK = { high: 3, medium: 2, low: 1 };

function id(prefix = "pa") {
  return `${prefix}_${crypto.randomUUID().slice(0, 10)}`;
}

function scope(access = {}, query = {}) {
  return {
    tenantId: String(access.tenantId || query.tenantId || "default"),
    branchId: String(query.branchId ?? access.branchId ?? "")
  };
}

function nowIso() {
  return new Date().toISOString();
}

function json(value = {}) {
  return JSON.stringify(value || {});
}

function parseJson(value = "{}") {
  try {
    return JSON.parse(value || "{}");
  } catch {
    return {};
  }
}

function rowToAction(row = {}) {
  return {
    id: row.id,
    tenantId: row.tenantId,
    branchId: row.branchId,
    type: row.type,
    title: row.title,
    message: row.message,
    impactPaise: Number(row.impactPaise || 0),
    priority: row.priority || "medium",
    status: row.status || "pending",
    sourceType: row.sourceType || "",
    sourceId: row.sourceId || "",
    payload: parseJson(row.payloadJson),
    createdAt: row.createdAt || "",
    updatedAt: row.updatedAt || "",
    approvedAt: row.approvedAt || "",
    completedAt: row.completedAt || ""
  };
}

function priorityFor(impactPaise = 0, severity = "") {
  const text = String(severity || "").toLowerCase();
  if (text === "high" || text === "red" || impactPaise >= 500000) return "high";
  if (text === "medium" || text === "amber" || impactPaise >= 100000) return "medium";
  return "low";
}

function safeText(value, fallback = "") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

export class ProfitActionQueueService {
  list(query = {}, access = {}) {
    ensureProfitActionQueueSchema();
    this.seedGeneratedActions(query, access);
    const params = {
      ...scope(access, query),
      status: safeText(query.status, "active")
    };
    const rows = db.prepare(`
      SELECT *
      FROM profit_action_queue
      WHERE tenantId = @tenantId
        AND (@branchId = '' OR branchId = @branchId)
        AND (
          @status = 'all'
          OR (@status = 'active' AND status NOT IN ('completed','dismissed'))
          OR status = @status
        )
      ORDER BY
        CASE priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END,
        impactPaise DESC,
        updatedAt DESC
      LIMIT 50
    `).all(params);
    return rows.map(rowToAction);
  }

  create(payload = {}, access = {}) {
    ensureProfitActionQueueSchema();
    const branchId = String(payload.branchId ?? access.branchId ?? "");
    return this.insertAction({
      tenantId: String(access.tenantId || "default"),
      branchId,
      type: safeText(payload.type, "manual_profit_action"),
      title: safeText(payload.title, "Profit action"),
      message: safeText(payload.message, "Manual profit action created by owner."),
      impactPaise: Math.round(Number(payload.impactPaise || 0)),
      priority: safeText(payload.priority, "medium"),
      status: "pending",
      sourceType: safeText(payload.sourceType, "manual"),
      sourceId: safeText(payload.sourceId, id("manual")),
      payload: payload.payload || {}
    });
  }

  approve(idValue, access = {}) {
    return this.transition(idValue, access, "approved", { approvedAt: nowIso() });
  }

  complete(idValue, access = {}) {
    return this.transition(idValue, access, "completed", { completedAt: nowIso() });
  }

  dismiss(idValue, access = {}) {
    return this.transition(idValue, access, "dismissed");
  }

  seedGeneratedActions(query = {}, access = {}) {
    const scoped = scope(access, query);
    const summary = profitIntelligenceService.summary(query, access);
    const breakdown = profitIntelligenceService.breakdown(query, access);
    const candidates = [
      ...this.lowMarginServiceActions(breakdown.serviceProfit || [], scoped),
      ...this.highWastageActions(summary.recipeVariance?.rows || [], scoped),
      ...this.highExpenseActions(summary, scoped),
      ...this.pricingRecommendationActions(summary.pricingAutopilot?.recommendations || [], scoped),
      ...this.discountAbuseActions(summary.profitLeaks || [], scoped),
      ...this.membershipRiskActions(summary.membershipRisk || [], scoped)
    ];
    for (const candidate of candidates) {
      this.upsertGeneratedAction(candidate);
    }
  }

  lowMarginServiceActions(rows = [], scoped = {}) {
    return rows
      .filter((row) => Number(row.revenuePaise || 0) > 0 && Number(row.netMarginBps || 0) < 2000)
      .slice(0, 4)
      .map((row) => {
        const targetProfitPaise = Math.round(Number(row.revenuePaise || 0) * 0.25);
        const impactPaise = Math.max(0, targetProfitPaise - Number(row.netProfitPaise || 0));
        return {
          ...scoped,
          type: "low_margin_service",
          title: `Review ${safeText(row.serviceName, "service")} margin`,
          message: `${safeText(row.serviceName, "Service")} net margin target se low hai; price, recipe aur staff cost review karein.`,
          impactPaise,
          priority: priorityFor(impactPaise),
          sourceType: "low_margin_service",
          sourceId: safeText(row.serviceId, safeText(row.serviceName, "service")),
          payload: row
        };
      });
  }

  highWastageActions(rows = [], scoped = {}) {
    return rows
      .filter((row) => ["red", "amber", "high", "medium"].includes(String(row.severity || "").toLowerCase()))
      .slice(0, 4)
      .map((row) => ({
        ...scoped,
        type: "high_wastage",
        title: `Audit ${safeText(row.productName || row.serviceName || row.staffName || row.branchId, "wastage")}`,
        message: row.recommendation || "Recipe variance high hai; product issue aur usage approval audit karein.",
        impactPaise: Math.max(0, Number(row.variancePaise || 0)),
        priority: priorityFor(Number(row.variancePaise || 0), row.severity),
        sourceType: "high_wastage",
        sourceId: `${row.dimension || "variance"}:${row.branchId || ""}:${row.serviceId || row.serviceName || ""}:${row.staffId || row.staffName || ""}:${row.productId || row.productName || ""}`,
        payload: row
      }));
  }

  highExpenseActions(summary = {}, scoped = {}) {
    const expense = summary.ceoKpis?.highestExpense || {};
    const amountPaise = Number(expense.amountPaise || 0);
    const revenuePaise = Number(summary.metrics?.revenuePaise || 0);
    if (!amountPaise || !revenuePaise || amountPaise / revenuePaise < 0.15) return [];
    return [{
      ...scoped,
      type: "high_expense",
      title: `Reduce ${safeText(expense.label, "highest expense")}`,
      message: `${safeText(expense.label, "Highest expense")} revenue ka high share consume kar raha hai; vendor, usage aur budget cap review karein.`,
      impactPaise: Math.round(amountPaise * 0.1),
      priority: priorityFor(Math.round(amountPaise * 0.1)),
      sourceType: "high_expense",
      sourceId: safeText(expense.label, "expense"),
      payload: expense
    }];
  }

  pricingRecommendationActions(rows = [], scoped = {}) {
    return rows
      .filter((row) => Number(row.expectedProfitLiftPaise || 0) > 0)
      .slice(0, 4)
      .map((row) => ({
        ...scoped,
        type: "pricing_recommendation",
        title: `Approve ${safeText(row.serviceName, "service")} price review`,
        message: row.reason || "Pricing Autopilot ne margin lift opportunity detect ki hai.",
        impactPaise: Number(row.expectedProfitLiftPaise || 0),
        priority: priorityFor(Number(row.expectedProfitLiftPaise || 0)),
        sourceType: "pricing_recommendation",
        sourceId: safeText(row.serviceId, safeText(row.serviceName, "service")),
        payload: row
      }));
  }

  discountAbuseActions(rows = [], scoped = {}) {
    return rows
      .filter((row) => row.type === "discount_abuse" || String(row.type || "").includes("discount"))
      .slice(0, 4)
      .map((row) => ({
        ...scoped,
        type: "discount_abuse",
        title: "Tighten discount approval",
        message: row.message || "Discount abuse signal detected; manual override and discount rules review karein.",
        impactPaise: Math.max(0, Number(row.estimatedImpactPaise || 0)),
        priority: priorityFor(Number(row.estimatedImpactPaise || 0), row.severity),
        sourceType: "discount_abuse",
        sourceId: safeText(row.sourceId, "discount_abuse"),
        payload: row
      }));
  }

  membershipRiskActions(rows = [], scoped = {}) {
    return rows
      .filter((row) => ["high", "medium"].includes(String(row.severity || "").toLowerCase()))
      .slice(0, 4)
      .map((row) => ({
        ...scoped,
        type: "membership_liability_risk",
        title: `Review ${safeText(row.planName, "membership")} liability`,
        message: row.recommendation || "Membership/package future liability risk high hai.",
        impactPaise: Math.abs(Math.min(0, Number(row.riskImpactPaise || 0))) || Number(row.remainingLiabilityPaise || 0),
        priority: priorityFor(Math.abs(Number(row.riskImpactPaise || 0)), row.severity),
        sourceType: "membership_liability_risk",
        sourceId: `${row.kind || "membership"}:${safeText(row.planName, "plan")}`,
        payload: row
      }));
  }

  upsertGeneratedAction(action = {}) {
    if (!action.tenantId || !action.type || !action.sourceType || !action.sourceId) return null;
    const existing = db.prepare(`
      SELECT *
      FROM profit_action_queue
      WHERE tenantId = @tenantId
        AND branchId = @branchId
        AND sourceType = @sourceType
        AND sourceId = @sourceId
      LIMIT 1
    `).get(action);
    if (existing) {
      if (TERMINAL_STATUSES.has(existing.status)) return rowToAction(existing);
      const nextPriority = PRIORITY_RANK[action.priority] > PRIORITY_RANK[existing.priority] ? action.priority : existing.priority;
      db.prepare(`
        UPDATE profit_action_queue
        SET title = @title,
            message = @message,
            impactPaise = @impactPaise,
            priority = @priority,
            payloadJson = @payloadJson,
            updatedAt = @updatedAt
        WHERE id = @id
      `).run({
        id: existing.id,
        title: action.title,
        message: action.message,
        impactPaise: Math.round(Number(action.impactPaise || 0)),
        priority: nextPriority || "medium",
        payloadJson: json(action.payload),
        updatedAt: nowIso()
      });
      return this.getById(existing.id, { tenantId: action.tenantId, branchId: action.branchId });
    }
    return this.insertAction(action);
  }

  insertAction(action = {}) {
    ensureProfitActionQueueSchema();
    const row = {
      id: action.id || id("pqa"),
      tenantId: action.tenantId,
      branchId: action.branchId || "",
      type: action.type,
      title: action.title,
      message: action.message || "",
      impactPaise: Math.round(Number(action.impactPaise || 0)),
      priority: ["high", "medium", "low"].includes(action.priority) ? action.priority : "medium",
      status: VALID_STATUSES.has(action.status) ? action.status : "pending",
      sourceType: action.sourceType || "",
      sourceId: action.sourceId || "",
      payloadJson: json(action.payload),
      createdAt: nowIso(),
      updatedAt: nowIso(),
      approvedAt: action.approvedAt || "",
      completedAt: action.completedAt || ""
    };
    db.prepare(`
      INSERT INTO profit_action_queue (
        id, tenantId, branchId, type, title, message, impactPaise, priority, status,
        sourceType, sourceId, payloadJson, createdAt, updatedAt, approvedAt, completedAt
      ) VALUES (
        @id, @tenantId, @branchId, @type, @title, @message, @impactPaise, @priority, @status,
        @sourceType, @sourceId, @payloadJson, @createdAt, @updatedAt, @approvedAt, @completedAt
      )
    `).run(row);
    return rowToAction(row);
  }

  transition(idValue, access = {}, status, extra = {}) {
    ensureProfitActionQueueSchema();
    const existing = this.getById(idValue, access);
    if (!existing) {
      const error = new Error("Profit action not found");
      error.status = 404;
      throw error;
    }
    if (TERMINAL_STATUSES.has(existing.status)) return existing;
    const next = {
      id: idValue,
      tenantId: String(access.tenantId || "default"),
      branchId: String(access.branchId || ""),
      status,
      updatedAt: nowIso(),
      approvedAt: extra.approvedAt || existing.approvedAt || "",
      completedAt: extra.completedAt || existing.completedAt || ""
    };
    db.prepare(`
      UPDATE profit_action_queue
      SET status = @status,
          updatedAt = @updatedAt,
          approvedAt = @approvedAt,
          completedAt = @completedAt
      WHERE id = @id
        AND tenantId = @tenantId
        AND (@branchId = '' OR branchId = @branchId)
    `).run(next);
    return this.getById(idValue, access);
  }

  getById(idValue, access = {}) {
    ensureProfitActionQueueSchema();
    const row = db.prepare(`
      SELECT *
      FROM profit_action_queue
      WHERE id = @id
        AND tenantId = @tenantId
        AND (@branchId = '' OR branchId = @branchId)
      LIMIT 1
    `).get({
      id: idValue,
      tenantId: String(access.tenantId || "default"),
      branchId: String(access.branchId || "")
    });
    return row ? rowToAction(row) : null;
  }
}

export const profitActionQueueService = new ProfitActionQueueService();
