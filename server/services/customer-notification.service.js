import { createHash, randomUUID } from "node:crypto";
import { db } from "../db.js";
import { badRequest, notFound, unauthorized } from "../utils/app-error.js";
import { firebaseMessagingService } from "./firebase-messaging.service.js";
import { jobQueueService } from "./job-queue.service.js";
import { pushNotificationService } from "./push-notification.service.js";

const now = () => new Date().toISOString();
const makeId = (prefix) => `${prefix}_${randomUUID().slice(0, 10)}`;
const DEFAULT_PREFERENCES = Object.freeze({ bookingReminders: true, promotions: true, loyalty: true, membership: true });

function assertCustomer(access = {}) {
  if (access.role !== "customer" || !access.tenantId || !access.userId) throw unauthorized("Customer session is required");
}

function parseJson(value, fallback = {}) {
  if (value && typeof value === "object") return value;
  try { return JSON.parse(value || "{}"); } catch { return fallback; }
}

function bool(value, fallback = true, field = "preference") {
  if (value === undefined) return fallback;
  if (typeof value !== "boolean") throw badRequest(`${field} must be a boolean`);
  return value;
}

function preferenceRecord(row = {}) {
  return {
    bookingReminders: row.bookingReminders === undefined ? true : Boolean(row.bookingReminders),
    promotions: row.promotions === undefined ? true : Boolean(row.promotions),
    loyalty: row.loyalty === undefined ? true : Boolean(row.loyalty),
    membership: row.membership === undefined ? true : Boolean(row.membership)
  };
}

function branchForCustomer(tenantId, customerId, fallback = "") {
  if (fallback) return fallback;
  return db.prepare("SELECT COALESCE(branchId, '') AS branchId FROM clients WHERE tenantId = @tenantId AND id = @customerId LIMIT 1")
    .get({ tenantId, customerId })?.branchId || "";
}

function customerDeviceId(access, deviceId) {
  const value = `${access.tenantId}:${access.userId}:${String(deviceId || "").trim()}`;
  return `cdev_${createHash("sha256").update(value).digest("hex").slice(0, 24)}`;
}

function formatAppointmentTime(value) {
  const date = new Date(value || "");
  if (Number.isNaN(date.getTime())) return "your selected time";
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "numeric", minute: "2-digit", hour12: true
  }).format(date);
}

function notificationRow(row) {
  return {
    id: row.id,
    type: row.type,
    category: row.category,
    channel: "in_app",
    title: row.title,
    message: row.body,
    status: row.readAt ? "read" : "unread",
    readAt: row.readAt || null,
    deepLink: row.deepLink || "",
    data: parseJson(row.data),
    scheduledAt: row.scheduledAt,
    createdAt: row.createdAt
  };
}

function findByEventKey(tenantId, customerId, eventKey) {
  return db.prepare(`SELECT * FROM customerInboxNotifications
    WHERE tenantId = @tenantId AND customerId = @customerId AND eventKey = @eventKey LIMIT 1`)
    .get({ tenantId, customerId, eventKey });
}

function queuePush(row) {
  if (!firebaseMessagingService.configured()) return "";
  const stamp = now();
  const push = {
    id: makeId("push"), tenantId: row.tenantId, userId: row.customerId, branchId: row.branchId || "", deviceId: "",
    title: row.title, message: row.body,
    payload: JSON.stringify({ ...parseJson(row.data), notificationId: row.id, type: row.type, deepLink: row.deepLink, androidChannelId: "customer_notifications" }),
    status: "queued", providerMessageId: "", sentAt: "", createdAt: stamp, updatedAt: stamp
  };
  db.prepare(`INSERT INTO push_notifications
    (id, tenantId, userId, branchId, deviceId, title, message, payload, status, providerMessageId, sentAt, createdAt, updatedAt)
    VALUES (@id, @tenantId, @userId, @branchId, @deviceId, @title, @message, @payload, @status, @providerMessageId, @sentAt, @createdAt, @updatedAt)`)
    .run(push);
  jobQueueService.enqueue({ tenantId: row.tenantId, jobType: "staff_web_push_send", priority: 2, scheduledAt: row.scheduledAt, payload: { pushNotificationId: push.id } });
  db.prepare(`UPDATE customerInboxNotifications SET pushNotificationId = @pushNotificationId, updatedAt = @updatedAt
    WHERE id = @id AND tenantId = @tenantId`).run({ pushNotificationId: push.id, updatedAt: stamp, id: row.id, tenantId: row.tenantId });
  return push.id;
}

