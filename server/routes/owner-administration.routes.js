import { Router } from "express";
import { asyncHandler } from "../middleware/async-handler.js";
import { requirePermission } from "../middleware/rbac.js";
import { ownerAdministrationService } from "../services/owner-administration.service.js";
import { forbidden } from "../utils/app-error.js";

export const ownerAdministrationRouter = Router();
const base = "/owner-console/administration";

ownerAdministrationRouter.use(base, (req, _res, next) => req.access?.role === "owner" ? next() : next(forbidden("Owner role is required")));

ownerAdministrationRouter.get(`${base}/branches`, requirePermission("read", () => "branches"), asyncHandler((req, res) => res.json(ownerAdministrationService.branches(req.access))));
ownerAdministrationRouter.post(`${base}/branches`, requirePermission("write", () => "branches"), asyncHandler((req, res) => res.status(201).json(ownerAdministrationService.createBranch(req.body, req.access, req))));
ownerAdministrationRouter.patch(`${base}/branches/:id`, requirePermission("write", () => "branches"), asyncHandler((req, res) => res.json(ownerAdministrationService.updateBranch(req.params.id, req.body, req.access, req))));
ownerAdministrationRouter.patch(`${base}/branches/:id/status`, requirePermission("write", () => "branches"), asyncHandler((req, res) => res.json(ownerAdministrationService.setBranchStatus(req.params.id, req.body?.status, req.access, req))));
ownerAdministrationRouter.get(`${base}/access`, requirePermission("read", () => "security"), asyncHandler((req, res) => res.json(ownerAdministrationService.access(req.access, req.query))));
ownerAdministrationRouter.post(`${base}/roles`, requirePermission("write", () => "security"), asyncHandler((req, res) => res.json(ownerAdministrationService.saveRole(req.body, req.access, req))));
ownerAdministrationRouter.post(`${base}/roles/:role/restore-defaults`, requirePermission("write", () => "security"), asyncHandler((req, res) => res.json(ownerAdministrationService.restoreRoleDefaults(req.params.role, req.body, req.access, req))));
ownerAdministrationRouter.post(`${base}/users`, requirePermission("write", () => "security"), asyncHandler((req, res) => res.status(201).json(ownerAdministrationService.createUser(req.body, req.access, req))));
ownerAdministrationRouter.patch(`${base}/users/:id`, requirePermission("write", () => "security"), asyncHandler((req, res) => res.json(ownerAdministrationService.updateUser(req.params.id, req.body, req.access, req))));
ownerAdministrationRouter.get(`${base}/settings`, requirePermission("read", () => "settings"), asyncHandler((req, res) => res.json(ownerAdministrationService.settings(req.query, req.access))));
ownerAdministrationRouter.put(`${base}/settings`, requirePermission("write", () => "settings"), asyncHandler((req, res) => res.json(ownerAdministrationService.saveSettings(req.body, req.access))));
