import { db } from "../db.js";
import { badRequest, conflict } from "../utils/app-error.js";
import { billingService } from "./billing.service.js";
import { balanceSheetConnector } from "./balance-sheet-connector.service.js";
import { balanceSheetService } from "./balance-sheet.service.js";
import { realtimeService } from "./realtime.service.js";
import { customerNotificationService } from "./customer-notification.service.js";

const money = (value) => Math.round((Number(value) || 0) * 100) / 100;

export class PaymentService {
  pay(invoiceId, mode, payload = {}, access = {}) {
    const invoice = billingService.requireInvoice(invoiceId, access);
    const amount = money(payload.amount || invoice.due_amount || invoice.grand_total || 0);
    if (amount <= 0) throw badRequest("Payment amount must be greater than zero");
    if (amount > Number(invoice.due_amount || invoice.grand_total || 0) + 0.01) throw conflict("Payment amount exceeds invoice due amount");
    const updated = billingService.recordPayment(invoiceId, { ...payload, mode, amount }, access);
    try {
      balanceSheetService.enqueueInvoicePaymentEvent({ invoice: updated, amount, mode, access });
      balanceSheetConnector.connectDeferredRevenueForInvoice({ invoice: updated, payments: [{ mode, amount }] }, access);
    } catch {
      billingService.writeEvent({ tenantId: access.tenantId, invoiceId, eventType: "finance.gl_enqueue_failed", actorUserId: access.userId || "", payload: { mode, amount } });
    }
    realtimeService.broadcast("payment:received", { invoiceId, mode, amount }, { tenantId: access.tenantId, branchId: invoice.branch_id });
    if (updated.payment_status === "paid") {
      realtimeService.broadcast("invoice:paid", { invoiceId, invoiceNo: updated.invoice_no }, { tenantId: access.tenantId, branchId: invoice.branch_id });
    }
    const customerId = updated.client_id || updated.clientId || invoice.client_id || invoice.clientId || "";
    if (customerId) {
      const amountPaise = Math.round(amount * 100);
      customerNotificationService.safeCreate({
        tenantId: access.tenantId,
        branchId: updated.branch_id || updated.branchId || invoice.branch_id || invoice.branchId || "",
        customerId,
        type: updated.payment_status === "paid" ? "invoice_paid" : "payment_received",
        category: "payments",
        title: updated.payment_status === "paid" ? "Invoice paid" : "Payment received",
        body: updated.payment_status === "paid" ? "Your invoice has been paid successfully." : "Your payment was received successfully.",
        data: { invoiceId, invoiceNo: updated.invoice_no || "", amountPaise, paymentStatus: updated.payment_status || "" },
        deepLink: "/tabs/wallet",
        sourceType: "invoice",
        sourceId: invoiceId,
        eventKey: `invoice-payment:${invoiceId}:${Number(updated.paid_amount || amount)}:${mode}`
      });
    }
    return updated;
  }

  split(invoiceId, payload = {}, access = {}) {
    if (!Array.isArray(payload.payments) || !payload.payments.length) throw badRequest("payments array is required");
    let result = billingService.requireInvoice(invoiceId, access);
    const total = money(payload.payments.reduce((sum, payment) => sum + Number(payment.amount || 0), 0));
    if (total > Number(result.due_amount || result.grand_total || 0) + 0.01) throw conflict("Split payment total exceeds invoice due amount");
    for (const payment of payload.payments) {
      result = this.pay(invoiceId, payment.mode || payment.payment_mode, payment, access);
    }
    return result;
  }