function shouldSend(input) {
  if (!input.preference) return true;
  const row = db.prepare(`SELECT * FROM customerNotificationPreferences
    WHERE tenantId = @tenantId AND customerId = @customerId LIMIT 1`)
    .get({ tenantId: input.tenantId, customerId: input.customerId });
  return preferenceRecord(row)[input.preference] !== false;
}

function create(input = {}) {
  const tenantId = String(input.tenantId || "").trim();
  const customerId = String(input.customerId || "").trim();
  const eventKey = String(input.eventKey || "").trim();
  if (!tenantId || !customerId || !eventKey || !input.title || !input.body) throw badRequest("Customer notification identity, eventKey, title and body are required");
  const customer = db.prepare("SELECT id FROM clients WHERE tenantId = @tenantId AND id = @customerId LIMIT 1").get({ tenantId, customerId });
  if (!customer) throw notFound("Customer not found");
  if (input.branchId) {
    const branch = db.prepare("SELECT id FROM branches WHERE tenantId = @tenantId AND id = @branchId LIMIT 1").get({ tenantId, branchId: input.branchId });
    if (!branch) throw notFound("Branch not found");
  }
  if (!shouldSend({ ...input, tenantId, customerId })) return null;
  const existing = findByEventKey(tenantId, customerId, eventKey);
  if (existing) return notificationRow(existing);
  const stamp = now();
  const scheduledAt = input.scheduledAt && new Date(input.scheduledAt).getTime() > 0 ? new Date(input.scheduledAt).toISOString() : stamp;
  const row = {
    id: makeId("cin"), tenantId, branchId: input.branchId || "", customerId,
    type: input.type || "notification", category: input.category || "transactional", title: input.title, body: input.body,
    data: JSON.stringify(input.data || {}), deepLink: input.deepLink || "", sourceType: input.sourceType || "", sourceId: input.sourceId || "",
    eventKey, pushNotificationId: "", scheduledAt, readAt: "", archivedAt: "", createdAt: stamp, updatedAt: stamp
  };
  db.prepare(`INSERT OR IGNORE INTO customerInboxNotifications
    (id, tenantId, branchId, customerId, type, category, title, body, data, deepLink, sourceType, sourceId,
     eventKey, pushNotificationId, scheduledAt, readAt, archivedAt, createdAt, updatedAt)
    VALUES (@id, @tenantId, @branchId, @customerId, @type, @category, @title, @body, @data, @deepLink, @sourceType, @sourceId,
     @eventKey, @pushNotificationId, @scheduledAt, @readAt, @archivedAt, @createdAt, @updatedAt)`).run(row);
  const saved = findByEventKey(tenantId, customerId, eventKey);
  if (saved?.id === row.id) {
    try { queuePush(saved); } catch {
      // Inbox persistence remains authoritative when provider/queue delivery is unavailable.
    }
  }
  return saved ? notificationRow(saved) : null;
}

function cancelAppointmentReminders(appointment = {}) {
  if (!appointment.tenantId || !appointment.id) return;
  const rows = db.prepare(`SELECT id, pushNotificationId FROM customerInboxNotifications
    WHERE tenantId = @tenantId AND sourceType = 'appointment_reminder' AND sourceId = @sourceId
      AND archivedAt = '' AND datetime(scheduledAt) > datetime('now')`)
    .all({ tenantId: appointment.tenantId, sourceId: appointment.id });
  if (!rows.length) return;
  const stamp = now();
  const updateInbox = db.prepare(`UPDATE customerInboxNotifications SET archivedAt = @stamp, updatedAt = @stamp
    WHERE id = @id AND tenantId = @tenantId`);
  const cancelPush = db.prepare(`UPDATE push_notifications SET status = 'cancelled', updatedAt = @stamp
    WHERE id = @id AND tenantId = @tenantId AND status = 'queued'`);
  const txn = db.transaction(() => rows.forEach((row) => {
    updateInbox.run({ id: row.id, tenantId: appointment.tenantId, stamp });
    if (row.pushNotificationId) cancelPush.run({ id: row.pushNotificationId, tenantId: appointment.tenantId, stamp });
  }));
  txn();
}

