import { Router } from "express";
import { asyncHandler } from "../middleware/async-handler.js";
import { publicBookingRateLimit } from "../middleware/public-booking-rate-limit.middleware.js";
import { publicBookingProfileService } from "../services/public-booking-profile.service.js";
import { enrichServicesWithHappyHours } from "../utils/happy-hours-portal-enrichment.js";

export const publicBookingProfileRouter = Router();

publicBookingProfileRouter.use("/booking-profile", publicBookingRateLimit({ max: 90, windowMs: 60_000 }));

function withHappyHours(profile = {}) {
  const scope = { tenantId: profile.tenant?.id || "", branchId: profile.branch?.id || "" };
  const services = enrichServicesWithHappyHours(profile.services || [], scope);
  const byId = new Map(services.map((service) => [service.id, service]));
  return {
    ...profile,
    services,
    salonPicks: (profile.salonPicks || []).map((service) => byId.get(service.id) || service)
  };
}

publicBookingProfileRouter.get(
  "/booking-profile/:tenantSlug",
  asyncHandler((req, res) => {
    res.json(withHappyHours(publicBookingProfileService.profile({
      tenantSlug: req.params.tenantSlug,
      branchSlug: req.query.branch || req.query.branchSlug || req.query.branchId || ""
    })));
  })
);

publicBookingProfileRouter.get(
  "/booking-profile/:tenantSlug/:branchSlug",
  asyncHandler((req, res) => {
    res.json(withHappyHours(publicBookingProfileService.profile({
      tenantSlug: req.params.tenantSlug,
      branchSlug: req.params.branchSlug
    })));
  })
);
