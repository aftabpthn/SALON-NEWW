import { Router } from "express";
import { asyncHandler } from "../middleware/async-handler.js";
import { happyHoursControlTowerRepo } from "../repositories/happy-hours-control-tower.repo.js";
import { badRequest, notFound } from "../utils/app-error.js";

export const happyHoursControlTowerRouter = Router();
export const happyHoursPublicOffersRouter = Router();

function scope(req) {
  return {
    tenantId: req.header("x-tenant-id") || req.access?.tenantId || req.body?.tenantId || req.query?.tenantId || "",
    branchId: req.header("x-branch-id") || req.access?.branchId || req.body?.branchId || req.query?.branchId || "",
    userId: req.access?.userId || req.header("x-user-id") || ""
  };
}

function requireScope(req) {
  const current = scope(req);
  if (!current.tenantId || !current.branchId) throw badRequest("tenantId and branchId are required");
  return current;
}

function withScope(req) {
  const current = requireScope(req);
  return {
    ...req.body,
    tenantId: current.tenantId,
    branchId: current.branchId,
    createdBy: req.body?.createdBy || current.userId || null
  };
}

function idScope(req) {
  const current = requireScope(req);
  return { ...current, id: req.params.id };
}

function publicOfferScope(req) {
  return {
    ...requireScope(req),
    currentDate: req.query.currentDate || req.query.bookingDate,
    serviceId: req.query.serviceId,
    serviceCategory: req.query.serviceCategory,
    staffId: req.query.staffId,
    clientSegment: req.query.clientSegment,
    cartTotalPaise: req.query.cartTotalPaise || req.query.servicePricePaise || req.query.amountPaise
  };
}

function asBadRequest(error, fallback = "Invalid Happy Hours control tower request") {
  return badRequest(error.message || fallback);
}

function requireRow(row, message) {
  if (!row) throw notFound(message);
  return row;
}

happyHoursControlTowerRouter.get(
  "/summary",
  asyncHandler((req, res) => {
    res.json(happyHoursControlTowerRepo.getSummary({
      ...requireScope(req),
      from: req.query.from,
      to: req.query.to
    }));
  })
);

happyHoursControlTowerRouter.get(
  "/calendar",
  asyncHandler((req, res) => {
    res.json(happyHoursControlTowerRepo.listCalendar({
      ...requireScope(req),
      from: req.query.from,
      to: req.query.to,
      status: req.query.status,
      limit: req.query.limit,
      offset: req.query.offset
    }));
  })
);

happyHoursControlTowerRouter.post(
  "/calendar",
  asyncHandler((req, res) => {
    try {
      res.status(201).json(happyHoursControlTowerRepo.saveCalendar(withScope(req)));
    } catch (error) {
      throw asBadRequest(error);
    }
  })
);

happyHoursControlTowerRouter.patch(
  "/calendar/:id",
  asyncHandler((req, res) => {
    try {
      res.json(requireRow(happyHoursControlTowerRepo.updateCalendar({ ...withScope(req), id: req.params.id }), "Promotion not found"));
    } catch (error) {
      throw asBadRequest(error);
    }
  })
);

happyHoursControlTowerRouter.delete(
  "/calendar/:id",
  asyncHandler((req, res) => {
    const changes = happyHoursControlTowerRepo.deleteCalendar(idScope(req));
    if (!changes) throw notFound("Promotion not found");
    res.json({ changes });
  })
);

happyHoursControlTowerRouter.get(
  "/coupons",
  asyncHandler((req, res) => {
    res.json(happyHoursControlTowerRepo.listCoupons({
      ...requireScope(req),
      status: req.query.status,
      limit: req.query.limit,
      offset: req.query.offset
    }));
  })
);

happyHoursControlTowerRouter.post(
  "/coupons",
  asyncHandler((req, res) => {
    try {
      res.status(201).json(happyHoursControlTowerRepo.saveCoupon(withScope(req)));
    } catch (error) {
      throw asBadRequest(error);
    }
  })
);

