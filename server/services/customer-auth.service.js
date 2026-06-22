import { createHmac, createPublicKey, randomUUID, verify as verifySignature } from "node:crypto";
import { db, DEFAULT_TENANT_ID, tableHasColumn } from "../db.js";
import { env } from "../config/env.js";
import { badRequest, unauthorized } from "../utils/app-error.js";
import { authService } from "./auth.service.js";
import { tenantService } from "./tenant.service.js";
import { whatsappAutomationService } from "./whatsapp-automation.service.js";

const FIREBASE_CERTS_URL = "https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com";
const now = () => new Date().toISOString();
const makeId = (prefix) => `${prefix}_${randomUUID().slice(0, 10)}`;
let firebaseCertCache = { expiresAt: 0, certs: {} };

function hashToken(token) {
  return createHmac("sha256", env.jwtSecret).update(String(token || "")).digest("hex");
}

function base64UrlJson(value = "") {
  return JSON.parse(Buffer.from(String(value), "base64url").toString("utf8"));
}

function phoneDigits(value = "") {
  return String(value || "").replace(/\D/g, "");
}

function normalizePhone(value = "") {
  const digits = phoneDigits(value);
  if (!digits) return "";
  if (digits.length === 10) return `+91${digits}`;
  if (digits.length === 11 && digits.startsWith("0")) return `+91${digits.slice(1)}`;
  if (digits.length === 12 && digits.startsWith("91")) return `+${digits}`;
  return String(value || "").startsWith("+") ? `+${digits}` : `+${digits}`;
}

function cleanEmail(value = "") {
  return String(value || "").trim().toLowerCase();
}

function splitName(name = "") {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  return { firstName: parts[0] || "", lastName: parts.slice(1).join(" ") };
}

function rowToCustomer(row = {}) {
  const { firstName, lastName } = splitName(row.name || "");
  return {
    id: row.id,
    name: row.name || "",
    firstName,
    lastName,
    phone: row.phone || "",
    email: row.email || "",
    firebaseUid: row.firebaseUid || row.firebase_uid || "",
    authProvider: row.authProvider || row.auth_provider || "",
    isLoggedIn: true,
    bookingCount: Number(row.visitCount || 0),
    loyaltyPoints: Number(row.loyaltyPoints || 0),
    profileComplete: Boolean((row.name || "").trim() && ((row.phone || "").trim() || (row.email || "").trim())),
    createdAt: row.createdAt || "",
    phoneVerifiedAt: row.phone ? row.updatedAt || row.createdAt || "" : "",
    emailVerifiedAt: row.email ? row.updatedAt || row.createdAt || "" : ""
  };
}

function setColumn(target, column, value) {
  if (tableHasColumn("clients", column)) target[column] = value;
}

function clientWhereClause() {
  return tableHasColumn("clients", "tenantId") ? "tenantId = @tenantId AND " : "";
}

function clientById(tenantId, id) {
  return db.prepare(`SELECT * FROM clients WHERE ${clientWhereClause()}id = @id`).get({ tenantId, id });
}

function findClient({ tenantId, firebaseUid = "", email = "", phone = "" }) {
  const tenantClause = clientWhereClause();
  if (firebaseUid && tableHasColumn("clients", "firebaseUid")) {
    const row = db.prepare(`SELECT * FROM clients WHERE ${tenantClause}firebaseUid = @firebaseUid LIMIT 1`).get({ tenantId, firebaseUid });
    if (row) return row;
  }
  if (email) {
    const row = db.prepare(`SELECT * FROM clients WHERE ${tenantClause}LOWER(COALESCE(email, '')) = @email LIMIT 1`).get({ tenantId, email });
    if (row) return row;
  }
  if (phone) {
    const last10 = phoneDigits(phone).slice(-10);
    const rows = db.prepare(`SELECT * FROM clients WHERE ${tenantClause}COALESCE(phone, '') != ''`).all({ tenantId });
    const row = rows.find((item) => phoneDigits(item.phone).slice(-10) === last10);
    if (row) return row;
  }
  return null;
}