function scheduleAppointmentReminders(appointment = {}) {
  if (!appointment.tenantId || !appointment.clientId || !appointment.id || !appointment.startAt) return;
  cancelAppointmentReminders(appointment);
  const startTime = new Date(appointment.startAt).getTime();
  if (!Number.isFinite(startTime)) return;
  for (const reminder of [{ hours: 24, label: "tomorrow" }, { hours: 2, label: "in 2 hours" }]) {
    const scheduledAt = new Date(startTime - reminder.hours * 3600000);
    if (scheduledAt.getTime() <= Date.now()) continue;
    create({
      tenantId: appointment.tenantId, branchId: appointment.branchId || "", customerId: appointment.clientId,
      type: "appointment_reminder", category: "bookings", preference: "bookingReminders",
      title: `Appointment ${reminder.label}`,
      body: `Your AuraSalon appointment is ${reminder.label}, ${formatAppointmentTime(appointment.startAt)}.`,
      data: { appointmentId: appointment.id, startAt: appointment.startAt }, deepLink: `/bookings/${appointment.id}`,
      sourceType: "appointment_reminder", sourceId: appointment.id,
      eventKey: `appointment-reminder:${appointment.id}:${appointment.startAt}:${reminder.hours}h`, scheduledAt: scheduledAt.toISOString()
    });
  }
}

function notifyAppointmentCreated(appointment = {}, requested = false) {
  if (!appointment.tenantId || !appointment.clientId) return null;
  const result = create({
    tenantId: appointment.tenantId, branchId: appointment.branchId || "", customerId: appointment.clientId,
    type: requested ? "booking_requested" : "booking_confirmed", category: "bookings",
    title: requested ? "Booking request received" : "Booking confirmed",
    body: `${requested ? "We received your booking request for" : "Your appointment is confirmed for"} ${formatAppointmentTime(appointment.startAt)}.`,
    data: { appointmentId: appointment.id, status: appointment.status || "booked", startAt: appointment.startAt || "" },
    deepLink: `/bookings/${appointment.id}`, sourceType: "appointment", sourceId: appointment.id,
    eventKey: `appointment:${appointment.id}:${requested ? "requested" : "confirmed"}:${appointment.startAt || appointment.createdAt || ""}`
  });
  if (!requested) scheduleAppointmentReminders(appointment);
  return result;
}

function safely(action) {
  try { return action(); } catch { return null; }
}

function cancelFutureBookingReminders(tenantId, customerId) {
  const rows = db.prepare(`SELECT id, pushNotificationId FROM customerInboxNotifications
    WHERE tenantId = @tenantId AND customerId = @customerId AND type = 'appointment_reminder'
      AND archivedAt = '' AND datetime(scheduledAt) > datetime('now')`)
    .all({ tenantId, customerId });
  if (!rows.length) return;
  const stamp = now();
  const archive = db.prepare(`UPDATE customerInboxNotifications SET archivedAt = @stamp, updatedAt = @stamp
    WHERE id = @id AND tenantId = @tenantId AND customerId = @customerId`);
  const cancelPush = db.prepare(`UPDATE push_notifications SET status = 'cancelled', updatedAt = @stamp
    WHERE id = @id AND tenantId = @tenantId AND status = 'queued'`);
  db.transaction(() => rows.forEach((row) => {
    archive.run({ id: row.id, tenantId, customerId, stamp });
    if (row.pushNotificationId) cancelPush.run({ id: row.pushNotificationId, tenantId, stamp });
  }))();
}

