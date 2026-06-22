import { Router } from "express";
import { asyncHandler } from "../middleware/async-handler.js";
import { discountWebhooksRepo } from "../repositories/discount-webhooks.repo.js";
import { badRequest } from "../utils/app-error.js";

export const discountWebhooksRouter = Router();

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

function asBadRequest(error) {
  return badRequest(error.message || "Invalid discount webhook request");
}

discountWebhooksRouter.get(
  "/",
  asyncHandler((req, res) => {
    const current = requireScope(req);
    res.json(discountWebhooksRepo.listWebhooks({
      ...current,
      status: req.query.status,
      limit: req.query.limit,
      offset: req.query.offset
    }));
  })
);

discountWebhooksRouter.post(
  "/",
  asyncHandler((req, res) => {
    const current = requireScope(req);
    try {
      const webhook = discountWebhooksRepo.registerWebhook({
        ...req.body,
        tenantId: current.tenantId,
        branchId: current.branchId,
        createdBy: req.body?.createdBy || current.userId || null
      });
      res.status(201).json(webhook);
    } catch (error) {
      throw asBadRequest(error);
    }
  })
);

discountWebhooksRouter.patch(
  "/:id",
  asyncHandler((req, res) => {
    const current = requireScope(req);
    try {
      res.json(discountWebhooksRepo.updateWebhook({
        ...req.body,
        tenantId: current.tenantId,
        branchId: current.branchId,
        id: req.params.id
      }));
    } catch (error) {
      throw asBadRequest(error);
    }
  })
);

discountWebhooksRouter.get(
  "/deliveries",
  asyncHandler((req, res) => {
    const current = requireScope(req);
    res.json(discountWebhooksRepo.listDeliveries({
      ...current,
      webhookId: req.query.webhookId,
      eventType: req.query.eventType,
      status: req.query.status,
      limit: req.query.limit,
      offset: req.query.offset
    }));
  })
);
