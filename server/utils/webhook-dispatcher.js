import { createHmac, randomUUID } from "node:crypto";
import { discountWebhooksRepo } from "../repositories/discount-webhooks.repo.js";

function truncate(value, limit = 2000) {
  return String(value || "").slice(0, limit);
}

function signPayload(secret, body) {
  if (!secret) return "";
  return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}

function deliveryEventKey(eventType, payload = {}) {
  return String(payload.eventKey || payload.idempotencyKey || `${eventType}:${payload.eventId || randomUUID()}`);
}

function deliveryEnvelope(eventType, scope = {}, payload = {}, eventKey) {
  return {
    eventId: payload.eventId || randomUUID(),
    eventType,
    eventKey,
    tenantId: scope.tenantId,
    branchId: scope.branchId,
    occurredAt: new Date().toISOString(),
    data: payload.data || payload
  };
}

async function deliver(webhook, envelope) {
  const body = JSON.stringify(envelope);
  const signature = signPayload(webhook.secret, body);
  const headers = {
    "content-type": "application/json",
    "x-aura-event": envelope.eventType,
    "x-aura-event-id": envelope.eventId,
    "x-aura-event-key": envelope.eventKey,
    ...(signature ? { "x-aura-signature": signature } : {}),
    ...(webhook.headers || {})
  };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(webhook.url, {
      method: "POST",
      headers,
      body,
      signal: controller.signal
    });
    const responseBody = truncate(await response.text());
    const status = response.ok ? "delivered" : "failed";
    return {
      signature,
      status,
      attempts: 1,
      responseStatus: response.status,
      responseBody,
      errorMessage: response.ok ? "" : truncate(responseBody, 1000),
      nextRetryAt: response.ok ? null : Math.floor(Date.now() / 1000) + 300,
      deliveredAt: response.ok ? Math.floor(Date.now() / 1000) : null
    };
  } catch (error) {
    return {
      signature,
      status: "failed",
      attempts: 1,
      responseStatus: null,
      responseBody: "",
      errorMessage: truncate(error.message || "Webhook delivery failed", 1000),
      nextRetryAt: Math.floor(Date.now() / 1000) + 300,
      deliveredAt: null
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function emitDiscountWebhook(eventType, scope = {}, payload = {}) {
  if (!scope.tenantId || !scope.branchId || !eventType) return { attempted: 0, delivered: 0, failed: 0 };
  try {
    const webhooks = discountWebhooksRepo.matchingWebhooks({
      tenantId: scope.tenantId,
      branchId: scope.branchId,
      eventType
    });
    let deliveredCount = 0;
    let failedCount = 0;
    for (const webhook of webhooks) {
      const eventKey = deliveryEventKey(eventType, payload);
      const envelope = deliveryEnvelope(eventType, scope, payload, eventKey);
      const result = await deliver(webhook, envelope);
      discountWebhooksRepo.recordDelivery({
        tenantId: scope.tenantId,
        branchId: scope.branchId,
        webhookId: webhook.id,
        eventType,
        eventKey,
        payload: envelope,
        ...result
      });
      if (result.status === "delivered") deliveredCount += 1;
      else failedCount += 1;
    }
    return { attempted: webhooks.length, delivered: deliveredCount, failed: failedCount };
  } catch {
    return { attempted: 0, delivered: 0, failed: 0 };
  }
}

export const webhookDispatcher = {
  emitDiscountWebhook
};