happyHoursControlTowerRouter.patch(
  "/coupons/:id",
  asyncHandler((req, res) => {
    try {
      res.json(requireRow(happyHoursControlTowerRepo.updateCoupon({ ...withScope(req), id: req.params.id }), "Coupon not found"));
    } catch (error) {
      throw asBadRequest(error);
    }
  })
);

happyHoursControlTowerRouter.delete(
  "/coupons/:id",
  asyncHandler((req, res) => {
    const changes = happyHoursControlTowerRepo.deleteCoupon(idScope(req));
    if (!changes) throw notFound("Coupon not found");
    res.json({ changes });
  })
);

happyHoursControlTowerRouter.post(
  "/coupons/validate",
  asyncHandler((req, res) => {
    try {
      res.json(happyHoursControlTowerRepo.validateCoupon(withScope(req)));
    } catch (error) {
      throw asBadRequest(error);
    }
  })
);

happyHoursControlTowerRouter.post(
  "/coupons/use",
  asyncHandler((req, res) => {
    try {
      res.json(happyHoursControlTowerRepo.recordCouponUse(withScope(req)));
    } catch (error) {
      throw asBadRequest(error);
    }
  })
);

happyHoursControlTowerRouter.get(
  "/roi",
  asyncHandler((req, res) => {
    res.json(happyHoursControlTowerRepo.getOfferRoi({
      ...requireScope(req),
      from: req.query.from,
      to: req.query.to
    }));
  })
);

happyHoursControlTowerRouter.post(
  "/roi/outcome",
  asyncHandler((req, res) => {
    try {
      res.status(201).json(happyHoursControlTowerRepo.recordRoiOutcome(withScope(req)));
    } catch (error) {
      throw asBadRequest(error);
    }
  })
);

happyHoursControlTowerRouter.get(
  "/segments",
  asyncHandler((req, res) => {
    res.json(happyHoursControlTowerRepo.listSegments({
      ...requireScope(req),
      status: req.query.status,
      limit: req.query.limit,
      offset: req.query.offset
    }));
  })
);

happyHoursControlTowerRouter.post(
  "/segments",
  asyncHandler((req, res) => {
    try {
      res.status(201).json(happyHoursControlTowerRepo.saveSegment(withScope(req)));
    } catch (error) {
      throw asBadRequest(error);
    }
  })
);

happyHoursControlTowerRouter.patch(
  "/segments/:id",
  asyncHandler((req, res) => {
    try {
      res.json(requireRow(happyHoursControlTowerRepo.updateSegment({ ...withScope(req), id: req.params.id }), "Client segment not found"));
    } catch (error) {
      throw asBadRequest(error);
    }
  })
);

happyHoursControlTowerRouter.delete(
  "/segments/:id",
  asyncHandler((req, res) => {
    const changes = happyHoursControlTowerRepo.deleteSegment(idScope(req));
    if (!changes) throw notFound("Client segment not found");
    res.json({ changes });
  })
);

happyHoursControlTowerRouter.post(
  "/segments/evaluate",
  asyncHandler((req, res) => {
    try {
      res.json(happyHoursControlTowerRepo.evaluateSegments(withScope(req)));
    } catch (error) {
      throw asBadRequest(error);
    }
  })
);

happyHoursControlTowerRouter.get(
  "/staff-incentives",
  asyncHandler((req, res) => {
    res.json(happyHoursControlTowerRepo.listStaffIncentives({
      ...requireScope(req),
      status: req.query.status,
      staffId: req.query.staffId,
      limit: req.query.limit,
      offset: req.query.offset
    }));
  })
);

happyHoursControlTowerRouter.post(
  "/staff-incentives",
  asyncHandler((req, res) => {
    try {
      res.status(201).json(happyHoursControlTowerRepo.saveStaffIncentive(withScope(req)));
    } catch (error) {
      throw asBadRequest(error);
    }
  })
);