  markProviderPaymentPaid(paymentId, providerPayload = {}, access = {}) {
    const payment = db.prepare("SELECT * FROM invoice_payments WHERE tenant_id = ? AND id = ?").get(access.tenantId, paymentId);
    if (!payment) throw badRequest("Provider payment row not found");
    if (payment.status === "paid") return billingService.getInvoice(payment.invoice_id, access);
    const invoice = billingService.requireInvoice(payment.invoice_id, access);
    const amount = money(providerPayload.amount || payment.amount || 0);
    if (amount > Number(invoice.due_amount || invoice.grand_total || 0) + 0.01) throw conflict("Provider payment exceeds invoice due amount");
    db.prepare(
      `UPDATE invoice_payments
          SET status = 'paid',
              paid_at = CURRENT_TIMESTAMP,
              provider_payment_id = COALESCE(NULLIF(@providerPaymentId, ''), provider_payment_id),
              provider_order_id = COALESCE(NULLIF(@providerOrderId, ''), provider_order_id),
              reference_no = COALESCE(NULLIF(@referenceNo, ''), reference_no)
        WHERE tenant_id = @tenantId AND id = @paymentId`
    ).run({
      tenantId: access.tenantId,
      paymentId,
      providerPaymentId: providerPayload.providerPaymentId || "",
      providerOrderId: providerPayload.providerOrderId || "",
      referenceNo: providerPayload.referenceNo || providerPayload.eventId || ""
    });
    const paidAmount = money(Number(invoice.paid_amount || 0) + amount);
    const dueAmount = money(Math.max(0, Number(invoice.grand_total || 0) - paidAmount));
    const paymentStatus = dueAmount <= 0.01 ? "paid" : "partially_paid";
    db.prepare(
      `UPDATE invoices
          SET paid_amount = @paidAmount,
              due_amount = @dueAmount,
              payment_status = @paymentStatus,
              status = @status,
              updated_at = CURRENT_TIMESTAMP
        WHERE tenant_id = @tenantId AND id = @invoiceId`
    ).run({
      paidAmount,
      dueAmount,
      paymentStatus,
      status: paymentStatus === "paid" ? "paid" : "pending_payment",
      tenantId: access.tenantId,
      invoiceId: invoice.id
    });
    billingService.writeEvent({
      tenantId: access.tenantId,
      invoiceId: invoice.id,
      eventType: "payment.provider_paid",
      actorUserId: access.userId || "provider-webhook",
      payload: { paymentId, providerPayload, paymentStatus }
    });
    if (paymentStatus === "paid") billingService.lockInvoiceInTransaction(invoice.id, access, "provider_payment_paid");
    const updated = billingService.getInvoice(invoice.id, access);
    try {
      balanceSheetService.enqueueInvoicePaymentEvent({ invoice: updated, amount, mode: payment.payment_mode || "bank", access });
      balanceSheetConnector.connectDeferredRevenueForInvoice({ invoice: updated, payments: [{ mode: payment.payment_mode || "bank", amount }] }, access);
    } catch {
      billingService.writeEvent({ tenantId: access.tenantId, invoiceId: invoice.id, eventType: "finance.gl_enqueue_failed", actorUserId: access.userId || "provider-webhook", payload: { amount, paymentId } });
    }
    const customerId = updated.client_id || updated.clientId || invoice.client_id || invoice.clientId || "";
    if (customerId) {
      customerNotificationService.safeCreate({
        tenantId: access.tenantId,
        branchId: updated.branch_id || updated.branchId || invoice.branch_id || invoice.branchId || "",
        customerId,
        type: paymentStatus === "paid" ? "invoice_paid" : "payment_received",
        category: "payments",
        title: paymentStatus === "paid" ? "Invoice paid" : "Payment received",
        body: paymentStatus === "paid" ? "Your invoice has been paid successfully." : "Your payment was received successfully.",
        data: { invoiceId: invoice.id, invoiceNo: updated.invoice_no || "", paymentId, amountPaise: Math.round(amount * 100), paymentStatus },
        deepLink: "/tabs/wallet",
        sourceType: "invoice_payment",
        sourceId: paymentId,
        eventKey: `provider-payment:${paymentId}:paid`
      });
    }
    return updated;
  }

  status(invoiceId, access = {}) {
    const invoice = billingService.requireInvoice(invoiceId, access);
    const payments = db.prepare("SELECT * FROM invoice_payments WHERE tenant_id = ? AND invoice_id = ? ORDER BY created_at").all(access.tenantId, invoiceId);
    return {
      invoiceId,
      invoiceNo: invoice.invoice_no,
      paymentStatus: invoice.payment_status,
      paidAmount: invoice.paid_amount,
      dueAmount: invoice.due_amount,
      payments
    };
  }

  reversalHook(invoiceId, payload = {}, access = {}) {
    billingService.writeEvent({ tenantId: access.tenantId, invoiceId, eventType: "payment.reversal_hook", actorUserId: access.userId || "", payload });
    return { invoiceId, status: "reversal_hook_recorded" };
  }
}

export const paymentService = new PaymentService();
