import { Router } from "express";
import { requireAnyPermission } from "../middleware/rbac.js";
import { staffAttendanceService } from "../services/staff-attendance.service.js";
import { route } from "./staff-os-route-utils.js";

export const staffAttendanceRouter = Router();

const canUseAttendance = requireAnyPermission([
  { action: "allow", resource: "staff-checkin-checkout" },
  { action: "write", resource: "staff" }
]);
const canReadAttendance = requireAnyPermission([
  { action: "allow", resource: "staff-checkin-checkout" },
  { action: "read", resource: "staff" },
  { action: "write", resource: "staff" }
]);

staffAttendanceRouter.post("/staff-os/attendance/clock-in", canUseAttendance, route((req, res) => res.status(201).json(staffAttendanceService.clockIn(req.body, req.access))));
staffAttendanceRouter.post("/staff-os/attendance/clock-out", canUseAttendance, route((req, res) => res.json(staffAttendanceService.clockOut(req.body, req.access))));
staffAttendanceRouter.post("/staff-os/attendance/break-start", canUseAttendance, route((req, res) => res.status(201).json(staffAttendanceService.startBreak(req.body, req.access))));
staffAttendanceRouter.post("/staff-os/attendance/break-end", canUseAttendance, route((req, res) => res.json(staffAttendanceService.endBreak(req.body, req.access))));
staffAttendanceRouter.get("/staff-os/attendance/overtime-summary", canReadAttendance, route((req, res) => res.json(staffAttendanceService.overtimeSummary(req.query, req.access))));
staffAttendanceRouter.get("/staff-os/attendance", canReadAttendance, route((req, res) => res.json(staffAttendanceService.listAttendance(req.query, req.access))));
staffAttendanceRouter.post("/staff-os/attendance/correction", canUseAttendance, route((req, res) => res.status(201).json(staffAttendanceService.correctAttendance(req.body, req.access))));
