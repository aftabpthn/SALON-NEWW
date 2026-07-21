import { Router } from "express";
import { requireAnyPermission } from "../middleware/rbac.js";
import { staffBiometricService } from "../services/staff-biometric.service.js";
import { AppError } from "../utils/app-error.js";
import { route } from "./staff-os-route-utils.js";

export const staffBiometricRouter = Router();

const canReadBiometric = requireAnyPermission([
  { action: "allow", resource: "staff-checkin-checkout" },
  { action: "read", resource: "staff" },
  { action: "write", resource: "staff" }
]);
const canWriteBiometric = requireAnyPermission([
  { action: "allow", resource: "staff-checkin-checkout" },
  { action: "write", resource: "staff" }
]);
const gatewayRateWindows = new Map();

function gatewayOrManager(limitPerMinute) {
  return (req, res, next) => {
    if (req.access) {
      canWriteBiometric(req, res, next);
      return;
    }
    try {
      const access = staffBiometricService.gatewayRequestAccess(req.params.id, {
        tenantId: req.get("x-tenant-id"),
        apiKey: req.get("x-gateway-api-key")
      });
      const stamp = Date.now();
      const key = `${access.tenantId}:${access.gatewayId}:${req.path}`;
      const current = gatewayRateWindows.get(key);
      const bucket = !current || current.resetAt <= stamp ? { count: 0, resetAt: stamp + 60_000 } : current;
      if (bucket.count >= limitPerMinute) {
        res.setHeader("Retry-After", String(Math.max(1, Math.ceil((bucket.resetAt - stamp) / 1000))));
        throw new AppError("Biometric gateway rate limit exceeded", 429);
      }
      bucket.count += 1;
      gatewayRateWindows.set(key, bucket);
      if (gatewayRateWindows.size > 2000) {
        for (const [bucketKey, value] of gatewayRateWindows) if (value.resetAt <= stamp) gatewayRateWindows.delete(bucketKey);
      }
      req.access = access;
      req.user = { id: access.userId, role: access.role, branchId: access.branchId, branchIds: access.branchIds };
      next();
    } catch (error) {
      next(error);
    }
  };
}

staffBiometricRouter.get("/staff-os/biometric/devices", canReadBiometric, route((req, res) => res.json(staffBiometricService.listDevices(req.query, req.access))));
staffBiometricRouter.post("/staff-os/biometric/devices", canWriteBiometric, route((req, res) => res.status(201).json(staffBiometricService.registerDevice(req.body, req.access))));
staffBiometricRouter.patch("/staff-os/biometric/devices/:id", canWriteBiometric, route((req, res) => res.json(staffBiometricService.updateDevice(req.params.id, req.body, req.access))));
staffBiometricRouter.post("/staff-os/biometric/devices/:id/sync", canWriteBiometric, route((req, res) => res.json(staffBiometricService.syncDevice(req.params.id, req.body, req.access))));
staffBiometricRouter.post("/staff-os/biometric/process-queue", canWriteBiometric, route((req, res) => res.json(staffBiometricService.processQueue(req.body, req.access))));
staffBiometricRouter.get("/staff-os/biometric/logs", canReadBiometric, route((req, res) => res.json(staffBiometricService.logs(req.query, req.access))));
staffBiometricRouter.get("/staff-os/biometric/mappings", canReadBiometric, route((req, res) => res.json(staffBiometricService.listMappings(req.query, req.access))));
staffBiometricRouter.post("/staff-os/biometric/mappings", canWriteBiometric, route((req, res) => res.status(201).json(staffBiometricService.createMapping(req.body, req.access))));
staffBiometricRouter.patch("/staff-os/biometric/mappings/:id/approve", canWriteBiometric, route((req, res) => res.json(staffBiometricService.approveMapping(req.params.id, req.body, req.access))));
staffBiometricRouter.get("/staff-os/biometric/gateway/manifest", canReadBiometric, route((req, res) => res.json(staffBiometricService.gatewayManifest(req.query, req.access))));
staffBiometricRouter.post("/staff-os/biometric/gateway/register", canWriteBiometric, route((req, res) => res.status(201).json(staffBiometricService.registerGateway(req.body, req.access))));
staffBiometricRouter.post("/staff-os/biometric/gateway/:id/heartbeat", gatewayOrManager(120), route((req, res) => res.json(staffBiometricService.gatewayHeartbeat(req.params.id, req.body, req.access))));
staffBiometricRouter.post("/staff-os/biometric/gateway/:id/events", gatewayOrManager(30), route((req, res) => res.status(202).json(staffBiometricService.gatewayEvents(req.params.id, req.body, req.access))));
staffBiometricRouter.get("/staff-os/biometric/consents", canReadBiometric, route((req, res) => res.json(staffBiometricService.listConsents(req.query, req.access))));
staffBiometricRouter.post("/staff-os/biometric/consents", canWriteBiometric, route((req, res) => res.status(201).json(staffBiometricService.upsertConsent(req.body, req.access))));
staffBiometricRouter.patch("/staff-os/biometric/consents/:id/delete-request", canWriteBiometric, route((req, res) => res.json(staffBiometricService.requestConsentDeletion(req.params.id, req.body, req.access))));
staffBiometricRouter.get("/staff-os/attendance/biometric-center", canReadBiometric, route((req, res) => res.json(staffBiometricService.attendanceCenter(req.query, req.access))));
staffBiometricRouter.post("/staff-os/attendance/camera-punch", canWriteBiometric, route((req, res) => res.status(201).json(staffBiometricService.cameraPunch(req.body, req.access))));
staffBiometricRouter.get("/staff-os/attendance/risks", canReadBiometric, route((req, res) => res.json(staffBiometricService.attendanceRisks(req.query, req.access))));
staffBiometricRouter.post("/staff-os/attendance/fraud-scan", canWriteBiometric, route((req, res) => res.json(staffBiometricService.runFraudScan(req.body, req.access))));
staffBiometricRouter.get("/staff-os/attendance/payroll-preview", canReadBiometric, route((req, res) => res.json(staffBiometricService.payrollPreviewRows(req.query, req.access))));
staffBiometricRouter.post("/staff-os/attendance/payroll-preview", canWriteBiometric, route((req, res) => res.status(201).json(staffBiometricService.payrollAutopilotPreview(req.body, req.access))));
staffBiometricRouter.get("/staff-os/owner-alerts", canReadBiometric, route((req, res) => res.json(staffBiometricService.ownerAlerts(req.query, req.access))));
