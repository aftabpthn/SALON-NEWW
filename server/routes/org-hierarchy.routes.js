import { Router } from "express";
import { asyncHandler } from "../middleware/async-handler.js";
import { orgHierarchyRepo } from "../repositories/org-hierarchy.repo.js";
import { badRequest } from "../utils/app-error.js";

export const orgHierarchyRouter = Router();

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
  return badRequest(error.message || "Invalid org hierarchy request");
}

orgHierarchyRouter.get(
  "/tree",
  asyncHandler((req, res) => {
    const current = requireScope(req);
    res.json(orgHierarchyRepo.listOrgTree(current));
  })
);

orgHierarchyRouter.post(
  "/unit",
  asyncHandler((req, res) => {
    const current = requireScope(req);
    try {
      const unit = orgHierarchyRepo.createOrgUnit({
        ...req.body,
        tenantId: current.tenantId,
        branchId: current.branchId,
        createdBy: req.body?.createdBy || current.userId || null
      });
      res.status(201).json(unit);
    } catch (error) {
      throw asBadRequest(error);
    }
  })
);

orgHierarchyRouter.patch(
  "/unit/:id",
  asyncHandler((req, res) => {
    const current = requireScope(req);
    try {
      res.json(orgHierarchyRepo.updateOrgUnit({
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

orgHierarchyRouter.post(
  "/assign-branch",
  asyncHandler((req, res) => {
    const current = requireScope(req);
    const targetBranchId = String(req.body?.targetBranchId || req.body?.assignedBranchId || req.body?.branchId || current.branchId || "").trim();
    if (!targetBranchId) throw badRequest("targetBranchId is required");
    try {
      res.status(201).json(orgHierarchyRepo.assignBranch({
        tenantId: current.tenantId,
        branchId: targetBranchId,
        orgScopeBranchId: current.branchId,
        orgUnitId: req.body?.orgUnitId,
        status: req.body?.status || "active",
        assignedBy: req.body?.assignedBy || current.userId || null
      }));
    } catch (error) {
      throw asBadRequest(error);
    }
  })
);
