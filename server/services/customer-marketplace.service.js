import { columnsFor, db } from "../db.js";
import { badRequest, notFound } from "../utils/app-error.js";

const DEFAULT_TIMEZONE = "Asia/Kolkata";
const DEFAULT_OPEN = "10:00";
const DEFAULT_CLOSE = "20:00";
const IST_OFFSET = "+05:30";
const WEEKDAYS = [
  ["monday", "Monday"],
  ["tuesday", "Tuesday"],
  ["wednesday", "Wednesday"],
  ["thursday", "Thursday"],
  ["friday", "Friday"],
  ["saturday", "Saturday"],
  ["sunday", "Sunday"]
];

function hasColumn(table, column) {
  return columnsFor(table).includes(column);
}

function tableExists(table) {
  return Boolean(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = @table").get({ table }));
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

function slugify(value, fallback = "business") {
  const slug = String(value || fallback)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || fallback;
}

function moneyPaise(value) {
  const amount = Number(value || 0);
  if (!Number.isFinite(amount)) return 0;
  return Math.round(amount * 100);
}

function businessSlug(row) {
  if (row.branchSlug) return row.branchSlug;
  return slugify(`${row.branchName || row.branchId}-${row.branchId}`);
}

function branchArea(branch) {
  const [first] = String(branch.address || "").split(",").map((part) => part.trim()).filter(Boolean);
  return first || branch.city || "";
}

function unique(values) {
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))];
}

function publicProfile(row) {
  if (!tableExists("business_notification_profiles")) return {};
  return db.prepare(`
    SELECT *
    FROM business_notification_profiles
    WHERE tenant_id = @tenantId
      AND (branch_id = @branchId OR branch_id = '')
    ORDER BY CASE WHEN branch_id = @branchId THEN 0 ELSE 1 END
    LIMIT 1
  `).get({ tenantId: row.tenantId, branchId: row.branchId }) || {};
}

function timeToMinutes(value) {
  const match = String(value || "").match(/^(\d{1,2}):(\d{2})/);
  if (!match) return null;
  return Number(match[1]) * 60 + Number(match[2]);
}

function formatTime(value) {
  const minutes = timeToMinutes(value);
  if (minutes === null) return "";
  return displayTime(minutes);
}

function businessHoursRows(hours = {}) {
  return WEEKDAYS.map(([key, label]) => {
    const day = hours?.[key] || {};
    const open = day.open !== false;
    const opensAt = day.opensAt || day.openingTime || DEFAULT_OPEN;
    const closesAt = day.closesAt || day.closingTime || DEFAULT_CLOSE;
    return {
      day: key,
      label,
      open,
      opensAt,
      closesAt,
      display: open ? `${formatTime(opensAt)} - ${formatTime(closesAt)}` : "Closed",
      note: day.note || ""
    };
  });
}

function todayKey(timezone = DEFAULT_TIMEZONE) {
  return new Intl.DateTimeFormat("en-US", { weekday: "long", timeZone: timezone }).format(new Date()).toLowerCase();
}

function currentMinutes(timezone = DEFAULT_TIMEZONE) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: timezone
  }).formatToParts(new Date());
  const hour = Number(parts.find((part) => part.type === "hour")?.value || 0);
  const minute = Number(parts.find((part) => part.type === "minute")?.value || 0);
  return hour * 60 + minute;
}

function currentHours(hours = {}, timezone = DEFAULT_TIMEZONE) {
  const rows = businessHoursRows(hours);
  return rows.find((row) => row.day === todayKey(timezone)) || rows[0];
}

function isOpenNow(hours = {}, timezone = DEFAULT_TIMEZONE, onlineBookingEnabled = true) {
  if (!Object.keys(hours || {}).length) return Number(onlineBookingEnabled ?? 1) === 1;
  const today = currentHours(hours, timezone);
  if (!today?.open) return false;
  const open = timeToMinutes(today.opensAt);
  const close = timeToMinutes(today.closesAt);
  const now = currentMinutes(timezone);
  if (open === null || close === null) return Number(onlineBookingEnabled ?? 1) === 1;
  return now >= open && now < close;
}

function hoursLabel(hours = {}, timezone = DEFAULT_TIMEZONE) {
  if (!Object.keys(hours || {}).length) return "Online booking available";
  const today = currentHours(hours, timezone);
  return today?.open ? `Today ${today.display}` : "Closed today";
}

