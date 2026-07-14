import { Router } from "express";
import rateLimit from "express-rate-limit";
import { asyncHandler } from "../middleware/async-handler.js";
import { authenticateJwt } from "../middleware/auth.js";
import { authService } from "../services/auth.service.js";
import { webauthnService } from "../services/webauthn.service.js";
import { securityService } from "../services/security.service.js";
import { repositories } from "../repositories/repository-registry.js";
import { validateBody } from "../validators/request-validator.js";
import { unauthorized } from "../utils/app-error.js";
import { persistentFixedWindowRateLimit } from "../middleware/persistent-rate-limit.middleware.js";
import { publicAuthSession, setAuthRefreshCookie } from "../services/auth-cookie-session.service.js";

// Public passkey login ceremony (no session yet).
export const webauthnPublicRouter = Router();
const webauthnPublicEdgeRateLimit = rateLimit({ windowMs: 5 * 60 * 1000, max: 30, standardHeaders: true, legacyHeaders: false });
const webauthnPublicRateLimit = persistentFixedWindowRateLimit({
  scope: "webauthn-public",
  max: 30,
  windowMs: 5 * 60 * 1000,
  keyFn: (req) => [req.ip || "anonymous", req.path].join(":")
});
webauthnPublicRouter.use("/auth/webauthn/login", webauthnPublicEdgeRateLimit);
webauthnPublicRouter.use("/auth/webauthn/login", webauthnPublicRateLimit);

webauthnPublicRouter.post(
  "/auth/webauthn/login/begin",
  validateBody({ required: ["tenantId"] }),
  asyncHandler((req, res) => {
    let userId = req.body.userId;
    if (!userId) {
      const loginId = String(req.body.loginId || req.body.email || "").trim().toLowerCase();
      if (!loginId) throw unauthorized("userId or loginId is required");
      const user = repositories.tenantUsers
        .list({ limit: 100000 }, { tenantId: req.body.tenantId })
        .find((u) => String(u.email || "").toLowerCase() === loginId || String(u.loginId || "").toLowerCase() === loginId);
      if (!user) throw unauthorized("No passkeys for this account");
      userId = user.id;
    }
    res.json(webauthnService.beginAuthentication({ tenantId: req.body.tenantId, userId }));
  })
);

webauthnPublicRouter.post(
  "/auth/webauthn/login/finish",
  validateBody({ required: ["challengeToken", "id", "response"] }),
  asyncHandler((req, res) => {
    const result = webauthnService.finishAuthentication(req.body);
    const tenant = repositories.tenants.getById(result.tenantId);
    const user = repositories.tenantUsers.getById(result.userId, { tenantId: result.tenantId });
    if (!tenant || !user) throw unauthorized("Account no longer exists");
    const tokens = authService.issueTokenPair({ tenant, user, branchId: user.branchIds?.[0] || "", deviceId: "" });
    securityService.audit(
      { action: "auth.webauthn_success", targetType: "tenant_user", targetId: user.id, details: { method: "passkey" } },
      { tenantId: tenant.id, userId: user.id, role: user.role },
      req
    );
    setAuthRefreshCookie(res, tokens);
    res.status(201).json(publicAuthSession(tokens));
  })
);

// Authenticated passkey management.
export const webauthnRouter = Router();
const webauthnProtectedEdgeRateLimit = rateLimit({ windowMs: 5 * 60 * 1000, max: 60, standardHeaders: true, legacyHeaders: false });
const webauthnProtectedRateLimit = persistentFixedWindowRateLimit({
  scope: "webauthn-protected",
  max: 60,
  windowMs: 5 * 60 * 1000,
  keyFn: (req) => [req.access?.tenantId || "public", req.access?.userId || req.ip || "anonymous", req.path].join(":")
});
webauthnRouter.use("/auth/webauthn", webauthnProtectedEdgeRateLimit);
webauthnRouter.use("/auth/webauthn", webauthnProtectedRateLimit);

webauthnRouter.get(
  "/auth/webauthn/credentials",
  authenticateJwt(),
  asyncHandler((req, res) => res.json({ credentials: webauthnService.listCredentials(req.access) }))
);

webauthnRouter.post(
  "/auth/webauthn/register/begin",
  authenticateJwt(),
  asyncHandler((req, res) => res.json(webauthnService.beginRegistration(req.access, { label: req.body?.label })))
);

webauthnRouter.post(
  "/auth/webauthn/register/finish",
  authenticateJwt(),
  validateBody({ required: ["challengeToken", "response"] }),
  asyncHandler((req, res) => {
    const result = webauthnService.finishRegistration(req.access, req.body);
    securityService.audit(
      { action: "auth.webauthn_registered", targetType: "tenant_user", targetId: req.access.userId, severity: "warning" },
      req.access,
      req
    );
    res.status(201).json(result);
  })
);
