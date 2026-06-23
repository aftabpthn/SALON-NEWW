import { db } from "../../db.js";
import { whatsappAutomationService } from "../../services/whatsapp-automation.service.js";
import { whatsappTemplateService } from "../../services/whatsapp-template.service.js";
import { sendAndTrack } from "../../services/whatsapp/whatsapp-sender.service.js";

function parseJson(value, fallback = []) {
  try {
    return typeof value === "string" ? JSON.parse(value || "null") ?? fallback : value ?? fallback;
  } catch {
    return fallback;
  }
}

function accessFor(job, branchId = "") {
  return {
    tenantId: job.tenantId,
    role: "owner",
    userId: "job-worker",
    branchId,
    branchIds: branchId ? [branchId] : []
  };
}

function appointmentContext(tenantId, appointmentId) {
  if (!tenantId || !appointmentId) return {};
  const appointment = db.prepare("SELECT * FROM appointments WHERE tenantId = ? AND id = ?").get(tenantId, appointmentId);
  if (!appointment) return {};
  const client = db.prepare("SELECT * FROM clients WHERE tenantId = ? AND id = ?").get(tenantId, appointment.clientId) || {};
  const branch = db.prepare("SELECT * FROM branches WHERE tenantId = ? AND id = ?").get(tenantId, appointment.branchId) || {};
  const staff = db.prepare("SELECT * FROM staff WHERE tenantId = ? AND id = ?").get(tenantId, appointment.staffId) || {};
  const serviceIds = parseJson(appointment.serviceIds, []);
  const services = serviceIds.length
    ? db.prepare(`SELECT * FROM services WHERE tenantId = ? AND id IN (${serviceIds.map(() => "?").join(",")})`).all(tenantId, ...serviceIds)
    : [];
  const when = appointment.startAt ? new Date(appointment.startAt) : null;
  return {
    appointment,
    client,
    branch,
    staff,
    variables: {
      client_name: client.name || "Guest",
      salon_name: "Aura Salon",
      branch_name: branch.name || "our salon",
      booking_id: appointment.id,
      service_name: services.map((service) => service.name).join(", ") || "service",
      staff_name: staff.name || "our stylist",
      date: when && !Number.isNaN(when.getTime()) ? when.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "",
      time: when && !Number.isNaN(when.getTime()) ? when.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }) : ""
    }
  };
}

export async function run(job) {
  const payload = job.payload || {};
  const appointmentData = appointmentContext(job.tenantId, payload.appointmentId);
  const client = payload.clientId
    ? db.prepare("SELECT * FROM clients WHERE tenantId = ? AND id = ?").get(job.tenantId, payload.clientId)
    : appointmentData.client;
  const branchId = payload.branchId || appointmentData.appointment?.branchId || client?.branchId || "";
  const variables = {
    ...(appointmentData.variables || {}),
    ...(payload.variables || {}),
    payment_link: payload.paymentLink || payload.variables?.payment_link || "",
    expires_at: payload.expiresAt || payload.variables?.expires_at || ""
  };
  const language = payload.language || client?.preferredLanguage || "en";
  const rendered = payload.body
    ? { body: payload.body, language, missingVariables: [] }
    : whatsappTemplateService.renderTemplate(payload.template || "booking_confirmation", language, variables);
  const phone = payload.phone || client?.phone || "";
  if (!phone && !client?.id) {
    return { success: true, skipped: true, reason: "missing_recipient" };
  }
  const access = accessFor(job, branchId);
  const thread = whatsappAutomationService.ensureThread({
    phone,
    displayName: client?.name || variables.client_name || "WhatsApp guest",
    client,
    branchId,
    source: payload.source || "online-booking"
  }, access);
  const message = whatsappAutomationService.createOutbound(thread, {
    body: rendered.body,
    eventType: payload.eventType || payload.template || "online-booking",
    templateKey: payload.template || "",
    metadata: {
      refId: payload.refId || payload.appointmentId || payload.sessionId || "",
      appointmentId: payload.appointmentId || "",
      sessionId: payload.sessionId || "",
      language: rendered.language,
      missingVariables: rendered.missingVariables || []
    }
  }, access);

  const sendResult = await sendAndTrack(phone, rendered.body, {
    messageId: message.id,
    tenantId: job.tenantId,
    templateName: payload.template || "",
    language: rendered.language,
    previewUrl: payload.previewUrl
  });

  return { success: true, messageId: message.id, threadId: thread.id, sendResult };
}