function activeBusinessRows(params = {}) {
  const clauses = [
    "b.status = 'active'",
    "COALESCE(b.onlineBookingEnabled, 1) = 1",
    "LOWER(COALESCE(t.status, 'active')) NOT IN ('disabled', 'inactive', 'deleted', 'suspended')"
  ];
  const queryParams = {};
  const q = String(params.q || params.query || "").trim();
  if (q) {
    queryParams.q = `%${q.toLowerCase()}%`;
    clauses.push(`(
      LOWER(b.name) LIKE @q
      OR LOWER(t.name) LIKE @q
      OR LOWER(COALESCE(b.city, '')) LIKE @q
      OR LOWER(COALESCE(b.address, '')) LIKE @q
    )`);
  }
  if (params.city) {
    queryParams.city = `%${String(params.city).toLowerCase()}%`;
    clauses.push("LOWER(COALESCE(b.city, '')) LIKE @city");
  }
  if (params.area) {
    queryParams.area = `%${String(params.area).toLowerCase()}%`;
    clauses.push("LOWER(COALESCE(b.address, '')) LIKE @area");
  }

  return db.prepare(`
    SELECT
      t.id AS tenantId,
      t.name AS tenantName,
      t.slug AS tenantSlug,
      t.status AS tenantStatus,
      b.id AS branchId,
      b.name AS branchName,
      b.city,
      b.address,
      b.phone,
      b.timezone,
      b.slug AS branchSlug,
      b.themeConfig,
      b.seoConfig,
      b.onlineBookingEnabled,
      b.createdAt
    FROM branches b
    JOIN tenants t ON t.id = b.tenantId
    WHERE ${clauses.join(" AND ")}
    ORDER BY b.name
  `).all(queryParams);
}

function resolveBusiness(slug) {
  const key = String(slug || "").trim();
  if (!key) throw badRequest("Business slug is required");
  const direct = db.prepare(`
    SELECT
      t.id AS tenantId,
      t.name AS tenantName,
      t.slug AS tenantSlug,
      t.status AS tenantStatus,
      b.id AS branchId,
      b.name AS branchName,
      b.city,
      b.address,
      b.phone,
      b.timezone,
      b.slug AS branchSlug,
      b.themeConfig,
      b.seoConfig,
      b.onlineBookingEnabled,
      b.createdAt
    FROM branches b
    JOIN tenants t ON t.id = b.tenantId
    WHERE b.status = 'active'
      AND COALESCE(b.onlineBookingEnabled, 1) = 1
      AND (b.id = @key OR COALESCE(b.slug, '') = @key OR t.slug = @key)
    ORDER BY b.name
    LIMIT 1
  `).get({ key });
  if (direct) return direct;
  const generated = activeBusinessRows().find((row) => businessSlug(row) === key);
  if (!generated) throw notFound("Business not found");
  return generated;
}

function serviceRows(tenantId, branchId) {
  const clauses = ["s.status = 'active'"];
  const params = { tenantId, branchId };
  if (hasColumn("services", "tenantId")) clauses.push("s.tenantId = @tenantId");
  if (hasColumn("services", "branchId")) clauses.push("(s.branchId = @branchId OR COALESCE(s.branchId, '') = '')");
  if (hasColumn("services", "onlineBookable")) clauses.push("COALESCE(s.onlineBookable, 1) = 1");
  return db.prepare(`
    SELECT s.*
    FROM services s
    WHERE ${clauses.join(" AND ")}
    ORDER BY s.category, s.name
  `).all(params);
}

function staffRows(tenantId, branchId, serviceId = "") {
  const clauses = ["s.status = 'active'"];
  const params = { tenantId, branchId };
  if (hasColumn("staff", "tenantId")) clauses.push("s.tenantId = @tenantId");
  clauses.push("s.branchId = @branchId");
  const rows = db.prepare(`
    SELECT s.*
    FROM staff s
    WHERE ${clauses.join(" AND ")}
    ORDER BY s.name
  `).all(params);
  if (!serviceId) return rows;
  return rows.filter((person) => {
    const assigned = parseJson(person.assignedServices, []);
    return !assigned.length || assigned.includes(serviceId);
  });
}

function reviewRows(tenantId, branchId, limit = 12) {
  if (!tableExists("reputation_reviews")) return [];
  return db.prepare(`
    SELECT *
    FROM reputation_reviews
    WHERE tenantId = @tenantId
      AND (branchId = @branchId OR COALESCE(branchId, '') = '')
      AND LOWER(COALESCE(status, 'new')) NOT IN ('deleted', 'hidden', 'spam')
    ORDER BY datetime(createdAt) DESC
    LIMIT @limit
  `).all({ tenantId, branchId, limit });
}

function reviewAverage(reviews) {
  if (!reviews.length) return 0;
  return Math.round((reviews.reduce((sum, review) => sum + Number(review.rating || 0), 0) / reviews.length) * 10) / 10;
}

