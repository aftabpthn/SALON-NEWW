import { Router } from "express";
import { asyncHandler } from "../middleware/async-handler.js";
import { policyInheritanceRepo } from "../repositories/policy-inheritance.repo.js";
import { badRequest } from "../utils/app-error.js";

export const policyInheritanceRouter = Router();

function scope(req) {
  return {
    tenantId: req.header("x-tenant-id") || req.access?.tenantId || req.body?.tenantId || req.query?.tenantId || "",
    branchId: req.header("x-branch-id") || req.access?.branchId || req.body?.scopeBranchId || req.query?.scopeBranchId || req.body?.branchId || req.query?.branchId || "",
    userId: req.access?.userId || req.header("x-user-id") || ""
  };
}

function requireScope(req) {
  const current = scope(req);
  if (!current.tenantId || !current.branchId) throw badRequest("tenantId and branchId are required");
  return current;
}

function asBadRequest(error) {
  return badRequest(error.message || "Invalid policy inheritance request");
}

policyInheritanceRouter.get(
  "/effective",
  asyncHandler((req, res) => {
    const current = requireScope(req);
    try {
      res.json(policyInheritanceRepo.resolvePolicyChain({
        ...current,
        targetBranchId: req.query.targetBranchId || req.query.branchId || current.branchId
      }));
    } catch (error) {
      throw asBadRequest(error);
    }
  })
);

policyInheritanceRouter.post(
  "/policy",
  asyncHandler((req, res) => {
    const current = requireScope(req);
    try {
      const policy = policyInheritanceRepo.setPolicy({
        ...req.body,
        tenantId: current.tenantId,
        branchId: current.branchId,
        createdBy: req.body?.createdBy || current.userId || null
      });
      res.status(201).json(policy);
    } catch (error) {
      throw asBadRequest(error);
    }
  })
);

policyInheritanceRouter.post(
  "/override",
  asyncHandler((req, res) => {
    const current = requireScope(req);
    try {
      const override = policyInheritanceRepo.setOverride({
        ...req.body,
        tenantId: current.tenantId,
        branchId: current.branchId,
        createdBy: req.body?.createdBy || current.userId || null
      });
      res.status(201).json(override);
    } catch (error) {
      throw asBadRequest(error);
    }
  })
);

policyInheritanceRouter.get(
  "/overrides",
  asyncHandler((req, res) => {
    const current = requireScope(req);
    try {
      res.json({
        overrides: policyInheritanceRepo.listOverrides({
          ...current,
          status: req.query.status,
          targetBranchId: req.query.targetBranchId || null,
          limit: req.query.limit
        })
      });
    } catch (error) {
      throw asBadRequest(error);
    }
  })
);
