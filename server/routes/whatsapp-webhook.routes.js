import { Router } from "express";
import { db } from "../db.js";
import { env } from "../config/env.js";
import { logger } from "../utils/logger.js";
import { whatsappAutomationService } from "../services/whatsapp-automation.service.js";

export const whatsappWebhookRouter = Router();

const VERIFY_TOKEN = env.whatsappWebhookVerifyToken || "aura_whatsapp_verify_2026";

whatsappWebhookRouter.get("/whatsapp-webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    logger.info("whatsapp_webhook_verified");
    return res.status(200).send(challenge);
  }

  logger.warn("whatsapp_webhook_verify_failed", { mode, token: token ? "provided" : "missing" });
  return res.status(403).json({ error: "Verification failed" });
});

whatsappWebhookRouter.post("/whatsapp-webhook", (req, res) => {
  try {
    const body = req.body;
    if (!body?.object) {
      return res.status(200).json({ status: "ignored" });
    }

    const entries = body.entry || [];
    for (const entry of entries) {
      const changes = entry.changes || [];
      for (const change of changes) {
        if (change.field !== "messages") continue;
        const value = change.value || {};
        const messages = value.messages || [];
        const metadata = value.metadata || {};
        const contacts = value.contacts || [];

        for (const msg of messages) {
          const phone = msg.from || "";
          const contact = contacts.find((c) => c.wa_id === msg.from);
          const displayName = contact?.profile?.name || "";
          const messageBody = msg.text?.body || "";
          const timestamp = msg.timestamp ? new Date(Number(msg.timestamp) * 1000).toISOString() : new Date().toISOString();

          if (phone && messageBody) {
            const access = {
              tenantId: "",
              role: "system",
              userId: "whatsapp-webhook",
              branchId: metadata?.phone_number_id || "",
            };

            try {
              whatsappAutomationService.processInbound({
                phone,
                body: messageBody,
                displayName,
                source: "whatsapp_cloud_inbound",
                suppressAutoReply: false,
                raw: { msg, entry, timestamp },
              }, access);
              logger.info("whatsapp_webhook_inbound_processed", { phone: phone.slice(0, 6) + "****" });
            } catch (inboundErr) {
              logger.warn("whatsapp_webhook_inbound_failed", { phone: phone.slice(0, 6) + "****", error: inboundErr.message });
            }
          }

          if (msg.type === "button" && msg.button?.payload) {
            db.prepare(
              `INSERT INTO whatsapp_messages (id, threadId, clientId, branchId, direction, eventType, body, status, metadata, createdAt)
               VALUES (?, '', '', '', 'inbound', 'button_reply', ?, 'received', ?, ?)`
            ).run(
              `wamg_webhook_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
              msg.button.text || "",
              JSON.stringify({ payload: msg.button.payload, timestamp }),
              timestamp
            );
          }
        }

        const statuses = value.statuses || [];
        for (const status of statuses) {
          if (status.id) {
            try {
              db.prepare(
                `UPDATE whatsapp_messages
                 SET status = ?, metadata = JSON_SET(COALESCE(metadata, '{}'), '$.deliveryStatus', ?), updatedAt = ?
                 WHERE providerMessageId = ?`
              ).run(
                status.status || "unknown",
                JSON.stringify({ status: status.status, timestamp: status.timestamp ? new Date(Number(status.timestamp) * 1000).toISOString() : "", errors: status.errors || [] }),
                new Date().toISOString(),
                status.id
              );
            } catch (err) {
              logger.warn("whatsapp_webhook_status_update_failed", { providerMessageId: status.id, error: err.message });
            }
          }
        }
      }
    }

    res.status(200).json({ status: "ok" });
  } catch (err) {
    logger.error("whatsapp_webhook_error", { error: err.message });
    res.status(200).json({ status: "error", detail: err.message });
  }
});