function notifyAppointmentChanged(previous = {}, appointment = {}) {
  if (!appointment.tenantId || !appointment.clientId) return null;
  const status = String(appointment.status || "").toLowerCase();
  const startChanged = Boolean(previous.startAt && appointment.startAt && previous.startAt !== appointment.startAt);
  if (status === "cancelled") {
    cancelAppointmentReminders(appointment);
    return create({ tenantId: appointment.tenantId, branchId: appointment.branchId || "", customerId: appointment.clientId,
      type: "booking_cancelled", category: "bookings", title: "Booking cancelled",
      body: `Your appointment for ${formatAppointmentTime(appointment.startAt)} has been cancelled.`,
      data: { appointmentId: appointment.id, status }, deepLink: `/bookings/${appointment.id}`,
      sourceType: "appointment", sourceId: appointment.id, eventKey: `appointment:${appointment.id}:cancelled:${appointment.updatedAt || now()}` });
  }
  if (startChanged || status === "rescheduled") {
    scheduleAppointmentReminders(appointment);
    return create({ tenantId: appointment.tenantId, branchId: appointment.branchId || "", customerId: appointment.clientId,
      type: "booking_rescheduled", category: "bookings", title: "Booking rescheduled",
      body: `Your appointment is now scheduled for ${formatAppointmentTime(appointment.startAt)}.`,
      data: { appointmentId: appointment.id, status, startAt: appointment.startAt }, deepLink: `/bookings/${appointment.id}`,
      sourceType: "appointment", sourceId: appointment.id, eventKey: `appointment:${appointment.id}:rescheduled:${appointment.startAt}` });
  }
  if (status === "confirmed" && String(previous.status || "").toLowerCase() !== "confirmed") return notifyAppointmentCreated(appointment, false);
  if (status === "completed" && String(previous.status || "").toLowerCase() !== "completed") {
    cancelAppointmentReminders(appointment);
    return create({ tenantId: appointment.tenantId, branchId: appointment.branchId || "", customerId: appointment.clientId,
      type: "review_request", category: "bookings", title: "How was your visit?", body: "Your appointment is complete. Share your experience with AuraSalon.",
      data: { appointmentId: appointment.id, status }, deepLink: `/bookings/${appointment.id}`,
      sourceType: "appointment", sourceId: appointment.id, eventKey: `appointment:${appointment.id}:completed` });
  }
  return null;
}

