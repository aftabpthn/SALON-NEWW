import { Router } from "express";
import { authenticateJwt } from "../middleware/auth.js";
import { asyncHandler } from "../middleware/async-handler.js";
import {
  ensureCustomerSalonRelationshipSchema,
  getOrCreateRelationship,
  incrementVisitCount,
  getAllRelationships,
  getPrimarySalon,
  setPrimarySalon,
  removePrimarySalon,
  shouldPromptPrimarySalon,
} from "../services/customer-salon-relationship.service.js";

// Ensure schema on import
ensureCustomerSalonRelationshipSchema();

export const customerSalonRouter = Router();
customerSalonRouter.use("/customer/salons", authenticateJwt());

// ─── Get all salons this customer has visited ─────────────────────
// Intentionally cross-tenant: marketplace view shows all customer relationships
customerSalonRouter.get("/customer/salons", asyncHandler((req, res) => {
  const customerId = req.access?.userId || req.access?.uid || req.access?.customerId || "";
  if (!customerId) return res.status(401).json({ error: "Customer ID required" });

  const relationships = getAllRelationships(customerId);
  const primary = getPrimarySalon(customerId);
  const promptCheck = shouldPromptPrimarySalon(customerId);

  res.json({
    salons: relationships,
    primarySalon: primary || null,
    shouldPromptPrimary: promptCheck.prompt,
    suggestedSalon: promptCheck.suggestedSalon || null,
  });
}));

// ─── Set a salon as primary ───────────────────────────────────────
customerSalonRouter.post("/customer/salons/:tenantId/primary", asyncHandler((req, res) => {
  const customerId = req.access?.userId || req.access?.uid || req.access?.customerId || "";
  if (!customerId) return res.status(401).json({ error: "Customer ID required" });

  const { tenantId } = req.params;
  const { branchId, businessId, businessName, reason } = req.body || {};

  const result = setPrimarySalon({
    customerId,
    tenantId,
    branchId: branchId || "",
    businessId: businessId || "",
    businessName: businessName || "",
    reason: reason || "manual",
  });

  res.json({ primarySalon: result });
}));

// ─── Remove primary salon ─────────────────────────────────────────
customerSalonRouter.delete("/customer/salons/primary", asyncHandler((req, res) => {
  const customerId = req.access?.userId || req.access?.uid || req.access?.customerId || "";
  if (!customerId) return res.status(401).json({ error: "Customer ID required" });

  const tenantId = req.access?.tenantId || null;
  const result = removePrimarySalon(customerId, tenantId);
  res.json(result);
}));

// ─── Check if prompt needed ───────────────────────────────────────
customerSalonRouter.get("/customer/salons/primary/prompt", asyncHandler((req, res) => {
  const customerId = req.access?.userId || req.access?.uid || req.access?.customerId || "";
  if (!customerId) return res.status(401).json({ error: "Customer ID required" });

  const check = shouldPromptPrimarySalon(customerId);
  res.json(check);
}));

// ─── Record a visit (internal use, called after booking completion) ─
customerSalonRouter.post("/customer/salons/:tenantId/visit", asyncHandler((req, res) => {
  const customerId = req.access?.userId || req.access?.uid || req.access?.customerId || "";
  if (!customerId) return res.status(401).json({ error: "Customer ID required" });

  const { tenantId } = req.params;
  const { branchId, businessId, businessName } = req.body || {};

  // Upsert relationship
  getOrCreateRelationship({
    customerId,
    tenantId,
    branchId: branchId || "",
    businessId: businessId || "",
    businessName: businessName || "",
  });

  const updated = incrementVisitCount({ customerId, tenantId, branchId: branchId || "" });
  const promptCheck = shouldPromptPrimarySalon(customerId);

  res.json({
    relationship: updated,
    shouldPromptPrimary: promptCheck.prompt,
    suggestedSalon: promptCheck.suggestedSalon || null,
  });
}));