happyHoursControlTowerRouter.patch(
  "/staff-incentives/:id",
  asyncHandler((req, res) => {
    try {
      res.json(requireRow(happyHoursControlTowerRepo.updateStaffIncentive({ ...withScope(req), id: req.params.id }), "Staff incentive not found"));
    } catch (error) {
      throw asBadRequest(error);
    }
  })
);

happyHoursControlTowerRouter.get(
  "/whatsapp-drafts",
  asyncHandler((req, res) => {
    res.json(happyHoursControlTowerRepo.listWhatsappDrafts({
      ...requireScope(req),
      status: req.query.status,
      limit: req.query.limit,
      offset: req.query.offset
    }));
  })
);

happyHoursControlTowerRouter.post(
  "/whatsapp-drafts",
  asyncHandler((req, res) => {
    try {
      res.status(201).json(happyHoursControlTowerRepo.saveWhatsappDraft(withScope(req)));
    } catch (error) {
      throw asBadRequest(error);
    }
  })
);

happyHoursControlTowerRouter.patch(
  "/whatsapp-drafts/:id",
  asyncHandler((req, res) => {
    try {
      res.json(requireRow(happyHoursControlTowerRepo.updateWhatsappDraft({ ...withScope(req), id: req.params.id }), "WhatsApp draft not found"));
    } catch (error) {
      throw asBadRequest(error);
    }
  })
);

happyHoursControlTowerRouter.post(
  "/whatsapp-drafts/from-rule/:ruleId",
  asyncHandler((req, res) => {
    try {
      res.status(201).json(happyHoursControlTowerRepo.createWhatsappDraftFromRule({
        ...withScope(req),
        ruleId: req.params.ruleId
      }));
    } catch (error) {
      throw asBadRequest(error);
    }
  })
);

happyHoursControlTowerRouter.get(
  "/abuse-alerts",
  asyncHandler((req, res) => {
    res.json(happyHoursControlTowerRepo.listAbuseAlerts({
      ...requireScope(req),
      status: req.query.status,
      severity: req.query.severity,
      limit: req.query.limit,
      offset: req.query.offset
    }));
  })
);

happyHoursControlTowerRouter.post(
  "/abuse-alerts/scan",
  asyncHandler((req, res) => {
    try {
      res.json(happyHoursControlTowerRepo.scanAbuseAlerts({
        ...requireScope(req),
        from: req.body?.from || req.query?.from,
        to: req.body?.to || req.query?.to
      }));
    } catch (error) {
      throw asBadRequest(error);
    }
  })
);

happyHoursControlTowerRouter.patch(
  "/abuse-alerts/:id",
  asyncHandler((req, res) => {
    try {
      res.json(requireRow(happyHoursControlTowerRepo.reviewAbuseAlert({
        ...withScope(req),
        id: req.params.id,
        reviewedBy: req.body?.reviewedBy || scope(req).userId || null
      }), "Abuse alert not found"));
    } catch (error) {
      throw asBadRequest(error);
    }
  })
);

happyHoursControlTowerRouter.get(
  "/templates",
  asyncHandler((req, res) => {
    res.json(happyHoursControlTowerRepo.listTemplates({
      ...requireScope(req),
      limit: req.query.limit,
      offset: req.query.offset
    }));
  })
);

happyHoursControlTowerRouter.post(
  "/templates/:templateKey/create-rule",
  asyncHandler((req, res) => {
    try {
      res.status(201).json(happyHoursControlTowerRepo.createRuleFromTemplate({
        ...withScope(req),
        templateKey: req.params.templateKey
      }));
    } catch (error) {
      throw asBadRequest(error);
    }
  })
);

happyHoursControlTowerRouter.get(
  "/public-offers/preview",
  asyncHandler((req, res) => {
    res.json(happyHoursControlTowerRepo.publicOffers(publicOfferScope(req)));
  })
);

happyHoursPublicOffersRouter.get(
  "/",
  asyncHandler((req, res) => {
    res.json(happyHoursControlTowerRepo.publicOffers(publicOfferScope(req)));
  })
);