export const customerNotificationService = {
  create,
  safeCreate(input) { return safely(() => create(input)); },
  notifyAppointmentCreated,
  safeNotifyAppointmentCreated(appointment, requested = false) { return safely(() => notifyAppointmentCreated(appointment, requested)); },
  notifyAppointmentChanged,
  safeNotifyAppointmentChanged(previous, appointment) { return safely(() => notifyAppointmentChanged(previous, appointment)); },
  scheduleAppointmentReminders,
  cancelAppointmentReminders,

  list(access, query = {}) {
    assertCustomer(access);
    const limit = Math.min(Math.max(Number(query.limit || 100), 1), 200);
    return db.prepare(`SELECT * FROM customerInboxNotifications
      WHERE tenantId = @tenantId AND customerId = @customerId AND archivedAt = ''
        AND datetime(scheduledAt) <= datetime(@currentTime)
      ORDER BY datetime(scheduledAt) DESC, datetime(createdAt) DESC LIMIT @limit`)
      .all({ tenantId: access.tenantId, customerId: access.userId, currentTime: now(), limit }).map(notificationRow);
  },

  markRead(access, notificationId, status = "read") {
    assertCustomer(access);
    const readAt = status === "unread" ? "" : now();
    const result = db.prepare(`UPDATE customerInboxNotifications SET readAt = @readAt, updatedAt = @updatedAt
      WHERE id = @id AND tenantId = @tenantId AND customerId = @customerId AND archivedAt = ''`)
      .run({ id: notificationId, tenantId: access.tenantId, customerId: access.userId, readAt, updatedAt: now() });
    if (!result.changes) throw notFound("Notification not found");
    return notificationRow(db.prepare(`SELECT * FROM customerInboxNotifications WHERE id = @id AND tenantId = @tenantId AND customerId = @customerId`)
      .get({ id: notificationId, tenantId: access.tenantId, customerId: access.userId }));
  },

  markAllRead(access) {
    assertCustomer(access);
    const stamp = now();
    const result = db.prepare(`UPDATE customerInboxNotifications SET readAt = @stamp, updatedAt = @stamp
      WHERE tenantId = @tenantId AND customerId = @customerId AND readAt = '' AND archivedAt = '' AND datetime(scheduledAt) <= datetime(@stamp)`)
      .run({ tenantId: access.tenantId, customerId: access.userId, stamp });
    return { updated: result.changes, readAt: stamp };
  },

  preferences(access) {
    assertCustomer(access);
    const row = db.prepare(`SELECT * FROM customerNotificationPreferences WHERE tenantId = @tenantId AND customerId = @customerId LIMIT 1`)
      .get({ tenantId: access.tenantId, customerId: access.userId });
    return row ? preferenceRecord(row) : { ...DEFAULT_PREFERENCES };
  },

  updatePreferences(access, payload = {}) {
    assertCustomer(access);
    const current = this.preferences(access);
    const stamp = now();
    const row = {
      id: `cnp_${createHash("sha256").update(`${access.tenantId}:${access.userId}`).digest("hex").slice(0, 24)}`,
      tenantId: access.tenantId, branchId: branchForCustomer(access.tenantId, access.userId, access.branchId || ""), customerId: access.userId,
      bookingReminders: bool(payload.bookingReminders, current.bookingReminders, "bookingReminders") ? 1 : 0,
      promotions: bool(payload.promotions, current.promotions, "promotions") ? 1 : 0,
      loyalty: bool(payload.loyalty, current.loyalty, "loyalty") ? 1 : 0,
      membership: bool(payload.membership, current.membership, "membership") ? 1 : 0,
      createdAt: stamp, updatedAt: stamp
    };
    db.prepare(`INSERT INTO customerNotificationPreferences
      (id, tenantId, branchId, customerId, bookingReminders, promotions, loyalty, membership, createdAt, updatedAt)
      VALUES (@id, @tenantId, @branchId, @customerId, @bookingReminders, @promotions, @loyalty, @membership, @createdAt, @updatedAt)
      ON CONFLICT(tenantId, customerId) DO UPDATE SET branchId = excluded.branchId,
        bookingReminders = excluded.bookingReminders, promotions = excluded.promotions, loyalty = excluded.loyalty,
        membership = excluded.membership, updatedAt = excluded.updatedAt`).run(row);
    if (!row.bookingReminders) cancelFutureBookingReminders(access.tenantId, access.userId);
    return preferenceRecord(row);
  },

  registerDevice(access, payload = {}) {
    assertCustomer(access);
    const deviceId = String(payload.deviceId || "").trim();
    const token = String(payload.token || payload.deviceToken || "").trim();
    if (!deviceId || !token) throw badRequest("deviceId and push token are required");
    db.prepare(`UPDATE mobile_devices SET status = 'inactive', deviceToken = '', updatedAt = @updatedAt
      WHERE deviceToken = @deviceToken AND (tenantId != @tenantId OR userId != @userId)`)
      .run({ tenantId: access.tenantId, userId: access.userId, deviceToken: token, updatedAt: now() });
    return pushNotificationService.registerDevice({
      id: customerDeviceId(access, deviceId), platform: payload.platform || "android", deviceToken: token,
      pushProvider: "fcm", appVersion: payload.appVersion || "", branchId: branchForCustomer(access.tenantId, access.userId, access.branchId || ""),
      capabilities: { push: true, customerApp: true, clientDeviceId: deviceId }
    }, access);
  },

  unregisterDevice(access, deviceId) {
    assertCustomer(access);
    const id = customerDeviceId(access, deviceId);
    const result = db.prepare(`UPDATE mobile_devices SET status = 'inactive', deviceToken = '', updatedAt = @updatedAt
      WHERE id = @id AND tenantId = @tenantId AND userId = @userId`)
      .run({ id, tenantId: access.tenantId, userId: access.userId, updatedAt: now() });
    return { unregistered: Boolean(result.changes) };
  }
};
