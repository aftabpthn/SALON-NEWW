import { Router } from "express";
import { asyncHandler } from "../middleware/async-handler.js";
import { discountSimulationsRepo } from "../repositories/discount-simulations.repo.js";
import { simulateDigitalTwin } from "../utils/digital-twin-simulator.js";
import { simulateDiscount } from "../utils/discount-simulator.js";
import { badRequest, notFound } from "../utils/app-error.js";

export const discountSimulationsRouter = Router();

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
  return badRequest(error.message || "Invalid discount simulation request");
}

discountSimulationsRouter.post(
  "/run",
  asyncHandler((req, res) => {
    const current = requireScope(req);
    try {
      res.json(simulateDiscount({
        ...req.body,
        tenantId: current.tenantId,
        branchId: current.branchId
      }));
    } catch (error) {
      throw asBadRequest(error);
    }
  })
);

discountSimulationsRouter.post(
  "/digital-twin",
  asyncHandler((req, res) => {
    const current = requireScope(req);
    try {
      res.json(simulateDigitalTwin({
        ...req.body,
        tenantId: current.tenantId,
        branchId: current.branchId
      }));
    } catch (error) {
      throw asBadRequest(error);
    }
  })
);

discountSimulationsRouter.post(
  "/",
  asyncHandler((req, res) => {
    const current = requireScope(req);
    try {
      const result = req.body?.result || simulateDiscount({
        ...req.body,
        tenantId: current.tenantId,
        branchId: current.branchId
      });
      const simulation = discountSimulationsRepo.saveSimulation({
        ...req.body,
        tenantId: current.tenantId,
        branchId: current.branchId,
        result,
        createdBy: req.body?.createdBy || current.userId || null
      });
      res.status(201).json(simulation);
    } catch (error) {
      throw asBadRequest(error);
    }
  })
);

discountSimulationsRouter.get(
  "/",
  asyncHandler((req, res) => {
    const current = requireScope(req);
    res.json(discountSimulationsRepo.listSimulations({
      ...current,
      limit: req.query.limit,
      offset: req.query.offset
    }));
  })
);

discountSimulationsRouter.get(
  "/:id",
  asyncHandler((req, res) => {
    const current = requireScope(req);
    const simulation = discountSimulationsRepo.getSimulation({ ...current, id: req.params.id });
    if (!simulation) throw notFound("Discount simulation not found");
    res.json(simulation);
  })
);

discountSimulationsRouter.delete(
  "/:id",
  asyncHandler((req, res) => {
    const current = requireScope(req);
    const changes = discountSimulationsRepo.deleteSimulation({ ...current, id: req.params.id });
    if (!changes) throw notFound("Discount simulation not found");
    res.json({ changes });
  })
);
