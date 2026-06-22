import { Router } from "express";
import { asyncHandler } from "../middleware/async-handler.js";
import { happyHoursLifecycleRepo } from "../repositories/happy-hours-lifecycle.repo.js";
import { badRequest, notFound } from "../utils/app-error.js";

export const happyHoursLifecycleRouter = Router();

function scope(req) {
  return {
    tenantId: req.header("x-tenant-id") || req.access?.tenantId || req.body?.tenantId || req.query?.tenantId || "",
    branchId: req.header("x-branch-id") || req.access?.branchId || req.body?.branchId || req.query?.branchId || "",
    userId: req.access?.userId || req.header("x-user-id") || "",
    userRole: req.header("x-user-role") || req.access?.role || ""
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
    createdBy: req.body?.createdBy || current.userId || null,
    actorUserId: current.userId || null,
    actorRole: current.userRole || null
  };
}

function asBadRequest(error) {
  return badRequest(error.message || "Invalid Happy Hours lifecycle request");
}

happyHoursLifecycleRouter.get(
  "/summary",
  asyncHandler((req, res) => {
    try {
      res.json(happyHoursLifecycleRepo.getSummary({
        ...requireScope(req),
        from: req.query.from,
        to: req.query.to
      }));
    } catch (error) {
      throw asBadRequest(error);
    }
  })
);

happyHoursLifecycleRouter.get(
  "/roi-scores",
  asyncHandler((req, res) => {
    try {
      res.json(happyHoursLifecycleRepo.getRoiScores({
        ...requireScope(req),
        from: req.query.from,
        to: req.query.to
      }));
    } catch (error) {
      throw asBadRequest(error);
    }
  })
);

happyHoursLifecycleRouter.get(
  "/",
  asyncHandler((req, res) => {
    try {
      res.json(happyHoursLifecycleRepo.listLifecycles({
        ...requireScope(req),
        stage: req.query.stage,
        from: req.query.from,
        to: req.query.to,
        limit: req.query.limit,
        offset: req.query.offset
      }));
    } catch (error) {
      throw asBadRequest(error);
    }
  })
);

happyHoursLifecycleRouter.post(
  "/",
  asyncHandler((req, res) => {
    try {
      res.status(201).json(happyHoursLifecycleRepo.createLifecycle(withScope(req)));
    } catch (error) {
      throw asBadRequest(error);
    }
  })
);

happyHoursLifecycleRouter.get(
  "/:id",
  asyncHandler((req, res) => {
    try {
      const row = happyHoursLifecycleRepo.getLifecycle({
        ...requireScope(req),
        id: req.params.id,
        from: req.query.from,
        to: req.query.to
      });
      if (!row) throw notFound("Offer lifecycle not found");
      res.json(row);
    } catch (error) {
      if (error.statusCode === 404) throw error;
      throw asBadRequest(error);
    }
  })
);

happyHoursLifecycleRouter.patch(
  "/:id",
  asyncHandler((req, res) => {
    try {
      const row = happyHoursLifecycleRepo.updateLifecycle({
        ...withScope(req),
        id: req.params.id
      });
      if (!row) throw notFound("Offer lifecycle not found");
      res.json(row);
    } catch (error) {
      if (error.statusCode === 404) throw error;
      throw asBadRequest(error);
    }
  })
);

happyHoursLifecycleRouter.post(
  "/:id/transition",
  asyncHandler((req, res) => {
    try {
      const row = happyHoursLifecycleRepo.transitionLifecycle({
        ...withScope(req),
        id: req.params.id,
        stage: req.body?.stage,
        stageReason: req.body?.stageReason || req.body?.note
      });
      if (!row) throw notFound("Offer lifecycle not found");
      res.json(row);
    } catch (error) {
      if (error.statusCode === 404) throw error;
      throw asBadRequest(error);
    }
  })
);

happyHoursLifecycleRouter.get(
  "/:id/roi-score",
  asyncHandler((req, res) => {
    try {
      const row = happyHoursLifecycleRepo.getLifecycle({
        ...requireScope(req),
        id: req.params.id,
        from: req.query.from,
        to: req.query.to
      });
      if (!row) throw notFound("Offer lifecycle not found");
      res.json(row.roiScore);
    } catch (error) {
      if (error.statusCode === 404) throw error;
      throw asBadRequest(error);
    }
  })
);
