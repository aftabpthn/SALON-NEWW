import { Router } from "express";
import { asyncHandler } from "../middleware/async-handler.js";
import { authenticateJwt } from "../middleware/auth.js";
import { customerAuthService } from "../services/customer-auth.service.js";

export const customerAuthRouter = Router();

customerAuthRouter.post(
  "/customer/auth/request-email-code",
  asyncHandler((req, res) => {
    res.status(201).json(customerAuthService.requestEmailCode(req.body || {}, {
      tenantId: req.get("x-tenant-id") || "",
      branchId: req.get("x-branch-id") || "",
      host: req.get("host") || ""
    }));
  })
);

customerAuthRouter.post(
  "/customer/auth/verify-email-code",
  asyncHandler((req, res) => {
    res.status(201).json(customerAuthService.verifyEmailCode(req.body || {}, {
      tenantId: req.get("x-tenant-id") || "",
      branchId: req.get("x-branch-id") || "",
      host: req.get("host") || ""
    }));
  })
);

customerAuthRouter.post(
  "/customer/auth/request-otp",
  asyncHandler((req, res) => {
    res.status(201).json(customerAuthService.requestOtp(req.body || {}, {
      tenantId: req.get("x-tenant-id") || "",
      branchId: req.get("x-branch-id") || "",
      host: req.get("host") || ""
    }));
  })
);

customerAuthRouter.post(
  "/customer/auth/verify-otp",
  asyncHandler((req, res) => {
    res.status(201).json(customerAuthService.verifyOtp(req.body || {}, {
      tenantId: req.get("x-tenant-id") || "",
      branchId: req.get("x-branch-id") || "",
      host: req.get("host") || ""
    }));
  })
);

customerAuthRouter.post(
  "/customer/auth/firebase",
  asyncHandler(async (req, res) => {
    res.status(201).json(await customerAuthService.exchangeFirebaseToken(req.body || {}, {
      tenantId: req.get("x-tenant-id") || "",
      branchId: req.get("x-branch-id") || "",
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

customerAuthRouter.patch(
  "/customer/me",
  authenticateJwt(),
  asyncHandler((req, res) => {
    res.json(customerAuthService.updateMe(req.body || {}, req.access));
  })
);

customerAuthRouter.post(
  "/customer/me/email/request-code",
  authenticateJwt(),
  asyncHandler((req, res) => {
    res.status(201).json(customerAuthService.requestProfileEmailCode(req.body || {}, req.access));
  })
);

customerAuthRouter.post(
  "/customer/me/email/verify",
  authenticateJwt(),
  asyncHandler((req, res) => {
    res.json(customerAuthService.verifyProfileEmailCode(req.body || {}, req.access));
  })
);

customerAuthRouter.post(
  "/customer/me/phone/request-otp",
  authenticateJwt(),
  asyncHandler((req, res) => {
    res.status(201).json(customerAuthService.requestProfilePhoneOtp(req.body || {}, req.access));
  })
);

customerAuthRouter.post(
  "/customer/me/phone/verify",
  authenticateJwt(),
  asyncHandler((req, res) => {
    res.json(customerAuthService.verifyProfilePhoneOtp(req.body || {}, req.access));
  })
);
