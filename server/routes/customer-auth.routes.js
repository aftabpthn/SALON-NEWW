import { Router } from "express";
import { asyncHandler } from "../middleware/async-handler.js";
import { authenticateJwt } from "../middleware/auth.js";
import { customerAuthService } from "../services/customer-auth.service.js";

export const customerAuthRouter = Router();

customerAuthRouter.post(
  "/customer/auth/firebase",
  asyncHandler(async (req, res) => {
    res.status(201).json(await customerAuthService.exchangeFirebaseToken(req.body || {}, {
      tenantId: req.get("x-tenant-id") || "",
      host: req.get("host") || ""
    }));
  })
);

customerAuthRouter.post(
  "/customer/auth/refresh",
  asyncHandler((req, res) => {
    res.json(customerAuthService.refresh(req.body?.refreshToken || "", req.body?.device || {}));
  })
);

customerAuthRouter.post(
  "/customer/auth/logout",
  asyncHandler((req, res) => {
    res.json(customerAuthService.logout(req.body?.refreshToken || ""));
  })
);

customerAuthRouter.get(
  "/customer/me",
  authenticateJwt(),
  asyncHandler((req, res) => {
    res.json(customerAuthService.me(req.access));
  })
);
