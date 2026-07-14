import { Router } from "express";
import { asyncHandler } from "../middleware/async-handler.js";
import { authenticateJwt } from "../middleware/auth.js";
import { authService } from "../services/auth.service.js";
import { issueCsrfToken } from "../services/csrf-token.service.js";
import { intrusionDetectionService } from "../services/intrusion-detection.service.js";
import { securityService } from "../services/security.service.js";
import { validateBody } from "../validators/request-validator.js";
import {
  clearAuthRefreshCookie,
  publicAuthSession,
  refreshTokenRequest,
  setAuthRefreshCookie
} from "../services/auth-cookie-session.service.js";

export const authRouter = Router();

function demoStaffLogin(req) {
  return authService.login({
    tenantId: "tenant_aura",
    loginId: "isha.staff",
    password: process.env.DEMO_STAFF_PASSWORD || "",
    device: { type: "staff-app", name: "Aura Staff App", platform: "web" }
  }, {
    tenantId: "tenant_aura",
    host: req.get("x-forwarded-host") || req.get("host") || "",
    ip: req.ip || "",
    userAgent: req.get("user-agent") || ""
  });
}

authRouter.get(
  "/auth/csrf",
  asyncHandler((_req, res) => {
    res.json(issueCsrfToken(res));
  })
);

authRouter.post(
  "/auth/login",
  validateBody({ required: ["tenantId"] }),
  asyncHandler((req, res) => {
    const result = authService.login(req.body, {
      tenantId: req.body.tenantId,
      host: req.get("x-forwarded-host") || req.get("host") || "",
      ip: req.ip || "",
      userAgent: req.get("user-agent") || ""
    });
    intrusionDetectionService.checkAdminLogin({
      tenantId: result.tenant.id,
      userId: result.user.id,
      role: result.user.role,
      ip: req.ip || "",
      userAgent: req.get("user-agent") || "",
      deviceId: req.body.deviceId || req.body.device?.id || ""
    });
    securityService.audit({
      action: "auth.login",
      targetType: "tenant_user",
      targetId: result.user.id,
      details: { email: result.user.email, branchId: result.user.branchId, deviceId: req.body.deviceId || req.body.device?.id || "" }
    }, {
      tenantId: result.tenant.id,
      userId: result.user.id,
      role: result.user.role,
      branchId: result.user.branchId,
      branchIds: result.user.branchIds || []
    }, req);
    setAuthRefreshCookie(res, result);
    res.status(201).json(publicAuthSession(result));
  })
);

authRouter.get(
  "/auth/demo-staff-open",
  asyncHandler((req, res) => {
    const result = demoStaffLogin(req);
    setAuthRefreshCookie(res, result);
    res.redirect(302, "/staff/open");
  })
);

authRouter.get(
  "/auth/demo-staff-session",
  asyncHandler((req, res) => {
    const result = demoStaffLogin(req);
    setAuthRefreshCookie(res, result);
    res.json(publicAuthSession(result));
  })
);

authRouter.post(
  "/auth/refresh",
  asyncHandler((req, res) => {
    const refreshRequest = refreshTokenRequest(req);
    const result = authService.refresh(refreshRequest.token, { fromCookie: refreshRequest.fromCookie });
    setAuthRefreshCookie(res, result);
    res.json(publicAuthSession(result));
  })
);

authRouter.post(
  "/auth/logout",
  authenticateJwt(),
  asyncHandler((req, res) => {
    const result = authService.logout(refreshTokenRequest(req).token, req.access);
    clearAuthRefreshCookie(res);
    res.json(result);
  })
);

authRouter.get(
  "/auth/me",
  authenticateJwt(),
  asyncHandler((req, res) => {
    res.json({ user: req.user, access: req.access, tenant: req.tenant });
  })
);
