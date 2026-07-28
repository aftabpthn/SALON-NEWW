import { db } from "../db.js";
import { repositories } from "../repositories/repository-registry.js";
import { badRequest, conflict, notFound } from "../utils/app-error.js";
import { bookingRulesService } from "./booking-rules.service.js";
import { jobQueueService } from "./job-queue.service.js";
import { onlineBookingWhatsappService } from "./online-booking-whatsapp.service.js";
import { customerNotificationService } from "./customer-notification.service.js";
import { tenantService } from "./tenant.service.js";

function money(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function parseJson(value, fallback = []) {
  try {
    return typeof value === "string" ? JSON.parse(value || "null") ?? fallback : value ?? fallback;
  } catch {
    return fallback;
  }
}

function serviceTotal(tenantId, serviceIds = []) {
  const ids = Array.isArray(serviceIds) ? serviceIds : parseJson(serviceIds, []);
  if (!ids.length) return 0;
  const placeholders = ids.map(() => "?").join(",");
  const row = db.prepare(`SELECT COALESCE(SUM(price), 0) total FROM services WHERE tenantId = ? AND id IN (${placeholders})`).get(tenantId, ...ids);
  return money(row?.total || 0);
}

function clientContext(tenantId, customerId = "") {
  if (!customerId) return { isFirstTime: true, customerTier: "bronze", noShowCount: 0 };
  const client = db.prepare("SELECT * FROM clients WHERE tenantId = ? AND id = ?").get(tenantId, customerId);
  if (!client) return { isFirstTime: true, customerTier: "bronze", noShowCount: 0 };
  const visits = db.prepare("SELECT COUNT(*) count FROM appointments WHERE tenantId = ? AND clientId = ? AND status IN ('completed', 'billed')").get(tenantId, customerId);
  return {
    client,
    isFirstTime: Number(visits?.count || 0) === 0,
    customerTier: client.tier || "bronze",
    noShowCount: Number(client.noShowCount || 0)
  };
}

function insertAudit({ tenantId, branchId = "", userId = "", action, entityType, entityId, severity = "info", details = {} }) {
  repositories.auditLogs.create({
    id: `aud_${crypto.randomUUID().slice(0, 10)}`,
    branchId,
    actorUserId: userId,
    action,
    entityType,
    entityId,
    severity,
    details
  }, { tenantId });
}

export const bookingDepositService = {
  calculateDeposit(input = {}, access = {}) {
    const tenantId = access.tenantId || input.tenantId;
    const branchId = input.branchId || access.branchId || "";
    if (!tenantId) throw badRequest("tenantId is required");
    if (branchId) tenantService.assertBranchAccess({ ...access, tenantId }, branchId);
    const customerId = input.customerId || input.clientId || "";
    const customer = clientContext(tenantId, customerId);
    const totalAmount = money(input.totalAmount || serviceTotal(tenantId, input.serviceIds || []));
    const ruleResult = bookingRulesService.isDepositRequired({
      tenantId,
      branchId,
      totalAmount,
      isFirstTime: input.isFirstTime ?? customer.isFirstTime,
      customerTier: input.customerTier || customer.customerTier,
      noShowCount: input.noShowCount ?? customer.noShowCount,
      startAt: input.startAt || input.slot?.startAt
    });
    const amount = Math.min(totalAmount || Number(ruleResult.amount || 0), money(ruleResult.amount || 0));
    return {
      required: Boolean(ruleResult.required && amount > 0),
      amount,
      currency: ruleResult.currency || "INR",
      reason: ruleResult.reason || "not_required",
      ruleId: ruleResult.ruleId || "",
      totalAmount,
      breakdown: [
        {
          rule: ruleResult.reason || "not_required",
          applied: Boolean(ruleResult.required && amount > 0),
          contribution: amount
        }
      ]
    };
  },

  markDepositPaid({ appointmentId = "", paymentLinkId = "", transactionId = "", access = {} }) {
    const tenantId = access.tenantId;
    if (!tenantId || (!appointmentId && !paymentLinkId)) throw badRequest("appointmentId or paymentLinkId is required");
    const link = paymentLinkId
      ? db.prepare("SELECT * FROM booking_payment_links WHERE tenantId = ? AND id = ?").get(tenantId, paymentLinkId)
      : db.prepare("SELECT * FROM booking_payment_links WHERE tenantId = ? AND appointmentId = ? ORDER BY createdAt DESC LIMIT 1").get(tenantId, appointmentId);
    if (!link) throw notFound("Payment link not found");
    const targetAppointmentId = appointmentId || link.appointmentId;
    const appointment = targetAppointmentId ? repositories.appointments.getById(targetAppointmentId, { tenantId }) : null;
    let targetIds = targetAppointmentId ? [targetAppointmentId] : [];
    const txn = db.transaction(() => {
      db.prepare(
        `UPDATE booking_payment_links
         SET status = 'paid', providerPaymentId = COALESCE(NULLIF(?, ''), providerPaymentId), updatedAt = CURRENT_TIMESTAMP
         WHERE id = ? AND tenantId = ?`
      ).run(transactionId, link.id, tenantId);
      if (appointment) {
        const groupAppointmentIds = appointment.bookingGroupId
          ? db.prepare("SELECT id FROM appointments WHERE tenantId = ? AND bookingGroupId = ?").all(tenantId, appointment.bookingGroupId).map((row) => row.id)
          : [appointment.id];
        targetIds = groupAppointmentIds.length ? groupAppointmentIds : [appointment.id];
        const placeholders = targetIds.map(() => "?").join(",");
        repositories.appointments.update(appointment.id, {
          depositStatus: "paid",
          status: appointment.status === "payment_pending" ? "booked" : appointment.status
        }, { tenantId });
        db.prepare(
          `UPDATE appointments
              SET depositStatus = 'paid',
                  status = CASE WHEN status = 'payment_pending' THEN 'booked' ELSE status END,
                  updatedAt = ?
            WHERE tenantId = ?
              AND id IN (${placeholders})`
        ).run(new Date().toISOString(), tenantId, ...targetIds);
      }
      insertAudit({
        tenantId,
        branchId: appointment?.branchId || "",
        userId: access.userId || "system",
        action: "deposit.paid",
        entityType: "appointment",
        entityId: targetAppointmentId,
        details: { paymentLinkId: link.id, transactionId, amount: link.amount, bookingGroupId: appointment?.bookingGroupId || "", appointmentIds: targetIds }
      });
    });
    txn();
    if (targetAppointmentId) {
      onlineBookingWhatsappService.sendBookingConfirmation(tenantId, targetAppointmentId);
    }
    if (appointment?.clientId) {
      customerNotificationService.safeCreate({
        tenantId,
        branchId: appointment.branchId || "",
        customerId: appointment.clientId,
        type: "deposit_paid",
        category: "payments",
        title: "Deposit received",
        body: "Your booking deposit was received successfully.",
        data: { appointmentId: targetAppointmentId, paymentLinkId: link.id, amountPaise: Math.round(Number(link.amount || 0) * 100) },
        deepLink: `/bookings/${targetAppointmentId}`,
        sourceType: "booking_payment_link",
        sourceId: link.id,
        eventKey: `booking-deposit:${link.id}:paid`
      });
    }
    return { paid: true, appointmentId: targetAppointmentId, paymentLinkId: link.id };
  },

  markDepositFailed({ paymentLinkId = "", reason = "", access = {} }) {
    const tenantId = access.tenantId;
    if (!tenantId || !paymentLinkId) throw badRequest("paymentLinkId is required");
    const link = db.prepare("SELECT * FROM booking_payment_links WHERE tenantId = ? AND id = ?").get(tenantId, paymentLinkId);
    if (!link) throw notFound("Payment link not found");
    db.prepare("UPDATE booking_payment_links SET status = 'failed', updatedAt = CURRENT_TIMESTAMP WHERE id = ? AND tenantId = ?").run(paymentLinkId, tenantId);
    if (link.sessionId) {
      onlineBookingWhatsappService.sendPaymentFailedRecovery(tenantId, link.sessionId, link.paymentLink, { appointmentId: link.appointmentId, reason });
    }
    const appointment = link.appointmentId ? repositories.appointments.getById(link.appointmentId, { tenantId }) : null;
    if (appointment?.clientId) {
      customerNotificationService.safeCreate({
        tenantId,
        branchId: appointment.branchId || "",
        customerId: appointment.clientId,
        type: "deposit_failed",
        category: "payments",
        title: "Deposit payment failed",
        body: "We could not confirm your booking deposit. Please retry the payment.",
        data: { appointmentId: appointment.id, paymentLinkId: link.id },
        deepLink: `/bookings/${appointment.id}`,
        sourceType: "booking_payment_link",
        sourceId: link.id,
        eventKey: `booking-deposit:${link.id}:failed:${link.updatedAt || new Date().toISOString()}`
      });
    }
    insertAudit({
      tenantId,
      action: "deposit.failed",
      entityType: "booking_payment_link",
      entityId: paymentLinkId,
      severity: "warning",
      details: { reason }
    });
    return { failed: true, paymentLinkId };
  },

  markDepositForfeited({ appointmentId = "", reason = "", access = {} }) {
    const tenantId = access.tenantId;
    if (!tenantId || !appointmentId) throw badRequest("appointmentId is required");
    const appointment = repositories.appointments.getById(appointmentId, { tenantId });
    if (!appointment) throw notFound("Appointment not found");
    repositories.appointments.update(appointmentId, { depositStatus: "forfeited" }, { tenantId });
    insertAudit({
      tenantId,
      branchId: appointment.branchId,
      userId: access.userId || "system",
      action: "deposit.forfeited",
      entityType: "appointment",
      entityId: appointmentId,
      severity: "warning",
      details: { reason }
    });
    return { forfeited: true, appointmentId };
  },

  enqueueDepositLinkMessage({ tenantId, appointmentId, paymentLink, expiresAt }) {
    return jobQueueService.enqueue({
      tenantId,
      jobType: "whatsapp_send",
      priority: 2,
      payload: {
        template: "deposit_link",
        appointmentId,
        paymentLink,
        expiresAt
      }
    });
  }
};
