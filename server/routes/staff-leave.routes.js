import { Router } from "express";
import { requireAnyPermission, requireSelfServiceOrAnyPermission } from "../middleware/rbac.js";
import { derivedStaffMutation, derivedStaffQuery, managedStaffAccess } from "../middleware/staff-self-context.middleware.js";
import { staffLeaveRequestService } from "../services/staff-leave-request.service.js";
import { staffLeaveService } from "../services/staff-leave.service.js";
import { route } from "./staff-os-route-utils.js";

export const staffLeaveRouter = Router();

const canWriteStaffLeave = requireAnyPermission([
  { action: "write", resource: "staff" },
  { action: "update", resource: "staff" }
]);
const canUseOwnLeave = requireSelfServiceOrAnyPermission("write", "staff", [
  { action: "write", resource: "staff" },
  { action: "update", resource: "staff" }
]);
const canReadOwnLeave = requireSelfServiceOrAnyPermission("read", "staff", [
  { action: "read", resource: "staff" },
  { action: "write", resource: "staff" }
]);

staffLeaveRouter.post("/staff-os/leaves", canUseOwnLeave, derivedStaffMutation(), route((req, res) => res.status(201).json(staffLeaveRequestService.requestLeave(req.body, managedStaffAccess(req.access)))));
staffLeaveRouter.patch("/staff-os/leaves/:id/approve", canWriteStaffLeave, route((req, res) => res.json(staffLeaveService.decideLeave(req.params.id, "approved", req.body, managedStaffAccess(req.access)))));
staffLeaveRouter.patch("/staff-os/leaves/:id/reject", canWriteStaffLeave, route((req, res) => res.json(staffLeaveService.decideLeave(req.params.id, "rejected", req.body, managedStaffAccess(req.access)))));
staffLeaveRouter.get("/staff-os/leaves", canReadOwnLeave, derivedStaffQuery(), route((req, res) => res.json(staffLeaveService.listLeaves(req.query, managedStaffAccess(req.access)))));
staffLeaveRouter.get("/staff-os/leave-calendar", canReadOwnLeave, derivedStaffQuery(), route((req, res) => res.json(staffLeaveService.listLeaves(req.query, managedStaffAccess(req.access)))));
staffLeaveRouter.get("/staff-os/leave-balances", canReadOwnLeave, derivedStaffQuery(), route((req, res) => res.json(staffLeaveService.leaveBalances(req.query, managedStaffAccess(req.access)))));
