import { columnsFor, db } from "../db.js";
import { badRequest, notFound } from "../utils/app-error.js";

function hasColumn(table, column) {
  return columnsFor(table).includes(column);
}

function parseJson(value, fallback) {
  if (Array.isArray(value) || (value && typeof value === "object")) return value;
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function moneyPaise(value) {
  const amount = Number(value || 0);
  if (!Number.isFinite(amount)) return 0;
  return Math.round(amount * 100);
}

function tableRows(table, where, params, order = "") {
  const suffix = order ? ` ${order}` : "";
  return db.prepare(`SELECT * FROM ${table} WHERE ${where}${suffix}`).all(params);
}

function resolveTenant(tenantSlug) {
  if (!tenantSlug) throw badRequest("tenantSlug is required");
  const tenant = db.prepare("SELECT * FROM tenants WHERE id = ? OR slug = ?").get(tenantSlug, tenantSlug);
  if (!tenant) throw notFound("Online booking tenant not found");
  return tenant;
}

function resolveBranch(tenantId, branchSlug = "") {
  const clauses = ["tenantId = @tenantId", "status = 'active'"];
  const params = { tenantId, branchSlug };
  if (branchSlug) {
    clauses.push(hasColumn("branches", "slug") ? "(id = @branchSlug OR slug = @branchSlug)" : "id = @branchSlug");
  }
  const branch = db.prepare(`SELECT * FROM branches WHERE ${clauses.join(" AND ")} ORDER BY name LIMIT 1`).get(params);
  if (!branch) throw notFound("Online booking branch not found");
  return branch;
}

function serviceRows(tenantId, branchId) {
  const clauses = ["status = 'active'"];
  const params = { tenantId, branchId };
  if (hasColumn("services", "tenantId")) clauses.push("tenantId = @tenantId");
  if (hasColumn("services", "branchId")) clauses.push("(branchId = @branchId OR branchId = '')");
  if (hasColumn("services", "onlineBookable")) clauses.push("COALESCE(onlineBookable, 1) = 1");
  return tableRows("services", clauses.join(" AND "), params, "ORDER BY category, name");
}

function staffRows(tenantId, branchId) {
  const clauses = ["status = 'active'"];
  const params = { tenantId, branchId };
  if (hasColumn("staff", "tenantId")) clauses.push("tenantId = @tenantId");
  if (hasColumn("staff", "branchId")) clauses.push("branchId = @branchId");
  return tableRows("staff", clauses.join(" AND "), params, "ORDER BY name");
}

function reviewRows(tenantId, branchId) {
  const clauses = ["tenantId = @tenantId", "(branchId = @branchId OR branchId = '')", "rating >= 4"];
  return tableRows(
    "reputation_reviews",
    clauses.join(" AND "),
    { tenantId, branchId },
    "ORDER BY createdAt DESC LIMIT 12"
  );
}

function reviewSummary(reviews) {
  const count = reviews.length;
  const rating = count
    ? Math.round((reviews.reduce((sum, row) => sum + Number(row.rating || 0), 0) / count) * 10) / 10
    : 0;
  const google = reviews.filter((row) => String(row.platform || "").toLowerCase().includes("google"));
  return {
    rating,
    count,
    googleRating: google.length ? Math.round((google.reduce((sum, row) => sum + Number(row.rating || 0), 0) / google.length) * 10) / 10 : 0,
    googleReviewCount: google.length
  };
}

function serviceCard(service, staffById) {
  const assignedStaff = parseJson(service.assignedStaff, []);
  const staff = assignedStaff.map((staffId) => staffById.get(staffId)).filter(Boolean);
  return {
    id: service.id,
    name: service.name,
    category: service.category || "Services",
    durationMinutes: Number(service.durationMinutes || 0),
    pricePaise: moneyPaise(service.price),
    addOns: parseJson(service.addOns, []),
    assignedStaffIds: assignedStaff,
    staff,
    onlineBookable: Number(service.onlineBookable ?? 1) === 1,
    featured: Number(service.onlineFeatured || 0) === 1 || Number(service.featured || 0) === 1
  };
}

function staffCard(person, servicesById) {
  const assignedServices = parseJson(person.assignedServices, []);
  const performance = parseJson(person.performance, {});
  return {
    id: person.id,
    name: person.name,
    role: person.role,
    branchId: person.branchId,
    assignedServiceIds: assignedServices,
    assignedServices: assignedServices.map((serviceId) => servicesById.get(serviceId)).filter(Boolean),
    rating: Number(performance.rating || 0),
    bookings: Number(performance.bookings || 0),
    availableForOnlineBooking: true
  };
}

export const publicBookingProfileService = {
  profile({ tenantSlug = "", branchSlug = "" } = {}) {
    const tenant = resolveTenant(tenantSlug);
    const branch = resolveBranch(tenant.id, branchSlug);
    const services = serviceRows(tenant.id, branch.id);
    const staff = staffRows(tenant.id, branch.id);
    const reviews = reviewRows(tenant.id, branch.id);
    const servicesById = new Map(services.map((service) => [service.id, {
      id: service.id,
      name: service.name,
      category: service.category || "Services",
      durationMinutes: Number(service.durationMinutes || 0),
      pricePaise: moneyPaise(service.price)
    }]));
    const staffCards = staff.map((person) => staffCard(person, servicesById));
    const staffById = new Map(staffCards.map((person) => [person.id, {
      id: person.id,
      name: person.name,
      role: person.role,
      rating: person.rating
    }]));
    const serviceCards = services.map((service) => serviceCard(service, staffById));
    const summary = reviewSummary(reviews);
    const branchTheme = parseJson(branch.themeConfig, {});
    const seo = parseJson(branch.seoConfig, {});
    const googleReviewUrl = seo.googleReviewUrl || branchTheme.googleReviewUrl || "";

    return {
      tenant: {
        id: tenant.id,
        slug: tenant.slug,
        name: tenant.name,
        status: tenant.status
      },
      branch: {
        id: branch.id,
        slug: branch.slug || branch.id,
        name: branch.name,
        city: branch.city || "",
        address: branch.address || "",
        phone: branch.phone || "",
        timezone: branch.timezone || "Asia/Kolkata",
        onlineBookingEnabled: Number(branch.onlineBookingEnabled ?? 1) === 1,
        theme: branchTheme,
        seo
      },
      bookingSettings: {
        instantConfirmation: true,
        anyProfessionalEnabled: true,
        slotEndpoint: "/api/v1/booking-portal/v2/slots",
        sessionEndpoint: "/api/v1/booking-portal/v2/sessions",
        confirmEndpoint: "/api/v1/booking-portal/v2/confirm"
      },
      services: serviceCards,
      categories: [...new Set(serviceCards.map((service) => service.category))],
      staff: staffCards,
      reviews: {
        ...summary,
        googleReviewUrl,
        latest: reviews.slice(0, 6).map((review) => ({
          id: review.id,
          platform: review.platform,
          reviewer: review.reviewer,
          rating: Number(review.rating || 0),
          reviewText: review.reviewText || "",
          sentiment: review.sentiment || "neutral",
          createdAt: review.createdAt
        }))
      },
      salonPicks: serviceCards
        .filter((service) => service.featured || service.rating >= 4.5)
        .slice(0, 6)
    };
  }
};
