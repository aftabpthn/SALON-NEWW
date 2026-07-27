import { Router } from "express";
import { authenticateJwt } from "../middleware/auth.js";
import { asyncHandler } from "../middleware/async-handler.js";
import { badRequest } from "../utils/app-error.js";
import { db, tableHasColumn } from "../db.js";
import {
  getAccountById,
  getLinkedClients,
  getPendingFlags,
  resolveFlag,
  updateProfile,
  getLinkAuditLog,
} from "../services/customer-identity.service.js";

export const customerIdentityRouter = Router();

// All routes require authentication
customerIdentityRouter.use("/customer/account", authenticateJwt());

/**
 * Resolve globalAccountId: first from JWT (if set), else from clients record.
 */
function resolveGlobalAccountId(req) {
  const jwtAccountId = req.access?.globalAccountId || "";
  if (jwtAccountId) return jwtAccountId;

  // Fallback: look up from clients record
  const userId = req.access?.userId || "";
  const tenantId = req.access?.tenantId || "";
  if (!userId || !tenantId) return "";
  if (!tableHasColumn("clients", "customerAccountId")) return "";

  const row = db.prepare("SELECT customerAccountId FROM clients WHERE id = @id AND tenantId = @tenantId LIMIT 1").get({ id: userId, tenantId });
  return row?.customerAccountId || "";
}

// ─── Get global account profile ──────────────────────────────────────
customerIdentityRouter.get("/customer/account", asyncHandler((req, res) => {
  const accountId = resolveGlobalAccountId(req);
  if (!accountId) return res.status(200).json({ linked: false, message: "No global account linked yet" });

  const account = getAccountById(accountId);
  if (!account) return res.status(404).json({ error: "Account not found" });

  res.json({
    id: account.id,
    name: account.name,
    phone: account.phone,
    email: account.email,
    dateOfBirth: account.date_of_birth || "",
    gender: account.gender || "",
    profileImage: account.profile_image || "",
    authProvider: account.auth_provider || "",
    status: account.status || "active",
    createdAt: account.created_at,
    updatedAt: account.updated_at
  });
}));

// ─── Update global account profile ───────────────────────────────────
customerIdentityRouter.patch("/customer/account", asyncHandler((req, res) => {
  const accountId = resolveGlobalAccountId(req);
  if (!accountId) return res.status(401).json({ error: "Global account required" });

  const { name, dateOfBirth, gender, profileImage } = req.body || {};
  const updated = updateProfile(accountId, { name, dateOfBirth, gender, profileImage });
  if (!updated) return res.status(404).json({ error: "Account not found" });

  res.json({
    id: updated.id,
    name: updated.name,
    phone: updated.phone,
    email: updated.email,
    dateOfBirth: updated.date_of_birth || "",
    gender: updated.gender || "",
    profileImage: updated.profile_image || "",
    updatedAt: updated.updated_at
  });
}));

// ─── Get linked salon client records ─────────────────────────────────
customerIdentityRouter.get("/customer/account/linked-salons", asyncHandler((req, res) => {
  const accountId = resolveGlobalAccountId(req);
  if (!accountId) return res.status(200).json({ salons: [] });

  const clients = getLinkedClients(accountId);
  res.json({ salons: clients });
}));

// ─── Get pending link flags (ambiguous matches) ──────────────────────
customerIdentityRouter.get("/customer/account/link-flags", asyncHandler((req, res) => {
  const accountId = resolveGlobalAccountId(req);
  if (!accountId) return res.status(200).json({ flags: [] });

  const flags = getPendingFlags(accountId);
  res.json({ flags: flags.map((f) => ({
    id: f.id,
    candidateClientIds: JSON.parse(f.candidate_client_ids || "[]"),
    matchField: f.match_field,
    status: f.status,
    createdAt: f.created_at
  }))});
}));

// ─── Resolve a link flag ─────────────────────────────────────────────
customerIdentityRouter.post("/customer/account/link-flags/:flagId/resolve", asyncHandler((req, res) => {
  const accountId = resolveGlobalAccountId(req);
  if (!accountId) return res.status(401).json({ error: "Global account required" });

  const { flagId } = req.params;
  const { accept } = req.body || {};
  if (typeof accept !== "boolean") throw badRequest("accept must be true or false");

  const result = resolveFlag(flagId, { accept, resolvedBy: accountId });
  if (!result) return res.status(404).json({ error: "Flag not found" });

  res.json(result);
}));

// ─── Get link audit log ──────────────────────────────────────────────
customerIdentityRouter.get("/customer/account/audit-log", asyncHandler((req, res) => {
  const accountId = resolveGlobalAccountId(req);
  if (!accountId) return res.status(200).json({ auditLog: [] });

  const log = getLinkAuditLog(accountId);
  res.json({ auditLog: log.map((l) => ({
    id: l.id,
    clientId: l.client_id,
    tenantId: l.tenant_id,
    action: l.action,
    matchField: l.match_field,
    confidence: l.confidence,
    details: JSON.parse(l.details || "{}"),
    createdAt: l.created_at
  }))});
}));
