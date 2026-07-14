import { db } from "../db.js";
import { repositories } from "../repositories/repository-registry.js";
import { badRequest, notFound } from "../utils/app-error.js";
import { invoiceNotificationService } from "./invoice-notification.service.js";
import { jobQueueService } from "./job-queue.service.js";
import { securityService } from "./security.service.js";
import { tenantService } from "./tenant.service.js";
import { generalSettingsService } from "./general-settings.service.js";

function compactUnique(values = []) {
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))];
}

function normalizeIndianPhone(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const digits = raw.replace(/\D/g, "");
  if (!digits || digits.length < 7) return "";
  if (digits.startsWith("00") && digits.length > 4) return `+${digits.slice(2)}`;
  if (digits.length === 11 && digits.startsWith("0")) return `+91${digits.slice(1)}`;
  if (digits.length === 10) return `+91${digits}`;
  if (digits.length === 12 && digits.startsWith("91")) return `+${digits}`;
  if (raw.startsWith("+")) return `+${digits}`;
  return digits.length <= 15 ? `+${digits}` : "";
}

function phonesFrom(values = []) {
  const source = Array.isArray(values) ? values : String(values || "").split(/[\n,;]/);
  return compactUnique(source.map(normalizeIndianPhone)).filter((item) => /^\+\d{7,15}$/.test(item));
}

function emailsFrom(values = []) {
  const source = Array.isArray(values) ? values : String(values || "").split(/[\n,;]/);
  return compactUnique(source).filter((item) => item.includes("@"));
}

function normalizeServiceIds(value) {
  if (Array.isArray(value)) return value.map((item) => String(item || "").trim()).filter(Boolean);
  if (typeof value !== "string") return [];
  const trimmed = value.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith("[")) {
    try {
      const parsed = JSON.parse(trimmed);
      return Array.isArray(parsed) ? parsed.map((item) => String(item || "").trim()).filter(Boolean) : [];
    } catch {
      return [];
    }
  }
  return trimmed.split(",").map((item) => item.trim()).filter(Boolean);
}

function formatInIndia(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Kolkata" });
}

