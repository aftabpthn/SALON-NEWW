import { requireStaffAppPermission } from "../middleware/rbac.js";
import { isBiometricGatewayRequest } from "../middleware/auth.js";

export function route(handler) {
  return (req, res, next) => {
    try {
      handler(req, res, next);
    } catch (error) {
      next(error);
    }
  };
}

export function staffOsCapabilityRouter(resource, pathPattern, router) {
  const read = requireStaffAppPermission("read", resource);
  const write = requireStaffAppPermission("write", resource);
  return (req, res, next) => {
    if (!pathPattern.test(req.path)) return next();
    if (isBiometricGatewayRequest(req)) return router(req, res, next);
    const permission = ["GET", "HEAD", "OPTIONS"].includes(req.method) ? read : write;
    return permission(req, res, (error) => error ? next(error) : router(req, res, next));
  };
}
