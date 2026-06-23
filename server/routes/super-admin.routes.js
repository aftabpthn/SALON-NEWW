import { Router } from "express";
import { asyncHandler } from "../middleware/async-handler.js";
import { superAdminService } from "../services/super-admin.service.js";
import { validateBody } from "../validators/request-validator.js";

export const superAdminRouter = Router();

superAdminRouter.get(
  "/super-admin/overview",
  asyncHandler((req, res) => {
    res.json(superAdminService.overview(req.access));
  })
);

superAdminRouter.post(
  "/super-admin/analytics/run",
  asyncHandler((req, res) => {
    res.status(201).json(superAdminService.analytics(req.body, req.access));
  })
);

superAdminRouter.patch(
  "/super-admin/tenants/:id/suspension",
  validateBody({ required: ["status"] }),
  asyncHandler((req, res) => {
    res.json(superAdminService.suspendTenant(req.params.id, req.body, req.access));
  })
);

superAdminRouter.patch(
  "/super-admin/tenants/:id/subscription",
  asyncHandler((req, res) => {
    res.json(superAdminService.updateTenantSubscription(req.params.id, req.body, req.access));
  })
);

superAdminRouter.patch(
  "/super-admin/tenants/:id/limits",
  asyncHandler((req, res) => {
    res.json(superAdminService.updateTenantLimits(req.params.id, req.body, req.access));
  })
);

superAdminRouter.patch(
  "/super-admin/tenants/:id/ip-allowlist",
  asyncHandler((req, res) => {
    res.json(superAdminService.updateTenantIpAllowlist(req.params.id, req.body, req.access));
  })
);

superAdminRouter.patch(
  "/super-admin/tenants/:id/sso",
  asyncHandler((req, res) => {
    res.json(superAdminService.updateTenantSso(req.params.id, req.body, req.access));
  })
);

superAdminRouter.patch(
  "/super-admin/tenants/:id/data-export-controls",
  asyncHandler((req, res) => {
    res.json(superAdminService.updateTenantDataExportControls(req.params.id, req.body, req.access));
  })
);

superAdminRouter.patch(
  "/super-admin/tenants/:id/role-permissions",
  asyncHandler((req, res) => {
    res.json(superAdminService.updateTenantRolePermissionMatrix(req.params.id, req.body, req.access));
  })
);

superAdminRouter.post(
  "/super-admin/tenants/:id/gdpr-export",
  validateBody({ required: ["reason", "confirmation"] }),
  asyncHandler((req, res) => {
    res.status(201).json(superAdminService.initiateTenantGdprExport(req.params.id, req.body, req.access));
  })
);

superAdminRouter.post(
  "/super-admin/tenants/bulk-action",
  validateBody({ required: ["action", "tenantIds", "reason", "confirmation"] }),
  asyncHandler((req, res) => {
    res.status(201).json(superAdminService.bulkTenantAction(req.body, req.access));
  })
);

superAdminRouter.post(
  "/super-admin/health-alerts/broadcast",
  asyncHandler((req, res) => {
    res.status(201).json(superAdminService.broadcastHealthAlerts(req.access));
  })
);

superAdminRouter.post(
  "/super-admin/quota-alerts/dispatch",
  asyncHandler((req, res) => {
    res.status(201).json(superAdminService.dispatchQuotaAlerts(req.body, req.access));
  })
);

superAdminRouter.post(
  "/super-admin/tenants/:id/impersonation",
  validateBody({ required: ["reason", "confirmation"] }),
  asyncHandler((req, res) => {
    res.status(201).json(superAdminService.impersonateTenant(req.params.id, req.body, req.access));
  })
);

superAdminRouter.post(
  "/super-admin/plans",
  validateBody({ required: ["name", "code"] }),
  asyncHandler((req, res) => {
    res.status(201).json(superAdminService.createPlan(req.body, req.access));
  })
);

superAdminRouter.patch(
  "/super-admin/plans/:id",
  asyncHandler((req, res) => {
    res.json(superAdminService.updatePlan(req.params.id, req.body, req.access));
  })
);

superAdminRouter.post(
  "/super-admin/feature-toggles",
  validateBody({ required: ["key", "name"] }),
  asyncHandler((req, res) => {
    res.status(201).json(superAdminService.upsertFeatureToggle(req.body, req.access));
  })
);

superAdminRouter.patch(
  "/super-admin/feature-toggles/:id/enabled",
  validateBody({ required: ["enabled"] }),
  asyncHandler((req, res) => {
    res.json(superAdminService.setFeatureToggleEnabled(req.params.id, req.body.enabled, req.access));
  })
);

superAdminRouter.post(
  "/super-admin/action-approvals",
  validateBody({ required: ["action", "targetType", "targetId", "reason", "confirmation"] }),
  asyncHandler((req, res) => {
    res.status(201).json(superAdminService.requestActionApproval(req.body, req.access));
  })
);

superAdminRouter.post(
  "/super-admin/action-approvals/:id/resolve",
  validateBody({ required: ["status", "reason", "confirmation"] }),
  asyncHandler((req, res) => {
    res.status(201).json(superAdminService.resolveActionApproval(req.params.id, req.body, req.access));
  })
);

superAdminRouter.post(
  "/super-admin/action-inbox/:id",
  validateBody({ required: ["action"] }),
  asyncHandler((req, res) => {
    res.status(201).json(superAdminService.updateActionInboxItem(req.params.id, req.body, req.access));
  })
);

superAdminRouter.post(
  "/super-admin/playbooks/:key/run",
  asyncHandler((req, res) => {
    res.status(201).json(superAdminService.runOperationsPlaybook(req.params.key, req.body, req.access));
  })
);

superAdminRouter.post(
  "/super-admin/tenants/:id/support-notes",
  validateBody({ required: ["note"] }),
  asyncHandler((req, res) => {
    res.status(201).json(superAdminService.addSupportNote(req.params.id, req.body, req.access));
  })
);

superAdminRouter.delete(
  "/super-admin/feature-toggles/:id",
  asyncHandler((req, res) => {
    res.json(superAdminService.deleteFeatureToggle(req.params.id, req.access));
  })
);
