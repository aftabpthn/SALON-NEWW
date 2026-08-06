import { Router } from "express";
import { requireStaffAppPermission, requireStaffAppSelfOrPermission } from "../middleware/rbac.js";
import { staffAttendanceService } from "../services/staff-attendance.service.js";
import { applyCachedResponseHeaders, cachedStaffRead, invalidateStaffDashboardCache } from "../services/staff-dashboard-cache.service.js";
import { route } from "./staff-os-route-utils.js";
import { derivedStaffMutation, derivedStaffQuery, managedStaffAccess } from "../middleware/staff-self-context.middleware.js";

export const staffAttendanceRouter = Router();

const canUseAttendance = requireStaffAppSelfOrPermission("allow", "staff-app-checkin-checkout");
const canReadAttendance = requireStaffAppSelfOrPermission("read", "staff-app-staff");
const canCorrectAttendance = requireStaffAppPermission("write", "staff-app-staff");

staffAttendanceRouter.post("/staff-os/attendance/clock-in", canUseAttendance, derivedStaffMutation(["businessDate", "business_date", "clockInAt", "clock_in_at", "source", "gpsLat", "gps_lat", "gpsLng", "gps_lng", "deviceId", "device_id", "selfieUrl", "selfie_url"]), route((req, res) => res.status(201).json(staffAttendanceService.clockIn(req.body, managedStaffAccess(req.access)))));
staffAttendanceRouter.post("/staff-os/attendance/clock-out", canUseAttendance, derivedStaffMutation(["attendanceId", "attendance_id", "clockOutAt", "clock_out_at"]), route((req, res) => res.json(staffAttendanceService.clockOut(req.body, managedStaffAccess(req.access)))));
staffAttendanceRouter.post("/staff-os/attendance/break-start", canUseAttendance, derivedStaffMutation(["breakType", "break_type", "startedAt", "started_at"]), route((req, res) => res.status(201).json(staffAttendanceService.startBreak(req.body, managedStaffAccess(req.access)))));
staffAttendanceRouter.post("/staff-os/attendance/break-end", canUseAttendance, derivedStaffMutation(["breakId", "break_id", "endedAt", "ended_at"]), route((req, res) => res.json(staffAttendanceService.endBreak(req.body, managedStaffAccess(req.access)))));
staffAttendanceRouter.get("/staff-os/attendance/overtime-summary", canReadAttendance, derivedStaffQuery(), route((req, res) => {
  const data = cachedStaffRead(
    req.query,
    req.access,
    (query, access) => staffAttendanceService.overtimeSummary(query, managedStaffAccess(access)),
    5_000,
    "overtime-summary"
  );
  applyCachedResponseHeaders(res, data, 5);
  res.json(data);
}));
staffAttendanceRouter.get("/staff-os/attendance", canReadAttendance, derivedStaffQuery(), route((req, res) => {
  const data = cachedStaffRead(
    req.query,
    req.access,
    (query, access) => staffAttendanceService.listAttendance(query, managedStaffAccess(access)),
    5_000,
    "attendance-list"
  );
  applyCachedResponseHeaders(res, data, 5);
  res.json(data);
}));
staffAttendanceRouter.post("/staff-os/attendance/correction", canCorrectAttendance, route((req, res) => {
  const data = staffAttendanceService.correctAttendance(req.body, managedStaffAccess(req.access));
  invalidateStaffDashboardCache(managedStaffAccess(req.access));
  res.status(201).json(data);
}));
