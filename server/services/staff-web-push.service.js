import webpush from "web-push";
import "../config/env.js";
import { db } from "../db.js";
import { jobQueueService } from "./job-queue.service.js";

const makeId = (prefix) => `${prefix}_${crypto.randomUUID().slice(0, 10)}`;

function settings() {
  return {
    publicKey: String(process.env.WEB_PUSH_VAPID_PUBLIC_KEY || "").trim(),
    privateKey: String(process.env.WEB_PUSH_VAPID_PRIVATE_KEY || "").trim(),
    subject: String(process.env.WEB_PUSH_VAPID_SUBJECT || process.env.APP_PUBLIC_URL || "mailto:support@aurashine.com").trim()
  };
}

function configured() {
  const value = settings();
  return Boolean(value.publicKey && value.privateKey && value.subject);
}

function updatePushStatus(id, tenantId, status, providerMessageId = "") {
  const updatedAt = new Date().toISOString();
  db.prepare(`UPDATE push_notifications
    SET status = @status, providerMessageId = @providerMessageId,
        sentAt = CASE WHEN @status = 'sent' THEN @updatedAt ELSE sentAt END,
        updatedAt = @updatedAt
    WHERE id = @id AND tenantId = @tenantId`).run({ id, tenantId, status, providerMessageId, updatedAt });
}

export const staffWebPushService = {
  publicConfig() {
    const value = settings();
    return { configured: configured(), publicKey: configured() ? value.publicKey : "" };
  },

  queueStaffNotification(notification) {
    if (!configured() || !notification?.tenantId || !notification?.staffId) return { queued: false, reason: "not_configured" };
    const user = db.prepare(`SELECT id FROM tenant_users
      WHERE tenantId = @tenantId AND staffId = @staffId AND status = 'active'
      ORDER BY createdAt ASC LIMIT 1`).get({ tenantId: notification.tenantId, staffId: notification.staffId });
    if (!user) return { queued: false, reason: "staff_login_not_found" };
    const createdAt = new Date().toISOString();
    const row = {
      id: makeId("push"), tenantId: notification.tenantId, userId: user.id,
      branchId: notification.branchId || "", deviceId: "",
      title: notification.title || "Aura Staff notification",
      message: notification.body || "You have a new staff notification.",
      payload: JSON.stringify({ staffNotificationId: notification.id, type: notification.type || "staff", url: "/staff/notifications" }),
      status: "queued", providerMessageId: "", sentAt: "", createdAt, updatedAt: createdAt
    };
    db.prepare(`INSERT INTO push_notifications
      (id, tenantId, userId, branchId, deviceId, title, message, payload, status, providerMessageId, sentAt, createdAt, updatedAt)
      VALUES (@id, @tenantId, @userId, @branchId, @deviceId, @title, @message, @payload, @status, @providerMessageId, @sentAt, @createdAt, @updatedAt)`).run(row);
    jobQueueService.enqueue({ tenantId: row.tenantId, jobType: "staff_web_push_send", priority: 2, payload: { pushNotificationId: row.id } });
    return { queued: true, id: row.id };
  },

  async deliver(pushNotificationId, tenantId) {
    const notification = db.prepare(`SELECT * FROM push_notifications
      WHERE id = @id AND tenantId = @tenantId`).get({ id: pushNotificationId, tenantId });
    if (!notification) return { success: true, skipped: "notification_not_found" };
    if (notification.status === "sent") return { success: true, skipped: "already_sent" };
    if (!configured()) throw new Error("Web Push VAPID keys are not configured");
    const subscriptions = db.prepare(`SELECT * FROM push_subscriptions
      WHERE tenantId = @tenantId AND userId = @userId AND status = 'active' AND provider = 'web-push'
      ORDER BY updatedAt DESC`).all({ tenantId, userId: notification.userId });
    if (!subscriptions.length) {
      updatePushStatus(notification.id, tenantId, "no_subscription");
      return { success: true, skipped: "no_subscription" };
    }

    const vapid = settings();
    webpush.setVapidDetails(vapid.subject, vapid.publicKey, vapid.privateKey);
    let data = {};
    try { data = JSON.parse(notification.payload || "{}"); } catch { data = {}; }
    const body = JSON.stringify({ title: notification.title, body: notification.message, icon: "/assets/icons/icon.svg", badge: "/assets/icons/icon.svg", data });
    let delivered = 0;
    let lastError = null;
    for (const subscription of subscriptions) {
      try {
        await webpush.sendNotification({ endpoint: subscription.endpoint, keys: { auth: subscription.authSecret, p256dh: subscription.p256dh } }, body, { TTL: 86400, urgency: "high" });
        delivered += 1;
      } catch (error) {
        lastError = error;
        if ([404, 410].includes(Number(error?.statusCode))) {
          db.prepare(`UPDATE push_subscriptions SET status = 'expired', updatedAt = @updatedAt
            WHERE id = @id AND tenantId = @tenantId`).run({ id: subscription.id, tenantId, updatedAt: new Date().toISOString() });
        }
      }
    }
    if (!delivered && lastError && ![404, 410].includes(Number(lastError?.statusCode))) throw lastError;
    updatePushStatus(notification.id, tenantId, delivered ? "sent" : "no_subscription", delivered ? `web-push:${delivered}` : "");
    return { success: true, delivered };
  }
};
