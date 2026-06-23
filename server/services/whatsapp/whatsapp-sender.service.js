import { db } from "../../db.js";
import { logger } from "../../utils/logger.js";
import { env } from "../../config/env.js";

const PROVIDER = env.whatsappProvider || "local";
const CLOUD_API_BASE = `https://graph.facebook.com/${env.metaGraphVersion || "v20.0"}`;
const PHONE_NUMBER_ID = env.whatsappPhoneNumberId || "";
const ACCESS_TOKEN = env.whatsappAccessToken || "";

function normalizePhone(phone = "") {
  const digits = String(phone).replace(/\D/g, "");
  if (!digits) return "";
  if (digits.length === 10) return `91${digits}`;
  if (digits.startsWith("91") && digits.length === 12) return digits;
  return digits;
}

function updateMessageStatus(messageId, tenantId, status, providerMessageId = "") {
  if (!messageId || !tenantId) return;
  try {
    db.prepare(
      `UPDATE whatsapp_messages
       SET status = ?, providerMessageId = COALESCE(NULLIF(?, ''), providerMessageId), updatedAt = ?
       WHERE id = ? AND tenantId = ?`
    ).run(status, providerMessageId, new Date().toISOString(), messageId, tenantId);
  } catch (err) {
    logger.warn("whatsapp_sender_status_update_failed", { messageId, error: err.message });
  }
}

async function sendViaCloudApi(phone, body, options = {}) {
  if (!PHONE_NUMBER_ID || !ACCESS_TOKEN) {
    logger.warn("whatsapp_cloud_api_not_configured", { reason: "missing_phone_number_id_or_token" });
    return { success: false, provider: "cloud-api", error: "WhatsApp Cloud API not configured" };
  }

  const to = normalizePhone(phone);
  if (!to) {
    return { success: false, provider: "cloud-api", error: "Invalid phone number" };
  }

  const payload = {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to,
    type: options.templateName ? "template" : "text",
  };

  if (options.templateName) {
    payload.type = "template";
    payload.template = {
      name: options.templateName,
      language: { code: options.language || "en" },
    };
    if (options.templateParams?.length) {
      payload.template.components = [
        { type: "body", parameters: options.templateParams.map((p) => ({ type: "text", text: String(p) })) },
      ];
    }
  } else {
    payload.text = { preview_url: Boolean(options.previewUrl), body: String(body || "") };
  }

  try {
    const response = await fetch(`${CLOUD_API_BASE}/${PHONE_NUMBER_ID}/messages`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${ACCESS_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const result = await response.json();

    if (!response.ok) {
      logger.error("whatsapp_cloud_api_error", {
        status: response.status,
        error: result.error,
        phone: to.slice(0, 6) + "****",
      });
      return { success: false, provider: "cloud-api", error: result.error?.message || result.error?.toString() || "Unknown API error" };
    }

    const providerMessageId = result.messages?.[0]?.id || "";
    logger.info("whatsapp_cloud_api_sent", { providerMessageId, phone: to.slice(0, 6) + "****" });
    return { success: true, provider: "cloud-api", providerMessageId };
  } catch (err) {
    logger.error("whatsapp_cloud_api_request_failed", { error: err.message, phone: to.slice(0, 6) + "****" });
    return { success: false, provider: "cloud-api", error: err.message };
  }
}

function sendLocal(phone, body, options = {}) {
  const to = normalizePhone(phone);
  logger.info("whatsapp_local_simulated", {
    phone: to ? to.slice(0, 6) + "****" : "unknown",
    body: String(body || "").slice(0, 80),
    template: options.templateName || "none",
  });
  return { success: true, provider: "local", providerMessageId: `sim_${Date.now()}` };
}

export async function sendWhatsAppMessage(phone, body, options = {}) {
  const result = PROVIDER === "cloud-api"
    ? await sendViaCloudApi(phone, body, options)
    : sendLocal(phone, body, options);

  return result;
}

export async function sendAndTrack(phone, body, options = {}) {
  const { messageId, tenantId } = options;
  const result = await sendWhatsAppMessage(phone, body, options);

  if (messageId && tenantId) {
    const status = result.success ? "sent" : "failed";
    updateMessageStatus(messageId, tenantId, status, result.providerMessageId || "");
  }

  return result;
}