function insertClient({ tenantId, name, email, phone, firebaseUid, provider }) {
  const stamp = now();
  const row = {
    id: makeId("cust"),
    name: name || email || phone || "Customer",
    phone: phone || "",
    email: email || "",
    gender: "",
    birthday: "",
    anniversary: "",
    tags: JSON.stringify(["customer-app"]),
    notes: "Created from customer app login.",
    walletBalance: 0,
    loyaltyPoints: 0,
    membershipId: "",
    branchId: "",
    totalSpend: 0,
    visitCount: 0,
    lastVisitAt: "",
    visitHistory: JSON.stringify([]),
    purchaseHistory: JSON.stringify([]),
    whatsappHistory: JSON.stringify([]),
    consentForms: JSON.stringify([]),
    createdAt: stamp,
    updatedAt: stamp
  };
  setColumn(row, "tenantId", tenantId);
  setColumn(row, "firebaseUid", firebaseUid);
  setColumn(row, "authProvider", provider);
  setColumn(row, "preferences", JSON.stringify({ accountCreatedNotifiedAt: "" }));
  const columns = Object.keys(row).filter((column) => tableHasColumn("clients", column));
  db.prepare(`INSERT INTO clients (${columns.join(", ")}) VALUES (${columns.map((column) => `@${column}`).join(", ")})`).run(row);
  return clientById(tenantId, row.id);
}

function updateClient(existing, { name, email, phone, firebaseUid, provider }) {
  const updates = { updatedAt: now() };
  if (name && (!existing.name || existing.name === "Customer")) updates.name = name;
  if (email && !existing.email) updates.email = email;
  if (phone && !existing.phone) updates.phone = phone;
  setColumn(updates, "firebaseUid", firebaseUid || existing.firebaseUid || "");
  setColumn(updates, "authProvider", provider || existing.authProvider || "");
  const columns = Object.keys(updates).filter((column) => tableHasColumn("clients", column));
  if (columns.length) {
    db.prepare(`UPDATE clients SET ${columns.map((column) => `${column} = @${column}`).join(", ")} WHERE ${clientWhereClause()}id = @id`).run({
      ...updates,
      tenantId: existing.tenantId || DEFAULT_TENANT_ID,
      id: existing.id
    });
  }
  return clientById(existing.tenantId || DEFAULT_TENANT_ID, existing.id);
}

function notificationAlreadyQueued(clientId) {
  const existing = db.prepare(`
    SELECT id FROM notifications
    WHERE clientId = @clientId
      AND type = 'customer_account_created'
    LIMIT 1
  `).get({ clientId });
  return Boolean(existing);
}

function accountCreatedBody(customer, tenant) {
  const firstName = customer.firstName || customer.name || "there";
  return `Hi ${firstName}, your ${tenant.name || "Aura Salon"} customer account is created. You can now book appointments, view offers and manage your profile from the app.`;
}

function queueAccountCreatedNotifications(customer, tenant, access) {
  if (!customer?.id || notificationAlreadyQueued(customer.id)) return { queued: false, reason: "already_queued" };
  const body = accountCreatedBody(customer, tenant);
  const queued = [];
  if (customer.phone) {
    const thread = whatsappAutomationService.ensureThread({
      phone: customer.phone,
      displayName: customer.name || "Customer",
      client: { id: customer.id, name: customer.name },
      source: "customer-app-account"
    }, access);
    const message = whatsappAutomationService.createOutbound(thread, {
      body,
      eventType: "customer_account_created",
      templateKey: "customer_account_created",
      metadata: { customerId: customer.id, source: "customer-app-first-login" }
    }, access);
    queued.push({ channel: "whatsapp", id: message.id });
  }
  if (customer.email) {
    const id = makeId("note");
    db.prepare(`
      INSERT INTO notifications (id, clientId, type, channel, message, status, createdAt)
      VALUES (@id, @clientId, 'customer_account_created', 'email', @message, 'queued', CURRENT_TIMESTAMP)
    `).run({ id, clientId: customer.id, message: `To: ${customer.email}\nSubject: Your account is created\n\n${body}` });
    queued.push({ channel: "email", id });
  }
  return { queued: queued.length > 0, channels: queued };
}

async function firebaseCerts() {
  if (firebaseCertCache.expiresAt > Date.now()) return firebaseCertCache.certs;
  const response = await fetch(FIREBASE_CERTS_URL);
  if (!response.ok) throw unauthorized("Unable to verify Firebase token");
  const cacheControl = response.headers.get("cache-control") || "";
  const maxAge = Number(cacheControl.match(/max-age=(\d+)/)?.[1] || 3600);
  firebaseCertCache = { expiresAt: Date.now() + maxAge * 1000, certs: await response.json() };
  return firebaseCertCache.certs;
}