function serviceItem(service, businessId = "") {
  return {
    id: service.id,
    businessId: service.branchId || businessId,
    name: service.name,
    description: service.description || "",
    durationMinutes: Number(service.durationMinutes || 0),
    pricePaise: moneyPaise(service.price),
    category: service.category || "Services",
    popular: Number(service.onlineFeatured || service.featured || 0) === 1,
    active: service.status === "active"
  };
}

function staffMember(person, serviceIds = []) {
  const performance = parseJson(person.performance, {});
  const assigned = parseJson(person.assignedServices, []);
  return {
    id: person.id,
    businessId: person.branchId || "",
    name: person.name,
    title: person.role || "Professional",
    rating: Number(performance.rating || 0),
    specialty: assigned.length ? assigned.join(", ") : person.role || "",
    image: person.image || "",
    nextAvailable: "",
    bookableServiceIds: assigned.length ? assigned : serviceIds
  };
}

function businessReview(review) {
  return {
    id: review.id,
    businessId: review.branchId || "",
    author: review.reviewer || "Customer",
    rating: Number(review.rating || 0),
    text: review.reviewText || "",
    createdAt: review.createdAt,
    dateLabel: review.createdAt ? new Date(review.createdAt).toLocaleDateString("en-IN", { month: "short", day: "numeric" }) : ""
  };
}

function mapBusiness(row, { includeDetails = false } = {}) {
  const services = serviceRows(row.tenantId, row.branchId).map((service) => serviceItem(service, row.branchId));
  const staff = includeDetails ? staffRows(row.tenantId, row.branchId).map((person) => staffMember(person, services.map((service) => service.id))) : [];
  const reviews = reviewRows(row.tenantId, row.branchId);
  const categories = unique(services.map((service) => service.category));
  const theme = parseJson(row.themeConfig, {});
  const seo = parseJson(row.seoConfig, {});
  const profile = publicProfile(row);
  const socialLinks = parseJson(profile.social_links_json, {});
  const businessHours = parseJson(profile.business_hours_json, {});
  const publishBusinessHours = socialLinks.showBusinessHours !== false;
  const profileGallery = Array.isArray(socialLinks.galleryImages) ? socialLinks.galleryImages : String(socialLinks.galleryImages || "").split(/[\n,;]/);
  const gallery = [
    ...profileGallery,
    ...(Array.isArray(theme.galleryImages) ? theme.galleryImages : []),
    ...(Array.isArray(seo.galleryImages) ? seo.galleryImages : [])
  ].filter(Boolean);
  const startingPrice = services.length ? Math.min(...services.map((service) => service.pricePaise || 0).filter((price) => price > 0)) : 0;
  const timezone = row.timezone || DEFAULT_TIMEZONE;
  const businessName = profile.business_name || row.branchName;
  const city = profile.city || row.city || "";
  const address = profile.address || row.address || city || "";
  const description = profile.about_us || seo.description || theme.description || `${businessName} accepts online bookings in ${city || "your city"}.`;
  const coverImage = socialLinks.coverImage || socialLinks.coverImageUrl || theme.coverImage || seo.image || profile.logo_url || "";
  return {
    id: row.branchId,
    slug: businessSlug(row),
    tenantId: row.tenantId,
    branchId: row.branchId,
    businessName,
    category: categories[0] || "Salon & wellness",
    description,
    address,
    area: branchArea({ ...row, address, city }),
    city,
    state: profile.state || "",
    postalCode: profile.postal_code || "",
    country: profile.country || "India - IN",
    phone: profile.appointment_number || profile.mobile_number || row.phone || "",
    mobileNumber: profile.mobile_number || "",
    telephoneNumber: profile.telephone_number || "",
    appointmentNumber: profile.appointment_number || "",
    logoUrl: profile.logo_url || "",
    websiteUrl: socialLinks.website || "",
    instagramUrl: socialLinks.instagram || "",
    mapsUrl: socialLinks.mapsUrl || socialLinks.googleMaps || "",
    ratingAverage: reviewAverage(reviews),
    ratingCount: reviews.length,
    createdAt: row.createdAt,
    isOpen: publishBusinessHours ? isOpenNow(businessHours, timezone, row.onlineBookingEnabled) : Number(row.onlineBookingEnabled ?? 1) === 1,
    hoursLabel: publishBusinessHours ? hoursLabel(businessHours, timezone) || theme.hoursLabel || "Online booking available" : "",
    openingTime: currentHours(businessHours, timezone)?.opensAt || theme.openingTime || DEFAULT_OPEN,
    closingTime: currentHours(businessHours, timezone)?.closesAt || theme.closingTime || DEFAULT_CLOSE,
    timezone,
    businessHours: publishBusinessHours ? businessHoursRows(businessHours) : [],
    nextAvailableSlot: "",
    hasOffer: false,
    coverGradient: theme.coverGradient || "linear-gradient(135deg, #12211d, #3f7b68)",
    coverImage,
    galleryImages: unique(gallery),
    popularService: services[0]?.name || "",
    startingPricePaise: startingPrice,
    categories,
    services: includeDetails ? services : services.slice(0, 4),
    staff,
    reviews: includeDetails ? reviews.map(businessReview) : [],
    policies: [
      "Bookings are subject to branch confirmation and staff availability.",
      "Cancellation and payment rules follow the selected branch policy."
    ],
    paymentModes: ["pay_at_venue", "online"]
  };
}

