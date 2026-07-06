import { createHmac, randomInt, randomUUID } from "node:crypto";
import { db, DEFAULT_TENANT_ID, tableHasColumn } from "../db.js";
import { env } from "../config/env.js";
import { badRequest, conflict, unauthorized } from "../utils/app-error.js";
import { authService } from "./auth.service.js";
import { verifyCustomerFirebaseIdToken } from "./firebase-admin.service.js";
import { ensureCustomerAuthSchema } from "./customer-auth-schema.service.js";
import { jobQueueService } from "./job-queue.service.js";
import { tenantService } from "./tenant.service.js";
import { whatsappAutomationService } from "./whatsapp-automation.service.js";

const now = () => new Date().toISOString();
const makeId = (prefix) => `${prefix}_${randomUUID().slice(0, 10)}`;
const CODE_TTL_MINUTES = 10;
const CODE_RESEND_SECONDS = 30;
const MAX_CODE_ATTEMPTS = 5;
ensureCustomerAuthSchema();

function hashToken(token) {
  return createHmac("sha256", env.jwtSecret).update(String(token || "")).digest("hex");
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
  const firebaseUid = row.firebaseUid || row.firebase_uid || "";
  const hasCompleteProfile = Boolean(firstName && lastName && row.email && row.phone);
  return {
    id: row.id,
    uid: firebaseUid,
    name: row.name || "",
    displayName: row.name || "",
    firstName,
    lastName,
    phone: row.phone || "",
    phoneNumber: row.phone || "",
    email: row.email || "",
    firebaseUid,
    authProvider: row.authProvider || row.auth_provider || "",
    isLoggedIn: true,
    bookingCount: Number(row.visitCount || 0),
    loyaltyPoints: Number(row.loyaltyPoints || 0),
    profileComplete: hasCompleteProfile,
    createdAt: row.createdAt || "",
    lastLoginAt: row.lastLoginAt || row.last_login_at || "",
    phoneVerifiedAt: row.phoneVerifiedAt || (row.phone ? row.updatedAt || row.createdAt || "" : ""),
    emailVerifiedAt: row.emailVerifiedAt || (row.email ? row.updatedAt || row.createdAt || "" : "")
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

function branchWhereClause() {
  return tableHasColumn("branches", "tenantId") ? "tenantId = @tenantId AND " : "";
}

function defaultBranchId(tenantId, preferredBranchId = "") {
  if (preferredBranchId) {
    const existing = db.prepare(`SELECT id FROM branches WHERE ${branchWhereClause()}id = @branchId LIMIT 1`).get({ tenantId, branchId: preferredBranchId });
    if (existing) return existing.id;
  }
  const active = db.prepare(`SELECT id FROM branches WHERE ${branchWhereClause()}COALESCE(status, 'active') = 'active' ORDER BY createdAt ASC, id ASC LIMIT 1`).get({ tenantId });
  if (active) return active.id;
  const fallback = db.prepare(`SELECT id FROM branches WHERE ${branchWhereClause()}1 = 1 ORDER BY createdAt ASC, id ASC LIMIT 1`).get({ tenantId });
  if (fallback) return fallback.id;
  throw badRequest("Tenant branch is required before customer login can create a profile");
}

function findClient({ tenantId, firebaseUid = "", email = "", phone = "" }) {
  return findClientByFirebaseUid(tenantId, firebaseUid)
    || findClientByEmail(tenantId, email)
    || findClientByPhone(tenantId, phone);
}

function findClientByFirebaseUid(tenantId, firebaseUid = "") {
  if (!firebaseUid || !tableHasColumn("clients", "firebaseUid")) return null;
  return db.prepare("SELECT * FROM clients WHERE " + clientWhereClause() + "firebaseUid = @firebaseUid LIMIT 1").get({ tenantId, firebaseUid }) || null;
}

function findClientByEmail(tenantId, email = "") {
  if (!email) return null;
  return db.prepare("SELECT * FROM clients WHERE " + clientWhereClause() + "LOWER(COALESCE(email, '')) = @email LIMIT 1").get({ tenantId, email }) || null;
}

function findClientByPhone(tenantId, phone = "") {
  const last10 = phoneDigits(phone).slice(-10);
  if (!last10) return null;
  const rows = db.prepare("SELECT * FROM clients WHERE " + clientWhereClause() + "COALESCE(phone, '') != ''").all({ tenantId });
  return rows.find((item) => phoneDigits(item.phone).slice(-10) === last10) || null;
}

function resolveFirebaseClient({ tenantId, firebaseUid = "", email = "", phone = "" }) {
  const byUid = findClientByFirebaseUid(tenantId, firebaseUid);
  const byEmail = findClientByEmail(tenantId, email);
  const byPhone = findClientByPhone(tenantId, phone);
  const primary = byUid || byPhone || byEmail || null;
  if (byUid && byEmail && byUid.id !== byEmail.id) throw conflict("This email is already linked to another customer account.");
  if (byUid && byPhone && byUid.id !== byPhone.id) throw conflict("This mobile number is already linked to another customer account.");
  if (byEmail && byPhone && byEmail.id !== byPhone.id) throw conflict("This mobile number is already linked to another customer account.");
  return primary;
}

function insertClient({ tenantId, branchId, name, email, phone, firebaseUid, provider }) {
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
    branchId: defaultBranchId(tenantId, branchId),
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
  setColumn(row, "lastLoginAt", stamp);
  setColumn(row, "phoneVerifiedAt", phone ? stamp : "");
  setColumn(row, "emailVerifiedAt", email ? stamp : "");
  setColumn(row, "preferences", JSON.stringify({ accountCreatedNotifiedAt: "" }));
  const columns = Object.keys(row).filter((column) => tableHasColumn("clients", column));
  db.prepare(`INSERT INTO clients (${columns.join(", ")}) VALUES (${columns.map((column) => `@${column}`).join(", ")})`).run(row);
  return clientById(tenantId, row.id);
}

function updateClient(existing, { name, email, phone, firebaseUid, provider, forceName = false, forcePhone = false }) {
  const stamp = now();
  const updates = { updatedAt: stamp };
  if (name && (forceName || !existing.name || existing.name === "Customer")) updates.name = name;
  if (email && !existing.email) {
    updates.email = email;
    setColumn(updates, "emailVerifiedAt", stamp);
  }
  if (phone && (forcePhone || !existing.phone)) {
    updates.phone = phone;
    setColumn(updates, "phoneVerifiedAt", stamp);
  }
  if (email && existing.email && cleanEmail(existing.email) === email) setColumn(updates, "emailVerifiedAt", existing.emailVerifiedAt || stamp);
  if (phone && existing.phone && phoneDigits(existing.phone).slice(-10) === phoneDigits(phone).slice(-10)) setColumn(updates, "phoneVerifiedAt", existing.phoneVerifiedAt || stamp);
  setColumn(updates, "firebaseUid", firebaseUid || existing.firebaseUid || "");
  setColumn(updates, "authProvider", provider || existing.authProvider || "");
  setColumn(updates, "lastLoginAt", stamp);
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

function codeHash({ tenantId, targetType, target, purpose, code }) {
  return createHmac("sha256", env.jwtSecret)
    .update(`${tenantId}:${targetType}:${target}:${purpose}:${code}`)
    .digest("hex");
}

function generateCode() {
  return String(randomInt(100000, 1000000));
}

function expiresAt(minutes = CODE_TTL_MINUTES) {
  return new Date(Date.now() + minutes * 60000).toISOString();
}

function resolveCustomerTenant(payload = {}, request = {}) {
  const tenant = tenantService.resolveTenant({ tenantId: request.tenantId || payload.tenantId || DEFAULT_TENANT_ID, host: request.host || "" });
  if (!tenant) throw badRequest("Tenant not found");
  return tenant;
}

function assertCustomer(access = {}) {
  if (access.role !== "customer" || !access.userId) throw unauthorized("Customer session is required");
}

function recentCodeRequestCount({ tenantId, targetType, target, purpose }) {
  const since = new Date(Date.now() - 15 * 60000).toISOString();
  const row = db.prepare(`
    SELECT COUNT(*) AS count
      FROM customer_auth_codes
     WHERE tenantId = @tenantId
       AND targetType = @targetType
       AND target = @target
       AND purpose = @purpose
       AND createdAt >= @since
  `).get({ tenantId, targetType, target, purpose, since });
  return Number(row?.count || 0);
}

function createAuthCode({ tenantId, branchId, targetType, target, purpose, requestedChannel, deliveryChannel }) {
  if (recentCodeRequestCount({ tenantId, targetType, target, purpose }) >= MAX_CODE_ATTEMPTS) {
    throw conflict("OTP temporarily locked. Try again after 15 minutes.");
  }
  const code = generateCode();
  const stamp = now();
  const row = {
    id: makeId("code"),
    tenantId,
    branchId: defaultBranchId(tenantId, branchId),
    targetType,
    target,
    purpose,
    codeHash: codeHash({ tenantId, targetType, target, purpose, code }),
    requestedChannel,
    deliveryChannel,
    attemptCount: 0,
    maxAttempts: MAX_CODE_ATTEMPTS,
    expiresAt: expiresAt(),
    consumedAt: "",
    createdAt: stamp,
    updatedAt: stamp
  };
  db.prepare(`
    INSERT INTO customer_auth_codes
      (id, tenantId, branchId, targetType, target, purpose, codeHash, requestedChannel, deliveryChannel, attemptCount, maxAttempts, expiresAt, consumedAt, createdAt, updatedAt)
    VALUES
      (@id, @tenantId, @branchId, @targetType, @target, @purpose, @codeHash, @requestedChannel, @deliveryChannel, @attemptCount, @maxAttempts, @expiresAt, @consumedAt, @createdAt, @updatedAt)
  `).run(row);
  return { ...row, code };
}

function verifyAuthCode({ tenantId, targetType, target, purpose, code }) {
  const row = db.prepare(`
    SELECT *
      FROM customer_auth_codes
     WHERE tenantId = @tenantId
       AND targetType = @targetType
       AND target = @target
       AND purpose = @purpose
       AND COALESCE(consumedAt, '') = ''
     ORDER BY createdAt DESC
     LIMIT 1
  `).get({ tenantId, targetType, target, purpose });
  if (!row || row.expiresAt < now()) throw conflict("OTP expired");
  if (Number(row.attemptCount || 0) >= Number(row.maxAttempts || MAX_CODE_ATTEMPTS)) throw conflict("OTP attempts exceeded");
  const ok = row.codeHash === codeHash({ tenantId, targetType, target, purpose, code });
  if (!ok) {
    db.prepare(`
      UPDATE customer_auth_codes
         SET attemptCount = attemptCount + 1,
             updatedAt = @updatedAt
       WHERE id = @id
    `).run({ id: row.id, updatedAt: now() });
    throw conflict("Invalid OTP");
  }
  db.prepare(`
    UPDATE customer_auth_codes
       SET consumedAt = @consumedAt,
           updatedAt = @updatedAt
     WHERE id = @id
  `).run({ id: row.id, consumedAt: now(), updatedAt: now() });
  return row;
}

function devOtp(code) {
  return process.env.NODE_ENV === "production" ? undefined : code;
}

function queueEmailCode({ tenantId, branchId, email, code }) {
  jobQueueService.enqueue({
    tenantId,
    jobType: "email_send",
    priority: 2,
    payload: {
      to: email,
      branchId,
      type: "customer_login_verification",
      subject: "Your AuraSalon verification code",
      message: `Your AuraSalon verification code is ${code}. It expires in ${CODE_TTL_MINUTES} minutes.`
    }
  });
}

function phoneDeliveryForChannel(channel) {
  if (channel !== "whatsapp") return { deliveryChannel: "local", deliveryWarning: "SMS delivery is not configured for this environment." };
  return { deliveryChannel: "whatsapp", deliveryWarning: "" };
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

function canonicalFirebaseProvider(value = "") {
  const provider = String(value || "").toLowerCase();
  if (provider === "google.com" || provider === "google") return "google";
  if (provider === "facebook.com" || provider === "facebook") return "facebook";
  if (provider === "phone") return "phone";
  if (provider === "password") return "password";
  if (provider === "apple.com" || provider === "apple") return "apple";
  return provider || "firebase";
}

function assertFirebaseIdentity(decoded = {}, provider = "") {
  if (!(decoded.uid || decoded.sub)) throw unauthorized("Firebase token is missing a user id");
  if (provider === "phone" && !decoded.phone_number) throw unauthorized("Firebase phone number is required");
  if ((provider === "google" || provider === "facebook" || provider === "password") && !decoded.email && !decoded.phone_number) {
    throw unauthorized("Firebase token is missing customer identity details");
  }
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
  requestEmailCode(payload = {}, request = {}) {
    const tenant = resolveCustomerTenant(payload, request);
    const email = cleanEmail(payload.email || "");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw badRequest("Valid email is required");
    const branchId = defaultBranchId(tenant.id, payload.branchId || request.branchId || "");
    const record = createAuthCode({
      tenantId: tenant.id,
      branchId,
      targetType: "email",
      target: email,
      purpose: "customer_login",
      requestedChannel: "email",
      deliveryChannel: "email"
    });
    queueEmailCode({ tenantId: tenant.id, branchId, email, code: record.code });
    return {
      requestId: record.id,
      expiresAt: record.expiresAt,
      resendAfterSeconds: CODE_RESEND_SECONDS,
      requestedChannel: "email",
      deliveryChannel: "email",
      devOtp: devOtp(record.code)
    };
  },

  verifyEmailCode(payload = {}, request = {}) {
    const tenant = resolveCustomerTenant(payload, request);
    const email = cleanEmail(payload.email || "");
    const code = String(payload.code || payload.otp || "").trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw badRequest("Valid email is required");
    if (!/^\d{6}$/.test(code)) throw badRequest("Valid verification code is required");
    const verified = verifyAuthCode({ tenantId: tenant.id, targetType: "email", target: email, purpose: "customer_login", code });
    const name = String(payload.name || "").trim() || email;
    const existing = findClient({ tenantId: tenant.id, email });
    const customer = existing
      ? updateClient(existing, { name, email, phone: "", firebaseUid: "", provider: "email_otp" })
      : insertClient({ tenantId: tenant.id, branchId: verified.branchId, name, email, phone: "", firebaseUid: "", provider: "email_otp" });
    customer.isNewCustomer = !existing;
    if (customer.isNewCustomer) {
      queueAccountCreatedNotifications(rowToCustomer(customer), tenant, { tenantId: tenant.id, role: "owner", userId: "customer-auth", branchId: customer.branchId || verified.branchId, branchIds: [customer.branchId || verified.branchId] });
    }
    return issueCustomerSession({ tenant, customer, provider: "email_otp", device: payload.device || {} });
  },

  requestOtp(payload = {}, request = {}) {
    const tenant = resolveCustomerTenant(payload, request);
    const phone = normalizePhone(payload.phone || "");
    const channel = payload.channel === "whatsapp" ? "whatsapp" : "sms";
    if (phoneDigits(phone).length < 8) throw badRequest("Valid phone is required");
    const branchId = defaultBranchId(tenant.id, payload.branchId || request.branchId || "");
    const delivery = phoneDeliveryForChannel(channel);
    const record = createAuthCode({
      tenantId: tenant.id,
      branchId,
      targetType: "phone",
      target: phone,
      purpose: "customer_login",
      requestedChannel: channel,
      deliveryChannel: delivery.deliveryChannel
    });
    if (channel === "whatsapp") {
      jobQueueService.enqueue({
        tenantId: tenant.id,
        jobType: "whatsapp_send",
        priority: 2,
        payload: {
          template: "otp_send",
          phone,
          language: "en",
          variables: { otp: record.code, client_name: "Guest", salon_name: "Aura Salon" }
        }
      });
    }
    return {
      requestId: record.id,
      expiresAt: record.expiresAt,
      resendAfterSeconds: CODE_RESEND_SECONDS,
      requestedChannel: channel,
      deliveryChannel: delivery.deliveryChannel,
      fallbackChannels: channel === "whatsapp" ? ["sms"] : ["whatsapp"],
      deliveryWarning: delivery.deliveryWarning,
      devOtp: devOtp(record.code)
    };
  },

  verifyOtp(payload = {}, request = {}) {
    const tenant = resolveCustomerTenant(payload, request);
    const phone = normalizePhone(payload.phone || "");
    const otp = String(payload.otp || payload.code || "").trim();
    if (phoneDigits(phone).length < 8) throw badRequest("Valid phone is required");
    if (!/^\d{6}$/.test(otp)) throw badRequest("Valid OTP is required");
    const verified = verifyAuthCode({ tenantId: tenant.id, targetType: "phone", target: phone, purpose: "customer_login", code: otp });
    const existing = findClient({ tenantId: tenant.id, phone });
    const customer = existing
      ? updateClient(existing, { name: "", email: "", phone, firebaseUid: "", provider: "phone_otp" })
      : insertClient({ tenantId: tenant.id, branchId: verified.branchId, name: phone, email: "", phone, firebaseUid: "", provider: "phone_otp" });
    customer.isNewCustomer = !existing;
    if (customer.isNewCustomer) {
      queueAccountCreatedNotifications(rowToCustomer(customer), tenant, { tenantId: tenant.id, role: "owner", userId: "customer-auth", branchId: customer.branchId || verified.branchId, branchIds: [customer.branchId || verified.branchId] });
    }
    return issueCustomerSession({ tenant, customer, provider: "phone_otp", device: payload.device || {} });
  },

  async exchangeFirebaseToken(payload = {}, request = {}) {
    const tenant = resolveCustomerTenant(payload, request);
    const decoded = await verifyCustomerFirebaseIdToken(payload.idToken);
    const firebaseUid = String(decoded.uid || decoded.sub || "");
    const provider = canonicalFirebaseProvider(decoded.firebase?.sign_in_provider || payload.provider || "firebase");
    assertFirebaseIdentity(decoded, provider);
    const email = cleanEmail(decoded.email || "");
    const phone = normalizePhone(decoded.phone_number || "");
    const name = decoded.name || payload.name || email || phone || "Customer";
    const existing = resolveFirebaseClient({ tenantId: tenant.id, firebaseUid, email, phone });
    const customer = existing
      ? updateClient(existing, { name, email, phone, firebaseUid, provider })
      : insertClient({ tenantId: tenant.id, branchId: payload.branchId || request.branchId || "", name, email, phone, firebaseUid, provider });
    customer.isNewCustomer = !existing;
    if (customer.isNewCustomer) {
      queueAccountCreatedNotifications(rowToCustomer(customer), tenant, { tenantId: tenant.id, role: "owner", userId: "customer-auth", branchId: customer.branchId || "", branchIds: customer.branchId ? [customer.branchId] : [] });
    }
    return issueCustomerSession({ tenant, customer, provider, device: payload.device || {} });
  },

  me(access = {}) {
    assertCustomer(access);
    const row = clientById(access.tenantId || DEFAULT_TENANT_ID, access.userId);
    if (!row) throw unauthorized("Customer session is invalid");
    return rowToCustomer(row);
  },

  updateMe(payload = {}, access = {}) {
    assertCustomer(access);
    const existing = clientById(access.tenantId || DEFAULT_TENANT_ID, access.userId);
    if (!existing) throw unauthorized("Customer session is invalid");
    const firstName = String(payload.firstName || "").trim();
    const lastName = String(payload.lastName || "").trim();
    const name = String(payload.name || `${firstName} ${lastName}`.trim() || existing.name || "").trim();
    const email = cleanEmail(payload.email || existing.email || "");
    const phone = normalizePhone(payload.phone || existing.phone || "");
    const updated = updateClient(existing, {
      name,
      email,
      phone,
      firebaseUid: existing.firebaseUid || existing.firebase_uid || "",
      provider: existing.authProvider || existing.auth_provider || "customer",
      forceName: true,
      forcePhone: true
    });
    return rowToCustomer(updated);
  },

  requestProfilePhoneOtp(payload = {}, access = {}) {
    assertCustomer(access);
    const phone = normalizePhone(payload.phone || "");
    const channel = payload.channel === "whatsapp" ? "whatsapp" : "sms";
    if (phoneDigits(phone).length < 8) throw badRequest("Valid phone is required");
    const branchId = defaultBranchId(access.tenantId || DEFAULT_TENANT_ID, access.branchId || "");
    const delivery = phoneDeliveryForChannel(channel);
    const record = createAuthCode({
      tenantId: access.tenantId,
      branchId,
      targetType: "phone",
      target: phone,
      purpose: `profile_phone:${access.userId}`,
      requestedChannel: channel,
      deliveryChannel: delivery.deliveryChannel
    });
    if (channel === "whatsapp") {
      jobQueueService.enqueue({
        tenantId: access.tenantId,
        jobType: "whatsapp_send",
        priority: 2,
        payload: {
          template: "otp_send",
          phone,
          language: "en",
          variables: { otp: record.code, client_name: "Guest", salon_name: "Aura Salon" }
        }
      });
    }
    return {
      requestId: record.id,
      expiresAt: record.expiresAt,
      resendAfterSeconds: CODE_RESEND_SECONDS,
      requestedChannel: channel,
      deliveryChannel: delivery.deliveryChannel,
      deliveryWarning: delivery.deliveryWarning,
      devOtp: devOtp(record.code)
    };
  },

  verifyProfilePhoneOtp(payload = {}, access = {}) {
    assertCustomer(access);
    const phone = normalizePhone(payload.phone || "");
    const otp = String(payload.otp || payload.code || "").trim();
    if (phoneDigits(phone).length < 8) throw badRequest("Valid phone is required");
    if (!/^\d{6}$/.test(otp)) throw badRequest("Valid OTP is required");
    verifyAuthCode({ tenantId: access.tenantId, targetType: "phone", target: phone, purpose: `profile_phone:${access.userId}`, code: otp });
    return this.updateMe({ phone }, access);
  },

  requestProfileEmailCode(payload = {}, access = {}) {
    assertCustomer(access);
    const email = cleanEmail(payload.email || "");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw badRequest("Valid email is required");
    const branchId = defaultBranchId(access.tenantId || DEFAULT_TENANT_ID, access.branchId || "");
    const record = createAuthCode({
      tenantId: access.tenantId,
      branchId,
      targetType: "email",
      target: email,
      purpose: `profile_email:${access.userId}`,
      requestedChannel: "email",
      deliveryChannel: "email"
    });
    queueEmailCode({ tenantId: access.tenantId, branchId, email, code: record.code });
    return {
      requestId: record.id,
      expiresAt: record.expiresAt,
      resendAfterSeconds: CODE_RESEND_SECONDS,
      requestedChannel: "email",
      deliveryChannel: "email",
      devOtp: devOtp(record.code)
    };
  },

  verifyProfileEmailCode(payload = {}, access = {}) {
    assertCustomer(access);
    const email = cleanEmail(payload.email || "");
    const code = String(payload.code || payload.otp || "").trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw badRequest("Valid email is required");
    if (!/^\d{6}$/.test(code)) throw badRequest("Valid verification code is required");
    verifyAuthCode({ tenantId: access.tenantId, targetType: "email", target: email, purpose: `profile_email:${access.userId}`, code });
    return this.updateMe({ email }, access);
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
