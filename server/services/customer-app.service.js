import { randomUUID } from "node:crypto";
import { columnsFor, db, insertRow, tableHasColumn, updateRow } from "../db.js";
import { badRequest, notFound, unauthorized } from "../utils/app-error.js";
import { customerMarketplaceService } from "./customer-marketplace.service.js";

const now = () => new Date().toISOString();
const id = (prefix) => `${prefix}_${randomUUID().slice(0, 10)}`;

function tableExists(table) {
  return Boolean(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = @table").get({ table }));
}

function json(value, fallback) {
  if (Array.isArray(value) || (value && typeof value === "object")) return value;
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function paiseFromRupees(value) {
  const amount = Number(value || 0);
  return Number.isFinite(amount) ? Math.round(amount * 100) : 0;
}

function rupeesFromPaise(value) {
  const amount = Number(value || 0);
  return Number.isFinite(amount) ? Math.round(amount) / 100 : 0;
}

function assertCustomer(access = {}) {
  if (access.role !== "customer" || !access.userId) throw unauthorized("Customer session is required");
}

function client(access = {}) {
  assertCustomer(access);
  const tenantSql = tableHasColumn("clients", "tenantId") ? "tenantId = @tenantId AND " : "";
  const row = db.prepare(`SELECT * FROM clients WHERE ${tenantSql}id = @clientId LIMIT 1`).get({ tenantId: access.tenantId, clientId: access.userId });
  if (!row) throw unauthorized("Customer session is invalid");
  return row;
}

function ensureSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS customerFavorites (
      id TEXT PRIMARY KEY,
      tenantId TEXT NOT NULL,
      branchId TEXT NOT NULL DEFAULT '',
      customerId TEXT NOT NULL,
      businessId TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      UNIQUE(tenantId, customerId, businessId)
    );
    CREATE INDEX IF NOT EXISTS idx_customerFavorites_customer ON customerFavorites(tenantId, customerId, createdAt);

    CREATE TABLE IF NOT EXISTS customerWaitlistEntries (
      id TEXT PRIMARY KEY,
      tenantId TEXT NOT NULL,
      branchId TEXT NOT NULL DEFAULT '',
      customerId TEXT NOT NULL,
      bookingId TEXT NOT NULL,
      businessId TEXT NOT NULL,
      serviceId TEXT NOT NULL,
      staffId TEXT DEFAULT '',
      preferredDate TEXT DEFAULT '',
      reason TEXT DEFAULT '',
      priority TEXT DEFAULT 'normal',
      status TEXT DEFAULT 'open',
      recommendations TEXT DEFAULT '[]',
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_customerWaitlistEntries_customer ON customerWaitlistEntries(tenantId, customerId, createdAt);

    CREATE TABLE IF NOT EXISTS customerBookingReviews (
      id TEXT PRIMARY KEY,
      tenantId TEXT NOT NULL,
      branchId TEXT NOT NULL DEFAULT '',
      customerId TEXT NOT NULL,
      bookingId TEXT NOT NULL,
      businessId TEXT NOT NULL,
      rating INTEGER NOT NULL,
      text TEXT DEFAULT '',
      status TEXT DEFAULT 'published',
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      UNIQUE(tenantId, customerId, bookingId)
    );
    CREATE INDEX IF NOT EXISTS idx_customerBookingReviews_business ON customerBookingReviews(tenantId, businessId, createdAt);
  `);
}

ensureSchema();

function appointmentSelectWhere(access, extra = "") {
  const tenantClause = tableHasColumn("appointments", "tenantId") ? "a.tenantId = @tenantId AND " : "";
  return `${tenantClause}a.clientId = @clientId${extra}`;
}

function serviceById(serviceId, businessSlug = "") {
  if (!serviceId) return null;
  if (businessSlug) {
    return customerMarketplaceService.services(businessSlug).find((service) => service.id === serviceId) || null;
  }
  const tenantClause = tableHasColumn("services", "tenantId") ? "tenantId = @tenantId AND " : "";
  return db.prepare(`SELECT * FROM services WHERE ${tenantClause}id = @serviceId LIMIT 1`).get({ tenantId: "", serviceId }) || null;
}

function branchById(branchId) {
  return db.prepare("SELECT * FROM branches WHERE id = @branchId LIMIT 1").get({ branchId }) || {};
}

function staffById(staffId) {
  if (!staffId) return {};
  return db.prepare("SELECT * FROM staff WHERE id = @staffId LIMIT 1").get({ staffId }) || {};
}

function businessForBranch(branchId) {
  const branch = branchById(branchId);
  if (!branch.id) return null;
  const slug = branch.slug || `${String(branch.name || branch.id).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")}-${branch.id}`;
  try {
    return customerMarketplaceService.business(slug);
  } catch {
    return {
      id: branch.id,
      branchId: branch.id,
      businessName: branch.name || "Aura Salon",
      address: branch.address || branch.city || "",
      latitude: null,
      longitude: null
    };
  }
}

function serviceIds(row = {}) {
  const parsed = json(row.serviceIds, []);
  return Array.isArray(parsed) ? parsed : [];
}

function mapBooking(row = {}) {
  const ids = serviceIds(row);
  const serviceId = ids[0] || "";
  const service = serviceId ? db.prepare("SELECT * FROM services WHERE id = @serviceId LIMIT 1").get({ serviceId }) || {} : {};
  const staff = staffById(row.staffId || "");
  const business = businessForBranch(row.branchId || "") || {};
  const startAt = row.startAt || "";
  return {
    id: row.id,
    reference: row.id,
    businessId: business.id || row.branchId || "",
    businessName: business.businessName || "Aura Salon",
    serviceId,
    serviceName: service.name || "Salon service",
    staffId: row.staffId || "",
    staffName: staff.name || "Professional",
    startAt,
    startsAt: startAt,
    displayStartAt: startAt ? new Date(startAt).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : "",
    endAt: row.endAt || "",
    endsAt: row.endAt || "",
    durationMinutes: Number(service.durationMinutes || 0),
    serviceDurationMinutes: Number(service.durationMinutes || 0),
    address: business.address || "",
    latitude: business.latitude ?? null,
    longitude: business.longitude ?? null,
    status: row.status === "cancelled" ? "cancelled" : row.status === "completed" ? "completed" : "confirmed",
    paymentStatus: "not_required",
    cancellationPolicy: "Cancel or reschedule from the app before the branch cutoff time."
  };
}

function bookings(access, status = "") {
  client(access);
  const params = { tenantId: access.tenantId, clientId: access.userId };
  let statusSql = "";
  if (status === "cancelled") statusSql = " AND LOWER(COALESCE(a.status, '')) = 'cancelled'";
  if (status === "upcoming") statusSql = " AND LOWER(COALESCE(a.status, '')) NOT IN ('cancelled', 'completed', 'no_show')";
  if (status === "past") statusSql = " AND (LOWER(COALESCE(a.status, '')) IN ('completed', 'no_show') OR datetime(a.startAt) < datetime('now'))";
  return db.prepare(`
    SELECT a.*
    FROM appointments a
    WHERE ${appointmentSelectWhere(access, statusSql)}
    ORDER BY datetime(a.startAt) DESC
    LIMIT 100
  `).all(params).map(mapBooking);
}

function bookingById(access, bookingId) {
  client(access);
  const row = db.prepare(`
    SELECT a.*
    FROM appointments a
    WHERE ${appointmentSelectWhere(access, " AND a.id = @bookingId")}
    LIMIT 1
  `).get({ tenantId: access.tenantId, clientId: access.userId, bookingId });
  if (!row) throw notFound("Booking not found");
  return row;
}

function addMinutesIso(startAt, minutes) {
  const date = new Date(startAt);
  date.setMinutes(date.getMinutes() + Math.max(15, Number(minutes || 60)));
  return date.toISOString();
}

function createBooking(access, payload = {}) {
  client(access);
  const business = customerMarketplaceService.business(payload.businessSlug || payload.businessId || "");
  const service = customerMarketplaceService.services(business.slug).find((item) => item.id === payload.serviceId);
  if (!service) throw badRequest("Selected service is not available");
  const staff = customerMarketplaceService.staff(business.slug);
  const person = staff.find((item) => item.id === payload.staffId) || staff[0];
  if (!person) throw badRequest("No bookable professional is available for this branch");
  if (!payload.startAt) throw badRequest("startAt is required");
  const created = insertRow("appointments", {
    id: id("appt"),
    tenantId: business.tenantId || access.tenantId,
    clientId: access.userId,
    staffId: person.id,
    branchId: business.branchId || business.id,
    serviceIds: [service.id],
    startAt: payload.startAt,
    endAt: addMinutesIso(payload.startAt, service.durationMinutes),
    status: "booked",
    source: "customer-app",
    onlineStatus: "pending-confirmation",
    notes: payload.notes || "",
    billable: 1
  });
  return mapBooking(created);
}

function cancelBooking(access, bookingId, payload = {}) {
  const row = bookingById(access, bookingId);
  const updated = updateRow("appointments", row.id, { status: "cancelled", notes: [row.notes, payload.reason ? `Customer cancel reason: ${payload.reason}` : "Customer cancelled from app"].filter(Boolean).join("\n") }, { tenantId: access.tenantId });
  return mapBooking(updated);
}

function rescheduleBooking(access, bookingId, payload = {}) {
  const row = bookingById(access, bookingId);
  if (!payload.startAt) throw badRequest("startAt is required");
  const serviceId = serviceIds(row)[0] || "";
  const service = serviceId ? db.prepare("SELECT * FROM services WHERE id = @serviceId LIMIT 1").get({ serviceId }) || {} : {};
  const updated = updateRow("appointments", row.id, {
    startAt: payload.startAt,
    endAt: addMinutesIso(payload.startAt, service.durationMinutes || 60),
    staffId: payload.staffId || row.staffId,
    status: "booked"
  }, { tenantId: access.tenantId });
  return mapBooking(updated);
}

function waitlist(access, bookingId, payload = {}) {
  const row = bookingById(access, bookingId);
  const serviceId = payload.serviceId || serviceIds(row)[0] || "";
  const business = businessForBranch(row.branchId) || {};
  const service = serviceId ? db.prepare("SELECT * FROM services WHERE id = @serviceId LIMIT 1").get({ serviceId }) || {} : {};
  const recommendationStart = payload.preferredDate ? `${String(payload.preferredDate).slice(0, 10)}T10:00:00.000Z` : row.startAt;
  const entry = {
    id: id("wait"),
    tenantId: access.tenantId,
    branchId: row.branchId || "",
    customerId: access.userId,
    bookingId: row.id,
    businessId: row.branchId || "",
    serviceId,
    staffId: payload.staffId || row.staffId || "",
    preferredDate: payload.preferredDate || String(row.startAt || "").slice(0, 10),
    reason: payload.reason || "",
    priority: payload.priority === "high" ? "high" : "normal",
    status: "open",
    recommendations: JSON.stringify([{ startAt: recommendationStart, staffId: payload.staffId || row.staffId || "", displayTime: recommendationStart ? new Date(recommendationStart).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" }) : "" }]),
    createdAt: now(),
    updatedAt: now()
  };
  db.prepare(`INSERT INTO customerWaitlistEntries (${Object.keys(entry).join(", ")}) VALUES (${Object.keys(entry).map((key) => `@${key}`).join(", ")})`).run(entry);
  return {
    id: entry.id,
    bookingId: row.id,
    businessId: row.branchId || "",
    businessName: business.businessName || "Aura Salon",
    serviceId,
    serviceName: service.name || "Salon service",
    preferredDate: entry.preferredDate,
    status: entry.status,
    recommendations: json(entry.recommendations, [])
  };
}

function reviewBooking(access, bookingId, payload = {}) {
  const row = bookingById(access, bookingId);
  const rating = Math.max(1, Math.min(5, Number(payload.rating || 0)));
  if (!rating) throw badRequest("rating is required");
  const record = {
    id: id("rev"),
    tenantId: access.tenantId,
    branchId: row.branchId || "",
    customerId: access.userId,
    bookingId: row.id,
    businessId: row.branchId || "",
    rating,
    text: String(payload.text || "").trim(),
    status: "published",
    createdAt: now(),
    updatedAt: now()
  };
  db.prepare(`
    INSERT INTO customerBookingReviews (${Object.keys(record).join(", ")})
    VALUES (${Object.keys(record).map((key) => `@${key}`).join(", ")})
    ON CONFLICT(tenantId, customerId, bookingId) DO UPDATE SET rating = excluded.rating, text = excluded.text, updatedAt = excluded.updatedAt
  `).run(record);
  return { id: record.id, businessId: record.businessId, author: client(access).name || "Customer", rating, text: record.text, createdAt: record.createdAt };
}

function favoriteRows(access) {
  client(access);
  return db.prepare(`SELECT * FROM customerFavorites WHERE tenantId = @tenantId AND customerId = @customerId ORDER BY datetime(createdAt) DESC`).all({ tenantId: access.tenantId, customerId: access.userId });
}

function favoriteDto(row) {
  const business = businessForBranch(row.businessId);
  return { businessId: row.businessId, createdAt: row.createdAt, business };
}

function listFavorites(access) {
  return favoriteRows(access).map(favoriteDto);
}

function addFavorite(access, businessId) {
  client(access);
  const business = businessForBranch(businessId) || customerMarketplaceService.business(businessId);
  const row = {
    id: id("fav"),
    tenantId: access.tenantId,
    branchId: business.branchId || business.id || businessId,
    customerId: access.userId,
    businessId: business.branchId || business.id || businessId,
    createdAt: now(),
    updatedAt: now()
  };
  db.prepare(`
    INSERT INTO customerFavorites (${Object.keys(row).join(", ")})
    VALUES (${Object.keys(row).map((key) => `@${key}`).join(", ")})
    ON CONFLICT(tenantId, customerId, businessId) DO UPDATE SET updatedAt = excluded.updatedAt
  `).run(row);
  return favoriteDto(row);
}

function removeFavorite(access, businessId) {
  client(access);
  db.prepare(`DELETE FROM customerFavorites WHERE tenantId = @tenantId AND customerId = @customerId AND businessId = @businessId`).run({ tenantId: access.tenantId, customerId: access.userId, businessId });
}

function rewards(access) {
  const row = client(access);
  return {
    loyaltyPoints: Number(row.loyaltyPoints || 0),
    tier: Number(row.loyaltyPoints || 0) >= 1000 ? "Gold" : Number(row.loyaltyPoints || 0) >= 500 ? "Silver" : "Classic",
    history: []
  };
}

function wallet(access) {
  const row = client(access);
  const transactions = tableExists("wallet_transactions")
    ? db.prepare(`SELECT * FROM wallet_transactions WHERE tenantId = @tenantId AND clientId = @clientId ORDER BY datetime(createdAt) DESC LIMIT 50`).all({ tenantId: access.tenantId, clientId: access.userId })
    : [];
  return {
    balancePaise: paiseFromRupees(row.walletBalance || 0),
    transactions: transactions.map((item) => ({
      id: item.id,
      type: item.type,
      amountPaise: paiseFromRupees(item.amount),
      balanceAfterPaise: paiseFromRupees(item.balanceAfter),
      referenceType: item.referenceType || "",
      referenceId: item.referenceId || "",
      notes: item.notes || "",
      metadata: json(item.metadata, {}),
      createdAt: item.createdAt || ""
    }))
  };
}

function memberships(access) {
  client(access);
  return db.prepare(`SELECT * FROM memberships WHERE clientId = @clientId ORDER BY datetime(createdAt) DESC`).all({ clientId: access.userId }).map((item) => ({
    id: item.id,
    planName: item.planName,
    pricePaise: paiseFromRupees(item.price),
    planCredits: Number(item.planCredits || 0),
    creditsRemaining: Number(item.creditsRemaining || 0),
    serviceCredits: json(item.serviceCredits, []),
    validityDate: item.validityDate || "",
    autoRenew: Boolean(item.autoRenew),
    loyaltyMultiplier: Number(item.loyaltyMultiplier || 1),
    status: item.status || "active",
    redeemHistory: json(item.redeemHistory, []),
    branchId: item.branchId || "",
    createdAt: item.createdAt || "",
    updatedAt: item.updatedAt || ""
  }));
}

function buyMembership(access, planId, branchId = "") {
  client(access);
  const plan = customerMarketplaceService.membershipPlans({ branchId }).find((item) => item.id === planId);
  if (!plan) throw notFound("Membership plan not found");
  const created = insertRow("memberships", {
    id: id("mem"),
    clientId: access.userId,
    planName: plan.name,
    price: rupeesFromPaise(plan.pricePaise),
    planCredits: 0,
    creditsRemaining: 0,
    serviceCredits: [],
    validityDate: new Date(Date.now() + Math.max(1, Number(plan.validityDays || 30)) * 86400000).toISOString().slice(0, 10),
    autoRenew: 0,
    loyaltyMultiplier: 1,
    status: "active",
    redeemHistory: [],
    branchId: plan.branchId || branchId || ""
  });
  return { membership: memberships(access).find((item) => item.id === created.id), paymentRequired: plan.pricePaise > 0, amountPaise: plan.pricePaise };
}

function packages(access) {
  client(access);
  if (!tableExists("packages")) return [];
  return db.prepare(`SELECT * FROM packages WHERE tenantId = @tenantId AND status = 'active' ORDER BY datetime(createdAt) DESC LIMIT 50`).all({ tenantId: access.tenantId }).map((item) => ({
    id: item.id,
    name: item.name,
    pricePaise: paiseFromRupees(item.price),
    creditsRemaining: 0,
    status: item.status || "active",
    createdAt: item.createdAt || "",
    updatedAt: item.updatedAt || ""
  }));
}

function giftCards(access) {
  client(access);
  return db.prepare(`SELECT * FROM gift_cards WHERE clientId = @clientId ORDER BY datetime(createdAt) DESC`).all({ clientId: access.userId }).map((item) => ({
    id: item.id,
    code: item.code,
    initialValuePaise: paiseFromRupees(item.initialValue),
    balancePaise: paiseFromRupees(item.balance),
    expiryDate: item.expiryDate || "",
    status: item.status || "active",
    redeemHistory: json(item.redeemHistory, []),
    createdAt: item.createdAt || "",
    updatedAt: item.updatedAt || ""
  }));
}

function purchaseGiftCard(access, payload = {}) {
  client(access);
  const amountPaise = Math.max(100, Number(payload.amountPaise || 0));
  const created = insertRow("gift_cards", {
    id: id("gift"),
    code: `AURA${randomUUID().slice(0, 8).toUpperCase()}`,
    clientId: access.userId,
    initialValue: rupeesFromPaise(amountPaise),
    balance: rupeesFromPaise(amountPaise),
    expiryDate: payload.expiryDate || new Date(Date.now() + 365 * 86400000).toISOString().slice(0, 10),
    status: "active",
    redeemHistory: []
  });
  return giftCards(access).find((item) => item.id === created.id);
}

function redeemGiftCard(access, payload = {}) {
  client(access);
  const amountPaise = Math.max(1, Number(payload.amountPaise || 0));
  const card = db.prepare(`SELECT * FROM gift_cards WHERE code = @code AND clientId = @clientId LIMIT 1`).get({ code: payload.code, clientId: access.userId });
  if (!card) throw notFound("Gift card not found");
  const balancePaise = paiseFromRupees(card.balance);
  if (balancePaise < amountPaise) throw badRequest("Gift card balance is insufficient");
  const history = json(card.redeemHistory, []);
  history.push({ invoiceId: payload.invoiceId || "", amountPaise, createdAt: now() });
  updateRow("gift_cards", card.id, { balance: rupeesFromPaise(balancePaise - amountPaise), redeemHistory: history, status: balancePaise - amountPaise <= 0 ? "redeemed" : "active" });
  return { giftCardId: card.id, invoiceId: payload.invoiceId || "", amountPaise, balanceAfterPaise: balancePaise - amountPaise };
}

function invoices(access) {
  client(access);
  const tenantColumn = tableHasColumn("invoices", "tenantId") ? "tenantId = @tenantId AND " : "";
  return db.prepare(`SELECT * FROM invoices WHERE ${tenantColumn}clientId = @clientId ORDER BY datetime(createdAt) DESC LIMIT 100`).all({ tenantId: access.tenantId, clientId: access.userId }).map((item) => ({
    id: item.id,
    invoiceNumber: item.invoiceNumber || item.invoice_no || item.id,
    saleId: item.saleId || "",
    branchId: item.branchId || item.branch_id || "",
    status: item.status || item.payment_status || "unpaid",
    subtotalPaise: paiseFromRupees(item.subtotal),
    discountPaise: paiseFromRupees(item.discount),
    taxPaise: paiseFromRupees(item.gstAmount || item.taxAmount),
    totalPaise: paiseFromRupees(item.total || item.grand_total),
    paidPaise: paiseFromRupees(item.paid || item.paid_amount),
    balancePaise: paiseFromRupees(item.balance || item.due_amount),
    dueDate: item.dueDate || "",
    lineItems: json(item.lineItems, []),
    createdAt: item.createdAt || item.created_at || "",
    updatedAt: item.updatedAt || item.updated_at || ""
  }));
}

function payments(access) {
  client(access);
  return db.prepare(`
    SELECT p.*, i.invoiceNumber
    FROM payments p
    JOIN invoices i ON i.id = p.invoiceId
    WHERE i.clientId = @clientId
    ORDER BY datetime(p.createdAt) DESC
    LIMIT 100
  `).all({ clientId: access.userId }).map((item) => ({
    id: item.id,
    invoiceId: item.invoiceId,
    invoiceNumber: item.invoiceNumber || "",
    mode: item.mode || "",
    amountPaise: paiseFromRupees(item.amount),
    reference: item.reference || "",
    createdAt: item.createdAt || ""
  }));
}

function paymentLink(access, invoiceId, amountPaise = 0) {
  const invoice = invoices(access).find((item) => item.id === invoiceId);
  if (!invoice) throw notFound("Invoice not found");
  const amount = Number(amountPaise || invoice.balancePaise || invoice.totalPaise || 0);
  return {
    id: id("plink"),
    invoiceId,
    amountPaise: amount,
    amount,
    provider: "local",
    status: "pending_provider_configuration",
    url: "",
    shortUrl: "",
    expiresAt: new Date(Date.now() + 24 * 3600000).toISOString()
  };
}

function notifications(access) {
  client(access);
  return db.prepare(`SELECT * FROM notifications WHERE clientId = @clientId ORDER BY datetime(createdAt) DESC LIMIT 100`).all({ clientId: access.userId }).map((item) => ({
    id: item.id,
    type: item.type || "notification",
    channel: item.channel || "in_app",
    message: item.message || "",
    status: item.status || "queued",
    createdAt: item.createdAt || ""
  }));
}

function devices(access) {
  client(access);
  if (!tableExists("refresh_tokens")) return [];
  const columns = columnsFor("refresh_tokens");
  if (!columns.includes("deviceId")) return [];
  return db.prepare(`
    SELECT deviceId, MAX(createdAt) AS createdAt, MAX(expiresAt) AS lastSeenAt
    FROM refresh_tokens
    WHERE tenantId = @tenantId AND userId = @userId AND role = 'customer' AND COALESCE(revokedAt, '') = ''
    GROUP BY deviceId
    ORDER BY MAX(createdAt) DESC
  `).all({ tenantId: access.tenantId, userId: access.userId }).map((item) => ({
    id: item.deviceId || "browser",
    deviceId: item.deviceId || "browser",
    deviceName: item.deviceId ? "Customer browser" : "Browser session",
    platform: "web",
    userAgent: "",
    lastSeenAt: item.lastSeenAt || item.createdAt || "",
    createdAt: item.createdAt || "",
    current: item.deviceId === access.deviceId
  }));
}

function logoutDevice(access, sessionId) {
  client(access);
  if (!tableExists("refresh_tokens")) return;
  db.prepare(`UPDATE refresh_tokens SET revokedAt = @revokedAt WHERE tenantId = @tenantId AND userId = @userId AND role = 'customer' AND deviceId = @deviceId`).run({ revokedAt: now(), tenantId: access.tenantId, userId: access.userId, deviceId: sessionId });
}

function logoutAllDevices(access) {
  client(access);
  if (!tableExists("refresh_tokens")) return;
  db.prepare(`UPDATE refresh_tokens SET revokedAt = @revokedAt WHERE tenantId = @tenantId AND userId = @userId AND role = 'customer'`).run({ revokedAt: now(), tenantId: access.tenantId, userId: access.userId });
}

function deleteMe(access) {
  const row = client(access);
  const updates = { name: "Deleted customer", email: "", phone: "", notes: [row.notes, "Customer requested account deletion from app."].filter(Boolean).join("\n") };
  if (tableHasColumn("clients", "status")) updates.status = "deleted";
  updateRow("clients", row.id, updates, { tenantId: access.tenantId });
  logoutAllDevices(access);
  return { deleted: true, id: row.id };
}

export const customerAppService = {
  bookings,
  booking(access, idValue) { return mapBooking(bookingById(access, idValue)); },
  createBooking,
  cancelBooking,
  rescheduleBooking,
  waitlist,
  reviewBooking,
  listFavorites,
  addFavorite,
  removeFavorite,
  rewards,
  wallet,
  memberships,
  buyMembership,
  packages,
  giftCards,
  purchaseGiftCard,
  redeemGiftCard,
  invoices,
  payments,
  paymentLink,
  notifications,
  devices,
  logoutDevice,
  logoutAllDevices,
  deleteMe
};
