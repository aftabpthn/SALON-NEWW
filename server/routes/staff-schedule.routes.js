import { Router } from "express";
import { staffScheduleService } from "../services/staff-schedule.service.js";
import { staffShiftSwapService } from "../services/staff-shift-swap.service.js";
import { route } from "./staff-os-route-utils.js";
import { requireAnyPermission, requireSelfServiceOrAnyPermission } from "../middleware/rbac.js";
import { derivedStaffQuery, managedStaffAccess } from "../middleware/staff-self-context.middleware.js";

export const staffScheduleRouter = Router();

const canReadOwnSchedule = requireSelfServiceOrAnyPermission("read", "staff", [{ action: "read", resource: "staff" }]);
const canManageSchedule = requireAnyPermission([{ action: "write", resource: "staff" }]);

staffScheduleRouter.get("/staff-os/schedules", canReadOwnSchedule, derivedStaffQuery(), route((req, res) => res.json(staffScheduleService.listSchedules(req.query, managedStaffAccess(req.access)))));
staffScheduleRouter.post("/staff-os/schedules", canManageSchedule, route((req, res) => res.status(201).json(staffScheduleService.createSchedule(req.body, req.access))));
staffScheduleRouter.patch("/staff-os/schedules/:id", canManageSchedule, route((req, res) => res.json(staffScheduleService.updateSchedule(req.params.id, req.body, req.access))));
staffScheduleRouter.delete("/staff-os/schedules/:id", canManageSchedule, route((req, res) => res.json(staffScheduleService.deleteSchedule(req.params.id, req.access))));
staffScheduleRouter.post("/staff-os/shift-swaps", canManageSchedule, route((req, res) => res.status(201).json(staffShiftSwapService.createForManager(req.body, req.access))));
staffScheduleRouter.get("/staff-os/shift-swaps", canManageSchedule, route((req, res) => res.json(staffShiftSwapService.listForManager(req.query, req.access))));
staffScheduleRouter.post("/staff-os/shift-swaps/:id/approve", canManageSchedule, route((req, res) => res.json(staffShiftSwapService.approve(req.params.id, req.body, req.access))));
staffScheduleRouter.post("/staff-os/shift-swaps/:id/reject", canManageSchedule, route((req, res) => res.json(staffShiftSwapService.reject(req.params.id, req.body, req.access))));
staffScheduleRouter.post("/staff-os/branch-transfer", canManageSchedule, route((req, res) => res.json(staffScheduleService.branchTransfer(req.body, req.access))));