async function verifyFirebaseIdToken(idToken) {
  const parts = String(idToken || "").split(".");
  if (parts.length !== 3) throw unauthorized("Firebase token is malformed");
  const header = base64UrlJson(parts[0]);
  const payload = base64UrlJson(parts[1]);
  const projectId = process.env.CUSTOMER_FIREBASE_PROJECT_ID || process.env.FIREBASE_PROJECT_ID || "aurashineclient";
  if (payload.aud !== projectId || payload.iss !== `https://securetoken.google.com/${projectId}`) throw unauthorized("Firebase token audience is invalid");
  if (!payload.sub || Number(payload.exp || 0) <= Math.floor(Date.now() / 1000)) throw unauthorized("Firebase token is expired");
  const cert = (await firebaseCerts())[header.kid];
  if (!cert) throw unauthorized("Firebase token key is unknown");
  const verified = verifySignature("RSA-SHA256", Buffer.from(`${parts[0]}.${parts[1]}`), createPublicKey(cert), Buffer.from(parts[2], "base64url"));
  if (!verified) throw unauthorized("Firebase token signature is invalid");
  return payload;
}

function issueCustomerSession({ tenant, customer, provider, device = {} }) {
  const tokenUser = {
    id: customer.id,
    name: customer.name,
    email: customer.email,
    loginId: customer.email || customer.phone || customer.id,
    role: "customer",
    staffId: "",
    branchIds: []
  };
  const pair = authService.issueTokenPair({ tenant, user: tokenUser, branchId: "", deviceId: device.deviceId || "" });
  return {
    accessToken: pair.accessToken,
    refreshToken: pair.refreshToken,
    refreshExpiresAt: pair.refreshExpiresAt,
    isNewCustomer: customer.isNewCustomer,
    authProvider: provider,
    customer: rowToCustomer(customer)
  };
}

export const customerAuthService = {
  async exchangeFirebaseToken(payload = {}, request = {}) {
    const tenant = tenantService.resolveTenant({ tenantId: request.tenantId || payload.tenantId || DEFAULT_TENANT_ID, host: request.host || "" });
    if (!tenant) throw badRequest("Tenant not found");
    const decoded = await verifyFirebaseIdToken(payload.idToken);
    const provider = payload.provider || decoded.firebase?.sign_in_provider || "firebase";
    const email = cleanEmail(decoded.email || "");
    const phone = normalizePhone(decoded.phone_number || payload.phone || "");
    const name = decoded.name || payload.name || email || phone || "Customer";
    const existing = findClient({ tenantId: tenant.id, firebaseUid: decoded.sub, email, phone });
    const customer = existing
      ? updateClient(existing, { name, email, phone, firebaseUid: decoded.sub, provider })
      : insertClient({ tenantId: tenant.id, name, email, phone, firebaseUid: decoded.sub, provider });
    customer.isNewCustomer = !existing;
    if (customer.isNewCustomer) {
      queueAccountCreatedNotifications(rowToCustomer(customer), tenant, { tenantId: tenant.id, role: "owner", userId: "customer-auth", branchId: "", branchIds: [] });
    }
    return issueCustomerSession({ tenant, customer, provider, device: payload.device || {} });
  },

  me(access = {}) {
    const row = clientById(access.tenantId || DEFAULT_TENANT_ID, access.userId);
    if (!row) throw unauthorized("Customer session is invalid");
    return rowToCustomer(row);
  },

  refresh(refreshToken = "", device = {}) {
    if (!refreshToken) throw unauthorized("Refresh token is required");
    const record = db.prepare(`
      SELECT * FROM auth_refresh_tokens
      WHERE tokenHash = @tokenHash
        AND role = 'customer'
        AND COALESCE(revokedAt, '') = ''
      LIMIT 1
    `).get({ tokenHash: hashToken(refreshToken) });
    if (!record || record.expiresAt <= now()) throw unauthorized("Refresh token is invalid or expired");
    const tenant = db.prepare("SELECT * FROM tenants WHERE id = @id").get({ id: record.tenantId });
    const customer = clientById(record.tenantId, record.userId);
    if (!tenant || !customer) throw unauthorized("Customer session is invalid");
    db.prepare("UPDATE auth_refresh_tokens SET revokedAt = @revokedAt, updatedAt = @updatedAt WHERE id = @id").run({ id: record.id, revokedAt: now(), updatedAt: now() });
    return issueCustomerSession({ tenant, customer: { ...customer, isNewCustomer: false }, provider: customer.authProvider || "customer", device });
  },

  logout(refreshToken = "") {
    if (!refreshToken) return { revoked: false };
    const result = db.prepare(`
      UPDATE auth_refresh_tokens
         SET revokedAt = @revokedAt,
             updatedAt = @updatedAt
       WHERE tokenHash = @tokenHash
         AND role = 'customer'
         AND COALESCE(revokedAt, '') = ''
    `).run({ tokenHash: hashToken(refreshToken), revokedAt: now(), updatedAt: now() });
    return { revoked: result.changes > 0 };
  }
};
