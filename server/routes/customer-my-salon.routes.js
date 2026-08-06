import { Router } from "express";
import { authenticateJwt } from "../middleware/auth.js";
import { asyncHandler } from "../middleware/async-handler.js";
import {
  getMySalonDashboard,
  getMySalonServices,
  getMySalonStaff,
  getMySalonOffers,
} from "../services/customer-my-salon.service.js";

export const customerMySalonRouter = Router();

function salonContext(req) {
  return {
    tenantId: req.get("x-tenant-id") || "",
    branchId: req.get("x-branch-id") || "",
  };
}

// All routes require customer authentication
customerMySalonRouter.use("/customer/my-salon", authenticateJwt());

/**
 * GET /customer/my-salon/dashboard
 *
 * Single aggregated endpoint for the "My Salon" home card.
 * Returns salon profile, wallet, loyalty, membership, packages,
 * recent bookings, services, staff, offers, and relationship info
 * for the customer's primary salon.
 *
 * If no primary salon is set, returns hasPrimarySalon: false.
 */
customerMySalonRouter.get(
  "/customer/my-salon/dashboard",
  asyncHandler((req, res) => {
    const result = getMySalonDashboard(req.access, salonContext(req));
    res.json(result);
  })
);

/**
 * GET /customer/my-salon/services
 * Returns active services at the primary salon.
 */
customerMySalonRouter.get(
  "/customer/my-salon/services",
  asyncHandler((req, res) => {
    res.json(getMySalonServices(req.access, salonContext(req)));
  })
);

/**
 * GET /customer/my-salon/staff
 * Returns active staff at the primary salon.
 */
customerMySalonRouter.get(
  "/customer/my-salon/staff",
  asyncHandler((req, res) => {
    res.json(getMySalonStaff(req.access, salonContext(req)));
  })
);

/**
 * GET /customer/my-salon/offers
 * Returns active offers at the primary salon.
 */
customerMySalonRouter.get(
  "/customer/my-salon/offers",
  asyncHandler((req, res) => {
    res.json(getMySalonOffers(req.access, salonContext(req)));
  })
);
