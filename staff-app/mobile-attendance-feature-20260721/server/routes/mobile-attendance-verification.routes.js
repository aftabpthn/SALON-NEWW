import { Router } from "express";
import { asyncHandler } from "../middleware/async-handler.js";
import { requireAnyPermission, requirePermission } from "../middleware/rbac.js";
import { staffSelfContext } from "../middleware/staff-self-context.middleware.js";
import { forbidden } from "../utils/app-error.js";
import { mobileAttendanceVerificationService as service } from "../services/mobile-attendance-verification.service.js";
import { ownerPeopleService } from "../services/owner-people.service.js";

export const mobileAttendanceVerificationRouter = Router();
const attendancePermission = requireAnyPermission([{ action: "allow", resource: "staff-checkin-checkout" }, { action: "write", resource: "staff" }]);
const readStaff = requirePermission("read", () => "staff");
const writeStaff = requirePermission("write", () => "staff");
const ownerOnly = (req, _res, next) => req.access?.role === "owner" ? next() : next(forbidden("Owner role is required"));
const enforceVerifiedPunch = (action) => (req, _res, next) => { try { service.assertNormalPunchAllowed(action, req.access); next(); } catch (error) { next(error); } };

mobileAttendanceVerificationRouter.post("/staff-os/attendance/clock-in", enforceVerifiedPunch("clock_in"));
mobileAttendanceVerificationRouter.post("/staff-os/attendance/clock-out", enforceVerifiedPunch("clock_out"));
mobileAttendanceVerificationRouter.get("/staff-self/attendance-verification-policy", attendancePermission, staffSelfContext(), asyncHandler((req, res) => res.json(service.staffPolicy(req.access))));
mobileAttendanceVerificationRouter.get("/staff-self/attendance-device", attendancePermission, staffSelfContext(), asyncHandler((req, res) => res.json(service.staffDevice(req.access, req.query))));
mobileAttendanceVerificationRouter.post("/staff-self/attendance-device/register", attendancePermission, staffSelfContext(["deviceId", "deviceLabel", "platform", "publicKeySpkiBase64"]), asyncHandler((req, res) => res.status(201).json(service.registerDevice(req.body, req.access))));
mobileAttendanceVerificationRouter.post("/staff-self/attendance-challenge", attendancePermission, staffSelfContext(["action", "attendanceId", "deviceId", "latitude", "longitude", "accuracyMeters", "capturedAt"]), asyncHandler((req, res) => res.status(201).json(service.createChallenge(req.body, req.access))));
mobileAttendanceVerificationRouter.post("/staff-self/attendance-verified-punch", attendancePermission, staffSelfContext(["challengeId", "deviceId", "signatureBase64"]), asyncHandler((req, res) => res.status(201).json(service.verifiedPunch(req.body, req.access))));

mobileAttendanceVerificationRouter.get("/owner-console/people/attendance", ownerOnly, readStaff, asyncHandler((req, res) => res.json(service.enrichAttendanceResult(ownerPeopleService.attendance(req.access, req.query), req.access))));
mobileAttendanceVerificationRouter.get("/owner-console/people/attendance/:id", ownerOnly, readStaff, asyncHandler((req, res) => res.json(service.enrichAttendanceResult(ownerPeopleService.attendanceDetail(req.params.id, req.access), req.access))));
mobileAttendanceVerificationRouter.get("/owner-console/people/attendance-policy/:branchId", ownerOnly, readStaff, asyncHandler((req, res) => res.json(service.ownerPolicy(req.access, req.params.branchId))));
mobileAttendanceVerificationRouter.put("/owner-console/people/attendance-policy/:branchId", ownerOnly, writeStaff, asyncHandler((req, res) => res.json(service.updateOwnerPolicy(req.body, req.access, req.params.branchId))));
mobileAttendanceVerificationRouter.get("/owner-console/people/attendance-devices", ownerOnly, readStaff, asyncHandler((req, res) => res.json(service.ownerDevices(req.access, req.query))));
mobileAttendanceVerificationRouter.patch("/owner-console/people/attendance-devices/:id/status", ownerOnly, writeStaff, asyncHandler((req, res) => res.json(service.updateDeviceStatus(req.params.id, req.body, req.access))));
mobileAttendanceVerificationRouter.get("/owner-console/people/attendance-evidence", ownerOnly, readStaff, asyncHandler((req, res) => res.json(service.ownerEvidence(req.access, req.query))));
mobileAttendanceVerificationRouter.post("/owner-console/people/attendance-evidence/:id/override", ownerOnly, writeStaff, asyncHandler((req, res) => res.status(201).json(service.overrideEvidence(req.params.id, req.body, req.access))));
