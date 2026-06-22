import { Router } from "express";
import { asyncHandler } from "../middleware/async-handler.js";
import { db } from "../db.js";
import { happyHoursRepo } from "../repositories/happy-hours.repo.js";
import { flashSaleRepo } from "../repositories/flash-sale.repo.js";
import { hhBundlesRepo } from "../repositories/hh-bundles.repo.js";
import { hhDurationTiersRepo } from "../repositories/hh-duration-tiers.repo.js";
import { badRequest, notFound } from "../utils/app-error.js";
import { billingHappyHours } from "../utils/billing-happy-hours.middleware.js";
import { buildUpcomingHappyHoursSchedule, servicesPricingForHappyHours } from "../utils/happy-hours-portal-enrichment.js";
import { happyHoursEngine } from "../utils/happy-hours-engine.js";

export const happyHoursRouter = Router();

const VALID_STATUSES = new Set(["active", "inactive"]);

function scope(req) {
  return {
    tenantId: req.header("x-tenant-id") || req.access?.tenantId || req.body?.tenantId || req.query?.tenantId || "",
    branchId: req.header("x-branch-id") || req.access?.branchId || req.body?.branchId || req.body?.branch_id || req.query?.branchId || req.query?.branch_id || "",
    role: req.header("x-user-role") || req.access?.role || ""
  };
}

function requireScope(req) {
  const current = scope(req);
  if (!current.tenantId || !current.branchId) {
    throw badRequest("tenantId and branchId are required");
  }
  return current;
}

function idScope(req) {
  const id = Number.parseInt(req.params.id, 10);
  if (!id) throw badRequest("valid happy hour id is required");
  return { ...requireScope(req), id };
}

function requireHappyHour(row) {
  if (!row) throw notFound("Happy hour not found");
  return row;
}

function payload(req) {
  return { ...req.body, ...requireScope(req) };
}

// PUBLIC - no auth middleware
happyHoursRouter.get(
  "/active-now",
  asyncHandler((req, res) => {
    const current = requireScope(req);
    res.json(happyHoursEngine.getActiveHappyHours(current));
  })
);

happyHoursRouter.post(
  "/preview-cart",
  asyncHandler((req, res) => {
    const current = requireScope(req);
    res.json(billingHappyHours.processHappyHoursForInvoice({
      tenantId: current.tenantId,
      branchId: current.branchId,
      items: req.body.items || [],
      bypass: req.body.bypassHappyHours === true || req.body.bypass === true,
      groupSize: req.body.groupSize
    }));
  })
);

happyHoursRouter.get(
  "/flash-sales/active",
  asyncHandler((req, res) => {
    const current = requireScope(req);
    flashSaleRepo.expireOld(current);
    res.json(flashSaleRepo.listActive(current));
  })
);

happyHoursRouter.post(
  "/flash-sales",
  asyncHandler((req, res) => {
    const current = requireScope(req);
    const expiresAt = req.body.expiresAt || Math.floor(Date.now() / 1000) + 90 * 60;
    res.status(201).json(flashSaleRepo.create({ ...req.body, ...current, expiresAt }));
  })
);

// PUBLIC - used by booking portal to show the next 7 days schedule.
happyHoursRouter.get(
  "/upcoming",
  asyncHandler((req, res) => {
    res.json(buildUpcomingHappyHoursSchedule(requireScope(req), 7));
  })
);

// PUBLIC - used by booking portal to mark currently discounted services.
happyHoursRouter.get(
  "/services-pricing",
  asyncHandler((req, res) => {
    const serviceIds = String(req.query.serviceIds || "")
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean);
    res.json(servicesPricingForHappyHours(serviceIds, requireScope(req)));
  })
);

happyHoursRouter.get(
  "/reports/summary",
  asyncHandler((req, res) => {
    const current = requireScope(req);
    const from = req.query.from || null;
    const to = req.query.to || null;
    const summary = db.prepare(`
      SELECT
        hha.happyHourName,
        COUNT(DISTINCT hha.invoiceId) AS invoiceCount,
        SUM(hha.totalDiscountPaise) AS totalDiscountPaise
      FROM happyHoursAudit hha
      WHERE hha.tenantId = @tenantId
        AND hha.branchId = @branchId
        AND (@from IS NULL OR datetime(hha.appliedAt, 'unixepoch') >= @from)
        AND (@to IS NULL OR datetime(hha.appliedAt, 'unixepoch') <= @to)
      GROUP BY hha.happyHourId, hha.happyHourName
      ORDER BY totalDiscountPaise DESC
    `).all({ tenantId: current.tenantId, branchId: current.branchId, from, to });
    res.json({
      summary,
      grandTotalDiscountPaise: summary.reduce((sum, row) => sum + Number(row.totalDiscountPaise || 0), 0)
    });
  })
);

