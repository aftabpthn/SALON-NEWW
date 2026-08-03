import { Router } from "express";
import { requireStaffAppPermission, requireStaffAppSelfOrPermission } from "../middleware/rbac.js";
import { derivedStaffMutation, derivedStaffQuery, managedStaffAccess } from "../middleware/staff-self-context.middleware.js";
import { applyCachedResponseHeaders, cachedStaffRead, invalidateStaffDashboardCache } from "../services/staff-dashboard-cache.service.js";
import { staffLeaveRequestService } from "../services/staff-leave-request.service.js";
import { staffLeaveService } from "../services/staff-leave.service.js";
import { route } from "./staff-os-route-utils.js";

export const staffLeaveRouter = Router();

const canWriteStaffLeave = requireStaffAppPermission("update", "staff-app-staff");
const canUseOwnLeave = requireStaffAppSelfOrPermission("write", "staff-app-staff");
const canReadOwnLeave = requireStaffAppSelfOrPermission("read", "staff-app-staff");

staffLeaveRouter.post("/staff-os/leaves", canUseOwnLeave, derivedStaffMutation(), route((req, res) => {
  const data = staffLeaveRequestService.requestLeave(req.body, managedStaffAccess(req.access));
  invalidateStaffDashboardCache(managedStaffAccess(req.access));
  res.status(201).json(data);
}));
staffLeaveRouter.patch("/staff-os/leaves/:id/approve", canWriteStaffLeave, route((req, res) => res.json(staffLeaveService.decideLeave(req.params.id, "approved", req.body, managedStaffAccess(req.access)))));
staffLeaveRouter.patch("/staff-os/leaves/:id/reject", canWriteStaffLeave, route((req, res) => res.json(staffLeaveService.decideLeave(req.params.id, "rejected", req.body, managedStaffAccess(req.access)))));
staffLeaveRouter.get("/staff-os/leaves", canReadOwnLeave, derivedStaffQuery(), route((req, res) => res.json(staffLeaveService.listLeaves(req.query, managedStaffAccess(req.access)))));
staffLeaveRouter.get("/staff-os/leave-calendar", canReadOwnLeave, derivedStaffQuery(), route((req, res) => res.json(staffLeaveService.listLeaves(req.query, managedStaffAccess(req.access)))));
staffLeaveRouter.get("/staff-os/leave-balances", canReadOwnLeave, derivedStaffQuery(), route((req, res) => {
  const data = cachedStaffRead(
    req.query,
    req.access,
    (query, access) => staffLeaveService.leaveBalances(query, managedStaffAccess(access)),
    60_000
  );
  applyCachedResponseHeaders(res, data, 60);
  res.json(data);
}));
