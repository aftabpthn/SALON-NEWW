import { Router } from "express";
import { asyncHandler } from "../middleware/async-handler.js";
import { requirePermission, requireStaffAppSelfPermission } from "../middleware/rbac.js";
import { staffSelfContext } from "../middleware/staff-self-context.middleware.js";
import { forbidden } from "../utils/app-error.js";
import { mobileAttendanceVerificationService as service } from "../services/mobile-attendance-verification.service.js";

export const mobileAttendanceVerificationRouter = Router();

const staffAttendanceAccess = requireStaffAppSelfPermission("allow", "staff-app-checkin-checkout");
const readStaff = requirePermission("read", () => "staff");
const writeStaff = requirePermission("write", () => "staff");
const ownerOrAdmin = (req, _res, next) => ["owner", "admin"].includes(req.access?.role)
  ? next()
  : next(forbidden("Owner or admin role is required"));

mobileAttendanceVerificationRouter.get(
  "/staff-self/attendance-verification-policy",
  staffAttendanceAccess,
  staffSelfContext(),
  asyncHandler((req, res) => res.json(service.staffPolicy(req.access)))
);
mobileAttendanceVerificationRouter.get(
  "/staff-self/attendance-device",
  staffAttendanceAccess,
  staffSelfContext(),
  asyncHandler((req, res) => res.json(service.staffDevice(req.query, req.access)))
);
mobileAttendanceVerificationRouter.post(
  "/staff-self/attendance-device/register",
  staffAttendanceAccess,
  staffSelfContext(["deviceId", "deviceLabel", "platform", "publicKeySpkiBase64", "publicKeyAlgorithm", "hardwareBacked", "verificationCapability", "attestationChain", "attestationStatus", "attestationCertificateChainBase64"]),
  asyncHandler((req, res) => res.status(201).json(service.registerDevice(req.body, req.access)))
);
mobileAttendanceVerificationRouter.post(
  "/staff-self/attendance-challenge",
  staffAttendanceAccess,
  staffSelfContext(["action", "attendanceId", "deviceId", "clientPunchId", "latitude", "longitude", "accuracyMeters", "capturedAt", "mockLocation", "integrityVerdict", "integrityToken", "riskVerdict"]),
  asyncHandler((req, res) => res.status(201).json(service.createChallenge(req.body, req.access)))
);
mobileAttendanceVerificationRouter.post(
  "/staff-self/attendance-verified-punch",
  staffAttendanceAccess,
  staffSelfContext(["challengeId", "deviceId", "signatureBase64", "idempotencyKey", "integrityToken"]),
  asyncHandler((req, res) => res.status(201).json(service.submitVerifiedPunch(req.body, req.access)))
);

mobileAttendanceVerificationRouter.use("/attendance-verification", ownerOrAdmin);
mobileAttendanceVerificationRouter.get(
  "/attendance-verification/branches/:branchId/policy",
  readStaff,
  asyncHandler((req, res) => res.json(service.adminPolicy(req.params.branchId, req.access)))
);
mobileAttendanceVerificationRouter.put(
  "/attendance-verification/branches/:branchId/policy",
  writeStaff,
  asyncHandler((req, res) => res.json(service.updateAdminPolicy(req.params.branchId, req.body, req.access)))
);
mobileAttendanceVerificationRouter.get(
  "/attendance-verification/devices",
  readStaff,
  asyncHandler((req, res) => res.json(service.adminDevices(req.query, req.access)))
);
mobileAttendanceVerificationRouter.get(
  "/attendance-verification/devices/:id/reviews",
  readStaff,
  asyncHandler((req, res) => res.json(service.deviceReviews(req.params.id, req.access)))
);
mobileAttendanceVerificationRouter.post(
  "/attendance-verification/devices/:id/reviews",
  writeStaff,
  asyncHandler((req, res) => res.status(201).json(service.reviewDevice(req.params.id, req.body, req.access)))
);
mobileAttendanceVerificationRouter.get(
  "/attendance-verification/evidence",
  readStaff,
  asyncHandler((req, res) => res.json(service.adminEvidence(req.query, req.access)))
);