function filterAndSortBusinesses(rows, params = {}) {
  let businesses = rows.map((row) => mapBusiness(row));
  if (params.category) {
    const category = String(params.category).toLowerCase();
    businesses = businesses.filter((business) => business.categories.some((item) => item.toLowerCase() === category || slugify(item) === category));
  }
  if (String(params.openNow) === "true") {
    businesses = businesses.filter((business) => business.isOpen);
  }
  if (String(params.offers) === "true") {
    businesses = businesses.filter((business) => business.hasOffer);
  }
  if (String(params.availableToday) === "true") {
    businesses = businesses.filter((business) => business.services.length > 0);
  }
  if (params.minPricePaise) {
    const min = Number(params.minPricePaise || 0);
    businesses = businesses.filter((business) => business.startingPricePaise >= min);
  }
  if (params.maxPricePaise) {
    const max = Number(params.maxPricePaise || 0);
    businesses = businesses.filter((business) => business.startingPricePaise <= max);
  }
  if (params.sort === "rating" || String(params.topRated) === "true") {
    businesses.sort((a, b) => b.ratingAverage - a.ratingAverage || b.ratingCount - a.ratingCount || a.businessName.localeCompare(b.businessName));
  } else if (params.sort === "price") {
    businesses.sort((a, b) => a.startingPricePaise - b.startingPricePaise || a.businessName.localeCompare(b.businessName));
  }
  const limit = Math.max(1, Math.min(Number(params.limit || 48), 100));
  return businesses.slice(0, limit);
}

function categoryRows() {
  const rows = db.prepare(`
    SELECT DISTINCT s.category AS category
    FROM services s
    JOIN tenants t ON t.id = s.tenantId
    WHERE s.status = 'active'
      AND COALESCE(s.onlineBookable, 1) = 1
      AND LOWER(COALESCE(t.status, 'active')) NOT IN ('disabled', 'inactive', 'deleted', 'suspended')
    ORDER BY s.category
  `).all();
  return rows
    .map((row) => String(row.category || "").trim())
    .filter(Boolean)
    .map((label) => ({ id: slugify(label), label, slug: slugify(label) }));
}

function addDays(date, days) {
  const [year, month, day] = String(date).slice(0, 10).split("-").map(Number);
  const next = new Date(Date.UTC(year, month - 1, day + days));
  return next.toISOString().slice(0, 10);
}

function slotIso(date, minutes) {
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  return `${date}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00${IST_OFFSET}`;
}

function displayTime(minutes) {
  const hour24 = Math.floor(minutes / 60);
  const minute = minutes % 60;
  const suffix = hour24 >= 12 ? "PM" : "AM";
  const hour = hour24 % 12 || 12;
  return `${hour}:${String(minute).padStart(2, "0")} ${suffix}`;
}

function periodLabel(minutes) {
  if (minutes < 12 * 60) return "Morning";
  if (minutes < 17 * 60) return "Afternoon";
  return "Evening";
}

function appointmentRows(tenantId, branchId, rangeStart, rangeEnd) {
  return db.prepare(`
    SELECT id, staffId, startAt, endAt, status
    FROM appointments
    WHERE tenantId = @tenantId
      AND branchId = @branchId
      AND LOWER(COALESCE(status, '')) NOT IN ('cancelled', 'completed', 'no_show')
      AND datetime(startAt) < datetime(@rangeEnd)
      AND datetime(COALESCE(endAt, startAt)) > datetime(@rangeStart)
  `).all({ tenantId, branchId, rangeStart, rangeEnd });
}

function overlaps(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && aEnd > bStart;
}