function money(value) {
  return `INR ${Number(value || 0).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}

function appointmentValue(appointment = {}, services = []) {
  const explicit = Number(appointment.estimatedAmount || appointment.amount || appointment.total || appointment.value || 0);
  if (explicit) return explicit;
  return services.reduce((sum, service) => sum + Number(service?.price || service?.amount || 0), 0);
}

class AppointmentSmsService {
  queueAppointmentSms(appointmentId, payload = {}, access = {}) {
    if (!appointmentId) throw badRequest("appointmentId is required");
    const target = String(payload.target || "").toLowerCase();
    if (!["client", "staff", "owner"].includes(target)) throw badRequest("target must be client, staff or owner");

    const appointment = repositories.appointments.getById(appointmentId, { tenantId: access.tenantId });
    if (!appointment) throw notFound("Appointment not found");
    const branchId = appointment.branchId || access.branchId || "";
    if (branchId) tenantService.assertBranchAccess(access, branchId);
    if (target === "owner" && !generalSettingsService.ownerNotificationsEnabled(access, branchId)) {
      return { queued: false, target, count: 0, recipients: [], emailRecipients: [], messageLogs: [], policyDisabled: true };
    }

    const context = this.contextForAppointment(appointment, access, branchId);
    const recipients = this.recipientsForTarget(target, context);
    const ownerEmailRecipients = target === "owner" ? this.ownerEmailRecipients(context, access) : [];
    if (!recipients.length && !ownerEmailRecipients.length) throw badRequest(target === "owner" ? "Owner mobile or verified owner email is missing" : `${target} mobile number is missing`);

    const rows = recipients.map((recipient) => repositories.messageLogs.create({
      branchId,
      clientId: target === "client" ? appointment.clientId || "" : "",
      channel: "SMS",
      recipient: recipient.phone,
      message: this.messageForTarget(target, context),
      direction: "outbound",
      status: "queued",
      payload: {
        appointmentId: appointment.id,
        target,
        recipientName: recipient.name,
        staffId: appointment.staffId || "",
        serviceIds: context.serviceIds,
        providerMode: context.profile.providerMode || "queued",
        source: "appointment-sms-service"
      }
    }, tenantService.accessScope(access, "messageLogs")));
    const emailJobs = target === "owner" ? this.queueOwnerAppointmentEmails(ownerEmailRecipients, context, access) : [];

    securityService.audit({
      action: "appointment.sms.queued",
      targetType: "message_logs",
      targetId: rows.map((row) => row.id).join(","),
      details: { appointmentId, target, count: rows.length, emailCount: emailJobs.length, branchId }
    }, access);

    return {
      queued: true,
      target,
      count: rows.length + emailJobs.length,
      recipients: recipients.map((recipient) => ({ name: recipient.name, phone: recipient.phone })),
      emailRecipients: ownerEmailRecipients.map((recipient) => ({ name: recipient.name, email: recipient.email })),
      messageLogs: rows
    };
  }

  contextForAppointment(appointment, access, branchId) {
    const client = appointment.clientId
      ? repositories.clients.getById(appointment.clientId, { tenantId: access.tenantId }) || {}
      : {};
    const staff = this.findStaff(appointment.staffId, access.tenantId);
    const serviceIds = normalizeServiceIds(appointment.serviceIds);
    const services = serviceIds.map((id) => repositories.services.getById(id, { tenantId: access.tenantId }) || { id, name: id });
    const profile = invoiceNotificationService.getProfile({ branchId }, access);
    return {
      appointment,
      client,
      staff,
      serviceIds,
      services,
      profile,
      serviceNames: services.map((service) => service.name || service.id).filter(Boolean).join(", ") || "service",
      clientName: client.name || "Client",
      staffName: staff.name || "Staff",
      salonName: profile.businessName || "AuraShine",
      startLabel: formatInIndia(appointment.startAt),
      value: appointmentValue(appointment, services)
    };
  }

  recipientsForTarget(target, context) {
    if (target === "client") {
      return this.recipientRows(context.clientName, [
        context.client.phone,
        context.client.mobile,
        context.client.mobileNumber,
        context.client.contactNumber,
        context.client.whatsapp,
        context.client.whatsappNumber
      ]);
    }
    if (target === "staff") {
      return this.recipientRows(context.staffName, [
        context.staff.phone,
        context.staff.mobile,
        context.staff.mobileNumber,
        context.staff.contactNumber,
        context.staff.whatsapp,
        context.staff.whatsappNumber,
        context.staff.staffPhone
      ]);
    }
    return this.recipientRows("Owner", [
      ...(Array.isArray(context.profile.ownerMobiles) ? context.profile.ownerMobiles : []),
      context.profile.ownerMobile,
      context.profile.mobileNumber,
      context.profile.appointmentNumber
    ]);
  }

  recipientRows(name, values) {
    return phonesFrom(values).map((phone) => ({ name, phone }));
  }

  ownerEmailRecipients(context, access) {
    const verifiedOwnerEmails = invoiceNotificationService.verifiedProfileContactValues(context.profile, access, "ownerEmail", "email");
    return emailsFrom([
      context.profile.adminEmail,
      ...verifiedOwnerEmails
    ]).map((email) => ({ name: "Owner", email }));
  }

  queueOwnerAppointmentEmails(recipients, context, access) {
    if (!recipients.length || !context.profile.ownerChannels?.includes("email")) return [];
    const message = this.messageForTarget("owner", context);
    return recipients.map((recipient) => jobQueueService.enqueue({
      tenantId: access.tenantId,
      jobType: "email_send",
      priority: 3,
      payload: {
        to: recipient.email,
        branchId: context.appointment.branchId || access.branchId || "",
        type: "owner_appointment_alert",
        subject: `${context.salonName} appointment alert - ${context.clientName}`,
        message,
        metadata: {
          source: "appointment-owner-alert",
          appointmentId: context.appointment.id
        }
      }
    }));
  }

  messageForTarget(target, context) {
    if (target === "staff") {
      return `${context.salonName} booking: ${context.clientName} for ${context.serviceNames} on ${context.startLabel}. Chair/room: ${context.appointment.chair || context.appointment.room || "not assigned"}.`;
    }
    if (target === "owner") {
      return `${context.salonName} owner alert: ${context.clientName} booked ${context.serviceNames} with ${context.staffName} on ${context.startLabel}. Value ${money(context.value)}.`;
    }
    return `Hi ${context.clientName}, your ${context.serviceNames} appointment at ${context.salonName} is scheduled for ${context.startLabel} with ${context.staffName}. Reply YES to confirm or call us to reschedule.`;
  }

  findStaff(staffId, tenantId) {
    if (!staffId) return {};
    const legacy = repositories.staff.getById(staffId, { tenantId }) || {};
    if (legacy.id) return legacy;
    const staffOs = db.prepare("SELECT * FROM staff_master WHERE tenant_id = ? AND id = ?").get(tenantId, staffId) || {};
    if (!staffOs.id) return {};
    return {
      id: staffOs.id,
      name: staffOs.full_name || [staffOs.first_name, staffOs.last_name].filter(Boolean).join(" ") || "Staff",
      phone: staffOs.mobile,
      mobile: staffOs.mobile,
      email: staffOs.email,
      branchId: staffOs.branch_id
    };
  }
}

export const appointmentSmsService = new AppointmentSmsService();
