import { repositories } from "../repositories/repository-registry.js";
import { badRequest, notFound } from "../utils/app-error.js";
import { authService } from "./auth.service.js";
import { realtimeService } from "./realtime.service.js";
import { tenantService } from "./tenant.service.js";

const now = () => new Date().toISOString();
const makeId = (prefix) => `${prefix}_${crypto.randomUUID().slice(0, 10)}`;

function scope(access, branchId = "") {
  const scoped = tenantService.accessScope(access || {}, "");
  if (branchId) scoped.branchId = branchId;
  return scoped;
}

export class PushNotificationService {
  registerDevice(payload = {}, access) {
    const existing = payload.id ? repositories.mobileDevices.getById(payload.id, { tenantId: access.tenantId }) : null;
    if (existing && existing.userId !== access.userId) throw notFound("Mobile device not found");
    return authService.registerDevice({ ...payload, userId: access.userId }, access);
  }

  subscribe(payload = {}, access) {
    if (!payload.deviceId || !payload.endpoint) throw badRequest("deviceId and endpoint are required");
    const device = repositories.mobileDevices.getById(payload.deviceId, { tenantId: access.tenantId });
    if (!device) throw notFound("Mobile device not found");
    if (device.userId !== access.userId) throw notFound("Mobile device not found");
    const existing = repositories.pushSubscriptions
      .list({ limit: 10000 }, { tenantId: access.tenantId })
      .find((item) => item.deviceId === payload.deviceId && item.endpoint === payload.endpoint);
    const record = {
      userId: access.userId,
      deviceId: payload.deviceId,
      branchId: payload.branchId || device.branchId || access.branchId || "",
      endpoint: payload.endpoint,
      platform: payload.platform || device.platform || "",
      provider: payload.provider || device.pushProvider || "fcm",
      authSecret: payload.authSecret || "",
      p256dh: payload.p256dh || "",
      metadata: payload.metadata || {},
      status: payload.status || "active"
    };
    return existing
      ? repositories.pushSubscriptions.update(existing.id, record, { tenantId: access.tenantId })
      : repositories.pushSubscriptions.create({ id: makeId("psub"), ...record }, { tenantId: access.tenantId });
  }

  listNotifications(query = {}, access) {
    return repositories.pushNotifications.list(query, scope(access));
  }

  send(payload = {}, access) {
    if (!payload.title || !payload.message) throw badRequest("title and message are required");
    const branchId = payload.branchId || access.branchId || "";
    if (branchId) tenantService.assertBranchAccess(access, branchId);
    const notification = repositories.pushNotifications.create({
      id: makeId("push"),
      userId: payload.userId || "",
      branchId,
      deviceId: payload.deviceId || "",
      title: payload.title,
      message: payload.message,
      payload: payload.payload || {},
      status: "queued",
      providerMessageId: "",
      sentAt: ""
    }, scope(access, branchId));
    repositories.notifications.create({
      id: makeId("note"),
      clientId: payload.clientId || "",
      type: payload.type || "push",
      channel: "push",
      message: `${payload.title}: ${payload.message}`,
      status: "queued-push"
    }, scope(access, branchId));
    realtimeService.broadcast("notification.instant", { notification }, {
      tenantId: access.tenantId,
      branchId,
      channel: branchId ? `branch:${branchId}` : `tenant:${access.tenantId}`
    });
    return notification;
  }

  markSent(id, providerMessageId = "", access) {
    const notification = repositories.pushNotifications.getById(id, { tenantId: access.tenantId });
    if (!notification) throw notFound("Push notification not found");
    return repositories.pushNotifications.update(id, {
      status: "sent",
      providerMessageId,
      sentAt: now()
    }, { tenantId: access.tenantId });
  }
}

export const pushNotificationService = new PushNotificationService();
