import { Router } from "express";
import { requireAnyPermission } from "../middleware/rbac.js";
import { staffLeaveRequestService } from "../services/staff-leave-request.service.js";
import { staffLeaveService } from "../services/staff-leave.service.js";
import { route } from "./staff-os-route-utils.js";

export const staffLeaveRouter = Router();

const canReadStaffLeave = requireAnyPermission([
  { action: "read", resource: "staff" },
  { action: "write", resource: "staff" }
]);
const canWriteStaffLeave = requireAnyPermission([
  { action: "write", resource: "staff" },
  { action: "update", resource: "staff" }
]);

staffLeaveRouter.post("/staff-os/leaves", canWriteStaffLeave, route((req, res) => res.status(201).json(staffLeaveRequestService.requestLeave(req.body, req.access))));
staffLeaveRouter.patch("/staff-os/leaves/:id/approve", canWriteStaffLeave, route((req, res) => res.json(staffLeaveService.decideLeave(req.params.id, "approved", req.body, req.access))));
staffLeaveRouter.patch("/staff-os/leaves/:id/reject", canWriteStaffLeave, route((req, res) => res.json(staffLeaveService.decideLeave(req.params.id, "rejected", req.body, req.access))));
staffLeaveRouter.get("/staff-os/leaves", canReadStaffLeave, route((req, res) => res.json(staffLeaveService.listLeaves(req.query, req.access))));
staffLeaveRouter.get("/staff-os/leave-calendar", canReadStaffLeave, route((req, res) => res.json(staffLeaveService.listLeaves(req.query, req.access))));
staffLeaveRouter.get("/staff-os/leave-balances", canReadStaffLeave, route((req, res) => res.json(staffLeaveService.leaveBalances(req.query, req.access))));