happyHoursRouter.get(
  "/bundles",
  asyncHandler((req, res) => {
    res.json(hhBundlesRepo.listBundles(requireScope(req)));
  })
);

happyHoursRouter.post(
  "/bundles",
  asyncHandler((req, res) => {
    const body = payload(req);
    if (!body.name) throw badRequest("bundle name is required");
    if (!Array.isArray(body.serviceIds) || body.serviceIds.length < 2) throw badRequest("at least two serviceIds are required");
    res.status(201).json(hhBundlesRepo.createBundle(body));
  })
);

happyHoursRouter.get(
  "/bundles/active-now",
  asyncHandler((req, res) => {
    res.json(hhBundlesRepo.getActiveHHBundles(requireScope(req)));
  })
);

happyHoursRouter.delete(
  "/bundles/:bundleId",
  asyncHandler((req, res) => {
    const current = requireScope(req);
    const id = Number.parseInt(req.params.bundleId, 10);
    const changes = hhBundlesRepo.removeBundle({ ...current, id });
    if (!changes) throw notFound("Bundle not found");
    res.json({ changes });
  })
);

happyHoursRouter.get(
  "/:id/duration-tiers",
  asyncHandler((req, res) => {
    res.json(hhDurationTiersRepo.list(idScope(req)));
  })
);

happyHoursRouter.post(
  "/:id/duration-tiers",
  asyncHandler((req, res) => {
    const current = idScope(req);
    res.status(201).json(hhDurationTiersRepo.create({
      ...req.body,
      tenantId: current.tenantId,
      branchId: current.branchId,
      happyHourId: current.id
    }));
  })
);

happyHoursRouter.delete(
  "/:id/duration-tiers/:tierId",
  asyncHandler((req, res) => {
    const current = idScope(req);
    const changes = hhDurationTiersRepo.remove({
      ...current,
      happyHourId: current.id,
      id: Number.parseInt(req.params.tierId, 10)
    });
    if (!changes) throw notFound("Duration tier not found");
    res.json({ changes });
  })
);

happyHoursRouter.get(
  "/",
  asyncHandler((req, res) => {
    const current = requireScope(req);
    const status = VALID_STATUSES.has(req.query.status) ? req.query.status : undefined;
    res.json(happyHoursRepo.list({
      ...current,
      status,
      limit: req.query.limit,
      offset: req.query.offset
    }));
  })
);

happyHoursRouter.post(
  "/",
  asyncHandler((req, res) => {
    const body = payload(req);
    if (!body.name || !body.startTime || !body.endTime) {
      throw badRequest("name, startTime and endTime are required");
    }
    res.status(201).json(happyHoursRepo.create(body));
  })
);

happyHoursRouter.get(
  "/:id",
  asyncHandler((req, res) => {
    res.json(requireHappyHour(happyHoursRepo.getById(idScope(req))));
  })
);

happyHoursRouter.patch(
  "/:id",
  asyncHandler((req, res) => {
    res.json(requireHappyHour(happyHoursRepo.update({ ...payload(req), id: idScope(req).id })));
  })
);

happyHoursRouter.patch(
  "/:id/toggle",
  asyncHandler((req, res) => {
    if (!VALID_STATUSES.has(req.body.status)) throw badRequest("status must be active or inactive");
    const result = happyHoursRepo.toggleStatus({ ...idScope(req), status: req.body.status });
    if (!result.changes) throw notFound("Happy hour not found");
    res.json(result);
  })
);

happyHoursRouter.delete(
  "/:id",
  asyncHandler((req, res) => {
    const changes = happyHoursRepo.remove(idScope(req));
    if (!changes) throw notFound("Happy hour not found");
    res.json({ changes });
  })
);