function isStaffFree(person, appointments, startAt, endAt) {
  return !appointments.some((appointment) => {
    if (appointment.staffId && appointment.staffId !== person.id) return false;
    const appointmentStart = new Date(appointment.startAt).getTime();
    const appointmentEnd = new Date(appointment.endAt || appointment.startAt).getTime();
    return overlaps(startAt, endAt, appointmentStart, appointmentEnd);
  });
}

function availabilityDay({ date, service, staff, appointments }) {
  const duration = Math.max(15, Number(service.durationMinutes || 60));
  const openMinutes = 10 * 60;
  const closeMinutes = 20 * 60;
  const now = Date.now() + 30 * 60 * 1000;
  const groups = new Map();
  for (let minutes = openMinutes; minutes + duration <= closeMinutes; minutes += 30) {
    const start = new Date(slotIso(date, minutes)).getTime();
    const end = start + duration * 60 * 1000;
    if (start < now) continue;
    const availableStaff = staff.find((person) => isStaffFree(person, appointments, start, end));
    if (!availableStaff) continue;
    const label = periodLabel(minutes);
    const slots = groups.get(label) || [];
    slots.push({
      startAt: new Date(start).toISOString(),
      endAt: new Date(end).toISOString(),
      displayTime: displayTime(minutes),
      available: true,
      staffId: availableStaff.id
    });
    groups.set(label, slots);
  }
  const day = new Date(`${date}T00:00:00${IST_OFFSET}`);
  return {
    date,
    label: day.toLocaleDateString("en-IN", { month: "short", day: "numeric" }),
    dayLabel: day.toLocaleDateString("en-IN", { weekday: "short" }),
    periods: [...groups.entries()].map(([label, slots]) => ({ label, slots }))
  };
}

export const customerMarketplaceService = {
  listBusinesses(params = {}) {
    return filterAndSortBusinesses(activeBusinessRows(params), params);
  },

  business(slug) {
    return mapBusiness(resolveBusiness(slug), { includeDetails: true });
  },

  services(slug) {
    const business = resolveBusiness(slug);
    return serviceRows(business.tenantId, business.branchId).map((service) => serviceItem(service, business.branchId));
  },

  staff(slug) {
    const business = resolveBusiness(slug);
    const services = serviceRows(business.tenantId, business.branchId).map((service) => service.id);
    return staffRows(business.tenantId, business.branchId).map((person) => staffMember(person, services));
  },

  reviews(slug) {
    const business = resolveBusiness(slug);
    return reviewRows(business.tenantId, business.branchId).map(businessReview);
  },

  categories() {
    return categoryRows();
  },

  membershipPlans({ branchId = "" } = {}) {
    if (!tableExists("membership_plans")) return [];
    const clauses = ["status = 'active'"];
    const params = { branchId };
    if (branchId) clauses.push("(branch_id = @branchId OR COALESCE(branch_id, '') = '')");
    return db.prepare(`
      SELECT *
      FROM membership_plans
      WHERE ${clauses.join(" AND ")}
      ORDER BY name
    `).all(params).map((plan) => ({
      id: plan.id,
      branchId: plan.branch_id || "",
      code: plan.code,
      name: plan.name,
      description: plan.description || "",
      pricePaise: moneyPaise(plan.price),
      validityDays: Number(plan.validity_days || 0),
      discountPercent: Number(plan.discount_percent || 0),
      productDiscountPercent: Number(plan.product_discount_percent || 0),
      includedServices: parseJson(plan.included_services_json, []),
      benefitRules: parseJson(plan.benefit_rules_json, {})
    }));
  },

  availability(slug, query = {}) {
    const business = resolveBusiness(slug);
    const serviceId = String(query.serviceId || "").trim();
    if (!serviceId) throw badRequest("serviceId is required");
    const service = serviceRows(business.tenantId, business.branchId).find((item) => item.id === serviceId);
    if (!service) throw notFound("Service is not available for online booking");
    const staff = staffRows(business.tenantId, business.branchId, serviceId)
      .filter((person) => !query.staffId || person.id === query.staffId);
    if (!staff.length) return [];
    const startDate = String(query.date || new Date().toISOString().slice(0, 10)).slice(0, 10);
    const dates = Array.from({ length: 7 }, (_value, index) => addDays(startDate, index));
    const rangeStart = new Date(`${dates[0]}T00:00:00${IST_OFFSET}`).toISOString();
    const rangeEnd = new Date(`${addDays(dates[dates.length - 1], 1)}T00:00:00${IST_OFFSET}`).toISOString();
    const appointments = appointmentRows(business.tenantId, business.branchId, rangeStart, rangeEnd);
    return dates
      .map((date) => availabilityDay({ date, service, staff, appointments }))
      .filter((day) => day.periods.length > 0);
  }
};
