import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { dataDir, db } from "../db.js";
import { badRequest, notFound } from "../utils/app-error.js";
import { realtimeService } from "./realtime.service.js";
import { securityService } from "./security.service.js";
import { tenantService } from "./tenant.service.js";

const now = () => new Date().toISOString();
const makeId = (prefix) => `${prefix}_${crypto.randomUUID().slice(0, 10)}`;
const money = (value) => Number(value || 0).toLocaleString("en-IN", { maximumFractionDigits: 2, minimumFractionDigits: 0 });
const MAX_BUSINESS_MEDIA_BYTES = 5 * 1024 * 1024;
const BUSINESS_MEDIA_MIME_EXTENSIONS = new Map([
  ["image/jpeg", ".jpg"],
  ["image/jpg", ".jpg"],
  ["image/png", ".png"],
  ["image/webp", ".webp"],
  ["image/gif", ".gif"],
  ["image/avif", ".avif"],
  ["image/heic", ".heic"],
  ["image/heif", ".heif"],
  ["image/bmp", ".bmp"],
  ["image/tiff", ".tiff"]
]);
const BUSINESS_MEDIA_EXTENSIONS = new Set([...BUSINESS_MEDIA_MIME_EXTENSIONS.values(), ".jpeg"]);

function parseJson(value, fallback) {
  if (Array.isArray(value) || (value && typeof value === "object")) return value;
  try {
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

function json(value) {
  return JSON.stringify(value ?? null);
}

function compactUnique(values = []) {
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))];
}

function emailsFrom(value) {
  if (Array.isArray(value)) return compactUnique(value).filter((item) => item.includes("@"));
  return compactUnique(String(value || "").split(/[\n,;]/)).filter((item) => item.includes("@"));
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

function phonesFrom(value) {
  const source = Array.isArray(value) ? value : String(value || "").split(/[\n,;]/);
  return compactUnique(source.map(normalizeIndianPhone)).filter((item) => /^\+\d{7,15}$/.test(item));
}

function normalizeRecipientAddress(channel, address) {
  return ["sms", "whatsapp"].includes(String(channel || "").toLowerCase())
    ? phonesFrom(address)[0] || String(address || "").trim()
    : String(address || "").trim();
}

function scope(access = {}) {
  return { tenantId: access.tenantId || "tenant_aura" };
}

function profileRowToDto(row, fallback = {}) {
  const target = row || {};
  return {
    id: target.id || "",
    tenantId: target.tenant_id || fallback.tenantId || "",
    branchId: target.branch_id || fallback.branchId || "",
    businessName: target.business_name || fallback.businessName || "",
    logoUrl: target.logo_url || "",
    adminEmail: target.admin_email || fallback.adminEmail || "",
    reportingEmails: parseJson(target.reporting_emails_json, fallback.reportingEmails || []),
    ownerEmails: parseJson(target.owner_emails_json, fallback.ownerEmails || []),
    ownerMobiles: phonesFrom(parseJson(target.owner_mobiles_json, fallback.ownerMobiles || [])),
    clientChannels: parseJson(target.client_channels_json, fallback.clientChannels || ["whatsapp", "sms", "email"]),
    ownerChannels: parseJson(target.owner_channels_json, fallback.ownerChannels || ["email", "sms"]),
    mobileNumber: phonesFrom(target.mobile_number || fallback.mobileNumber || "")[0] || target.mobile_number || fallback.mobileNumber || "",
    telephoneNumber: phonesFrom(target.telephone_number || fallback.telephoneNumber || "")[0] || target.telephone_number || fallback.telephoneNumber || "",
    appointmentNumber: phonesFrom(target.appointment_number || fallback.appointmentNumber || "")[0] || target.appointment_number || fallback.appointmentNumber || "",
    address: target.address || fallback.address || "",
    country: target.country || fallback.country || "India - IN",
    state: target.state || fallback.state || "",
    city: target.city || fallback.city || "",
    postalCode: target.postal_code || fallback.postalCode || "",
    aboutUs: target.about_us || fallback.aboutUs || "",
    socialLinks: parseJson(target.social_links_json, fallback.socialLinks || {}),
    businessHours: parseJson(target.business_hours_json, fallback.businessHours || {}),
    providerMode: target.provider_mode || fallback.providerMode || "queued",
    invoiceClientEnabled: Number(target.invoice_client_enabled ?? fallback.invoiceClientEnabled ?? 1) === 1,
    invoiceOwnerEnabled: Number(target.invoice_owner_enabled ?? fallback.invoiceOwnerEnabled ?? 1) === 1,
    version: Number(target.version || 1),
    createdAt: target.created_at || "",
    updatedAt: target.updated_at || ""
  };
}

function queueRowToDto(row) {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    branchId: row.branch_id,
    invoiceId: row.invoice_id,
    saleId: row.sale_id,
    clientId: row.client_id,
    invoiceNo: row.invoice_no,
    recipientType: row.recipient_type,
    recipientName: row.recipient_name,
    channel: row.channel,
    recipientAddress: normalizeRecipientAddress(row.channel, row.recipient_address),
    messageSubject: row.message_subject,
    messageBody: row.message_body,
    status: row.status,
    providerMode: row.provider_mode,
    requiresManualSend: Number(row.requires_manual_send) === 1,
    attempts: Number(row.attempts || 0),
    providerPayload: parseJson(row.provider_payload_json, {}),
    metadata: parseJson(row.metadata_json, {}),
    queuedAt: row.queued_at,
    sentAt: row.sent_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function invoiceValue(invoice = {}, ...keys) {
  for (const key of keys) {
    const value = invoice[key];
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return "";
}

function itemValue(item = {}, ...keys) {
  return invoiceValue(item, ...keys);
}

function itemTotal(item = {}) {
  const explicit = Number(itemValue(item, "total_amount", "total", "lineTotal", "amount"));
  if (Number.isFinite(explicit) && explicit > 0) return explicit;
  return Number(itemValue(item, "unit_price", "price", "rate")) * Number(itemValue(item, "quantity", "qty") || 1);
}

function itemType(item = {}) {
  const raw = String(itemValue(item, "item_type", "type", "itemType", "kind") || "").toLowerCase();
  if (raw.includes("service")) return "service";
  if (raw.includes("product") || raw.includes("retail")) return "product";
  if (raw.includes("wallet")) return "wallet";
  return raw || "custom";
}

function itemName(item = {}) {
  return String(itemValue(item, "item_name", "name", "title", "label") || "Item");
}

function paymentMode(payment = {}) {
  return String(invoiceValue(payment, "payment_mode", "mode", "paymentMode") || "").toLowerCase();
}

function paymentAmount(payment = {}) {
  return Number(invoiceValue(payment, "amount", "paidAmount") || 0);
}

function bookingAdvanceAdjustedAmount(payments = []) {
  return payments
    .filter((payment) => paymentMode(payment) === "booking_advance")
    .reduce((sum, payment) => sum + paymentAmount(payment), 0);
}

function counterPaymentCollectedAmount(invoice = {}, payments = []) {
  const paid = Number(invoiceValue(invoice, "paid", "paid_amount") || 0);
  return Math.max(0, paid - bookingAdvanceAdjustedAmount(payments));
}

function remainingCounterPaymentAmount(invoice = {}) {
  return Math.max(0, Number(invoiceValue(invoice, "balance", "due_amount") || 0));
}

function invoicePdfFileName(invoice = {}) {
  const raw = String(invoiceValue(invoice, "invoice_no", "invoiceNumber", "id") || "invoice").replace(/[^\w.-]+/g, "-");
  return `${raw}.pdf`;
}

function safePathSegment(value, fallback) {
  const segment = String(value || fallback || "").replace(/[^a-zA-Z0-9_-]+/g, "_").slice(0, 80);
  return segment || fallback;
}

function mediaExtension(payload = {}) {
  const mimeType = String(payload.mimeType || "").toLowerCase();
  const nameMatch = String(payload.fileName || "").toLowerCase().match(/\.(jpe?g|png|webp|gif|avif|hei[cf]|bmp|tiff?)$/);
  const rawExtension = nameMatch?.[1] || "";
  const normalizedExtension = rawExtension === "jpeg" ? "jpg" : rawExtension === "tif" ? "tiff" : rawExtension;
  const extension = normalizedExtension ? `.${normalizedExtension}` : "";
  if (extension && BUSINESS_MEDIA_EXTENSIONS.has(extension)) return extension;
  return BUSINESS_MEDIA_MIME_EXTENSIONS.get(mimeType) || "";
}

function imageSignatureMatches(buffer, mimeType) {
  if (mimeType === "image/jpeg" || mimeType === "image/jpg") return buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  if (mimeType === "image/png") return buffer.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  if (mimeType === "image/gif") return buffer.subarray(0, 3).toString("ascii") === "GIF";
  if (mimeType === "image/webp") return buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP";
  if (mimeType === "image/bmp") return buffer.subarray(0, 2).toString("ascii") === "BM";
  if (mimeType === "image/tiff") {
    const head = buffer.subarray(0, 4);
    return head.equals(Buffer.from([0x49, 0x49, 0x2a, 0x00])) || head.equals(Buffer.from([0x4d, 0x4d, 0x00, 0x2a]));
  }
  if (["image/avif", "image/heic", "image/heif"].includes(mimeType)) {
    const brand = buffer.subarray(4, 16).toString("ascii");
    return brand.includes("ftyp") && /avif|heic|heif|mif1|msf1/.test(brand);
  }
  return false;
}

export class InvoiceNotificationService {
  defaultProfile(access = {}, branchId = "") {
    const tenantId = access.tenantId || "tenant_aura";
    const tenant = db.prepare("SELECT * FROM tenants WHERE id = ?").get(tenantId) || {};
    const branch = branchId ? db.prepare("SELECT * FROM branches WHERE tenantId = ? AND id = ?").get(tenantId, branchId) || {} : {};
    const users = db.prepare("SELECT * FROM tenant_users WHERE tenantId = ? AND status != 'inactive'").all(tenantId);
    const ownerUsers = users.filter((user) => ["owner", "admin"].includes(String(user.role || "").toLowerCase()));
    return {
      tenantId,
      branchId,
      businessName: tenant.name || tenant.salonName || branch.name || "AuraShine Salon",
      adminEmail: tenant.ownerEmail || ownerUsers[0]?.email || "",
      reportingEmails: [],
      ownerEmails: compactUnique([tenant.ownerEmail, ...ownerUsers.map((user) => user.email)]),
      ownerMobiles: phonesFrom(ownerUsers.map((user) => user.phone || user.mobile || user.mobileNumber)),
      clientChannels: ["whatsapp", "sms", "email"],
      ownerChannels: ["email", "sms"],
      mobileNumber: phonesFrom(branch.phone || "")[0] || "",
      telephoneNumber: "",
      appointmentNumber: phonesFrom(branch.phone || "")[0] || "",
      address: branch.address || "",
      country: "India - IN",
      state: branch.state || "",
      city: branch.city || "",
      postalCode: branch.pincode || "",
      aboutUs: "",
      socialLinks: {},
      businessHours: {},
      providerMode: "queued",
      invoiceClientEnabled: true,
      invoiceOwnerEnabled: true
    };
  }

  getProfile(query = {}, access = {}) {
    const branchId = query.branchId || access.branchId || "";
    if (branchId) tenantService.assertBranchAccess(access, branchId);
    const fallback = this.defaultProfile(access, branchId);
    const row = db
      .prepare("SELECT * FROM business_notification_profiles WHERE tenant_id = ? AND branch_id = ?")
      .get(access.tenantId, branchId);
    return profileRowToDto(row, fallback);
  }

  saveProfile(payload = {}, access = {}) {
    const tenantId = access.tenantId;
    const branchId = payload.branchId || access.branchId || "";
    if (branchId) tenantService.assertBranchAccess(access, branchId);
    const current = db
      .prepare("SELECT * FROM business_notification_profiles WHERE tenant_id = ? AND branch_id = ?")
      .get(tenantId, branchId);
    const next = {
      id: current?.id || makeId("bnp"),
      tenant_id: tenantId,
      branch_id: branchId,
      business_name: String(payload.businessName || ""),
      logo_url: String(payload.logoUrl || ""),
      admin_email: emailsFrom(payload.adminEmail)[0] || "",
      reporting_emails_json: json(emailsFrom(payload.reportingEmails)),
      owner_emails_json: json(emailsFrom(payload.ownerEmails)),
      owner_mobiles_json: json(phonesFrom(payload.ownerMobiles)),
      client_channels_json: json(compactUnique(payload.clientChannels || ["whatsapp", "sms", "email"])),
      owner_channels_json: json(compactUnique(payload.ownerChannels || ["email", "sms"])),
      mobile_number: phonesFrom(payload.mobileNumber)[0] || "",
      telephone_number: phonesFrom(payload.telephoneNumber)[0] || "",
      appointment_number: phonesFrom(payload.appointmentNumber)[0] || "",
      address: String(payload.address || ""),
      country: String(payload.country || "India - IN"),
      state: String(payload.state || ""),
      city: String(payload.city || ""),
      postal_code: String(payload.postalCode || ""),
      about_us: String(payload.aboutUs || ""),
      social_links_json: json(payload.socialLinks || {}),
      business_hours_json: json(payload.businessHours || {}),
      provider_mode: payload.providerMode || "queued",
      invoice_client_enabled: payload.invoiceClientEnabled === false ? 0 : 1,
      invoice_owner_enabled: payload.invoiceOwnerEnabled === false ? 0 : 1,
      updated_at: now()
    };
    if (current) {
      db.prepare(`
        UPDATE business_notification_profiles
           SET business_name = @business_name,
               logo_url = @logo_url,
               admin_email = @admin_email,
               reporting_emails_json = @reporting_emails_json,
               owner_emails_json = @owner_emails_json,
               owner_mobiles_json = @owner_mobiles_json,
               client_channels_json = @client_channels_json,
               owner_channels_json = @owner_channels_json,
               mobile_number = @mobile_number,
               telephone_number = @telephone_number,
               appointment_number = @appointment_number,
               address = @address,
               country = @country,
               state = @state,
               city = @city,
               postal_code = @postal_code,
               about_us = @about_us,
               social_links_json = @social_links_json,
               business_hours_json = @business_hours_json,
               provider_mode = @provider_mode,
               invoice_client_enabled = @invoice_client_enabled,
               invoice_owner_enabled = @invoice_owner_enabled,
               version = version + 1,
               updated_at = @updated_at
         WHERE tenant_id = @tenant_id AND branch_id = @branch_id
      `).run(next);
    } else {
      db.prepare(`
        INSERT INTO business_notification_profiles (
          id, tenant_id, branch_id, business_name, logo_url, admin_email, reporting_emails_json,
          owner_emails_json, owner_mobiles_json, client_channels_json, owner_channels_json,
          mobile_number, telephone_number, appointment_number, address, country, state, city,
          postal_code, about_us, social_links_json, business_hours_json, provider_mode,
          invoice_client_enabled, invoice_owner_enabled, updated_at
        ) VALUES (
          @id, @tenant_id, @branch_id, @business_name, @logo_url, @admin_email, @reporting_emails_json,
          @owner_emails_json, @owner_mobiles_json, @client_channels_json, @owner_channels_json,
          @mobile_number, @telephone_number, @appointment_number, @address, @country, @state, @city,
          @postal_code, @about_us, @social_links_json, @business_hours_json, @provider_mode,
          @invoice_client_enabled, @invoice_owner_enabled, @updated_at
        )
      `).run(next);
    }
    securityService.audit({ action: "invoice.notification_profile.saved", targetType: "business_notification_profile", targetId: next.id, details: { branchId } }, access);
    realtimeService.broadcast("invoice:notification_profile_updated", { branchId }, { tenantId, branchId });
    return this.getProfile({ branchId }, access);
  }

  uploadProfileMedia(payload = {}, access = {}, options = {}) {
    const tenantId = access.tenantId;
    const branchId = payload.branchId || access.branchId || "";
    if (branchId) tenantService.assertBranchAccess(access, branchId);

    const kind = payload.kind === "gallery" ? "gallery" : "cover";
    const mimeType = String(payload.mimeType || "").toLowerCase();
    const extension = mediaExtension(payload);
    if (!mimeType.startsWith("image/") || !extension) {
      throw badRequest("Only JPG, PNG and common photo files are allowed");
    }

    const rawData = String(payload.dataUrl || payload.content || "");
    const base64 = (rawData.includes(",") ? rawData.split(",").pop() : rawData).replace(/\s+/g, "");
    if (!base64 || !/^[a-zA-Z0-9+/=]+$/.test(base64)) {
      throw badRequest("Image file is required");
    }

    const buffer = Buffer.from(base64, "base64");
    if (!buffer.length || buffer.length > MAX_BUSINESS_MEDIA_BYTES) {
      throw badRequest("Image size must be 5 MB or less");
    }
    if (!imageSignatureMatches(buffer, mimeType)) {
      throw badRequest("Uploaded file is not a valid photo");
    }

    const tenantSegment = safePathSegment(tenantId, "tenant");
    const branchSegment = safePathSegment(branchId || "all", "all");
    const uploadDir = join(dataDir, "uploads", "business-media", tenantSegment, branchSegment);
    const fileName = `${kind}_${Date.now()}_${makeId("img")}${extension}`;
    mkdirSync(uploadDir, { recursive: true });
    writeFileSync(join(uploadDir, fileName), buffer, { flag: "wx" });

    const path = `/uploads/business-media/${tenantSegment}/${branchSegment}/${fileName}`;
    const publicBaseUrl = String(options.publicBaseUrl || "").replace(/\/+$/, "");
    const url = publicBaseUrl ? `${publicBaseUrl}${path}` : path;
    securityService.audit({
      action: "invoice.notification_profile.media_uploaded",
      targetType: "business_notification_profile",
      targetId: branchId || tenantId,
      details: { branchId, kind, fileName: String(payload.fileName || ""), mimeType, sizeBytes: buffer.length, url }
    }, access);
    return { url, path, kind, mimeType, sizeBytes: buffer.length, branchId };
  }

  listQueue(query = {}, access = {}) {
    const branchId = query.branchId || "";
    if (branchId) tenantService.assertBranchAccess(access, branchId);
    const limit = Math.min(Number(query.limit || 200), 500);
    const rows = db.prepare(`
      SELECT * FROM invoice_notification_queue
       WHERE tenant_id = @tenantId
         AND (@branchId = '' OR branch_id = @branchId)
         AND (@status = '' OR status = @status)
         AND (@invoiceId = '' OR invoice_id = @invoiceId)
       ORDER BY created_at DESC
       LIMIT @limit
    `).all({
      tenantId: access.tenantId,
      branchId,
      status: query.status || "",
      invoiceId: query.invoiceId || "",
      limit
    });
    return rows.map(queueRowToDto);
  }

  queueExistingInvoice(invoiceId, access = {}) {
    const invoice = this.findInvoice(invoiceId, access);
    return this.queueForInvoice(invoice, access);
  }

  queueInvoicePdfWhatsapp(invoiceId, payload = {}, access = {}) {
    const invoice = this.findInvoice(invoiceId, access);
    const saleId = invoiceValue(invoice, "saleId", "sale_id");
    const sale = saleId ? this.findSale(saleId, access) : null;
    const clientId = invoiceValue(invoice, "clientId", "customer_id", "customerId") || invoiceValue(sale || {}, "clientId", "customer_id");
    const client = clientId ? this.findClient(clientId, access) : null;
    const branchId = invoiceValue(sale || {}, "branchId", "branch_id") || invoiceValue(invoice, "branchId", "branch_id") || access.branchId || "";
    if (branchId) tenantService.assertBranchAccess(access, branchId);

    const phone = phonesFrom(payload.phone || client?.phone || client?.mobile || invoiceValue(invoice, "clientPhone", "customer_phone"))[0];
    if (!phone) throw badRequest("Client WhatsApp number is required before sending invoice PDF");

    const profile = this.getProfile({ branchId }, access);
    const items = this.invoiceItems(invoice, sale, access);
    const payments = this.invoicePayments(invoice, access);
    const ctx = this.notificationContext({ invoice, sale, client, payments, invoiceDocument: null, profile, access, branchId, clientId });
    const itemSummary = this.invoicePdfItemSummary(items);
    const walletPaid = payments.filter((payment) => paymentMode(payment).includes("wallet")).reduce((sum, payment) => sum + paymentAmount(payment), 0);
    const pdfUrl = `/api/billing/invoices/${invoice.id}/pdf`;
    const documentPayload = {
      type: "document",
      format: "pdf",
      mimeType: "application/pdf",
      fileName: invoicePdfFileName(invoice),
      url: pdfUrl,
      htmlUrl: pdfUrl,
      renderMode: "pdf-ready-html"
    };
    const body = [
      `Hi ${ctx.clientName},`,
      `Aapka ${profile.businessName || "AuraShine Salon"} invoice ${ctx.invoiceNo} PDF attached hai.`,
      itemSummary.services ? `Services: ${itemSummary.services}` : "",
      itemSummary.products ? `Products: ${itemSummary.products}` : "",
      `Total: INR ${money(ctx.total)}`,
      `Paid: INR ${money(ctx.paid)}`,
      ctx.due > 0 ? `Unpaid/Due: INR ${money(ctx.due)}` : "Payment status: Paid",
      ctx.settlementLine,
      walletPaid > 0 ? `Wallet used/paid: INR ${money(walletPaid)}` : "",
      profile.appointmentNumber || profile.mobileNumber ? `Salon contact: ${profile.appointmentNumber || profile.mobileNumber}` : "",
      "Thank you for visiting."
    ].filter(Boolean).join("\n");

    const row = this.upsertQueueRow({
      id: makeId("inq"),
      tenant_id: access.tenantId,
      branch_id: branchId || "",
      invoice_id: invoice.id,
      sale_id: saleId || "",
      client_id: clientId || "",
      invoice_no: ctx.invoiceNo,
      recipient_type: "client",
      recipient_name: ctx.clientName || "",
      channel: "whatsapp",
      recipient_address: phone,
      message_subject: `${profile.businessName || "AuraShine Salon"} invoice ${ctx.invoiceNo}`,
      message_body: body,
      status: "queued",
      provider_mode: profile.providerMode || "queued",
      requires_manual_send: 1,
      provider_payload_json: json({
        providerMode: profile.providerMode || "queued",
        source: "invoice-pdf-whatsapp",
        document: documentPayload
      }),
      metadata_json: json({
        total: ctx.total,
        paid: ctx.paid,
        due: ctx.due,
        walletPaid,
        businessName: profile.businessName,
        itemSummary,
        document: documentPayload,
        requestedBy: access.userId || access.role || "system"
      }),
      updated_at: now()
    }, access);

    securityService.audit({
      action: "invoice.pdf_whatsapp.queued",
      targetType: "invoice",
      targetId: invoice.id,
      details: { branchId, invoiceNo: ctx.invoiceNo, due: ctx.due, walletPaid, queueId: row.id }
    }, access);
    realtimeService.broadcast("invoice:pdf_whatsapp_queued", { invoiceId: invoice.id, queueId: row.id }, { tenantId: access.tenantId, branchId });
    return {
      invoiceId: invoice.id,
      invoiceNo: ctx.invoiceNo,
      queued: true,
      channel: "whatsapp",
      recipientAddress: row.recipientAddress,
      row,
      document: documentPayload,
      due: ctx.due,
      walletPaid
    };
  }

  queueForInvoice(invoice = {}, access = {}) {
    if (!invoice?.id) throw badRequest("invoice is required");
    const saleId = invoiceValue(invoice, "saleId", "sale_id");
    const sale = saleId ? this.findSale(saleId, access) : null;
    const clientId = invoiceValue(invoice, "clientId", "customer_id");
    const client = clientId ? this.findClient(clientId, access) : null;
    return this.queueForPosInvoice({ invoice, sale, client }, access);
  }

  queueForPosInvoice({ invoice = {}, sale = {}, client = {}, payments = [], invoiceDocument = null } = {}, access = {}) {
    if (!invoice?.id) throw badRequest("invoice is required");
    const tenantId = access.tenantId;
    const branchId = invoiceValue(sale, "branchId", "branch_id") || invoiceValue(invoice, "branchId", "branch_id") || access.branchId || "";
    if (branchId) tenantService.assertBranchAccess(access, branchId);
    const clientId = invoiceValue(client, "id") || invoiceValue(invoice, "clientId", "customer_id") || "";
    const profile = this.getProfile({ branchId }, access);
    const ctx = this.notificationContext({ invoice, sale, client, payments, invoiceDocument, profile, access, branchId, clientId });
    const messages = [
      ...this.clientMessages(ctx),
      ...this.ownerMessages(ctx)
    ];
    const created = db.transaction((items) => items.map((item) => this.upsertQueueRow(item, access)))(messages);
    if (created.length) {
      securityService.audit({
        action: "invoice.notifications.queued",
        targetType: "invoice",
        targetId: invoice.id,
        details: { branchId, count: created.length, channels: [...new Set(created.map((item) => item.channel))] }
      }, access);
      realtimeService.broadcast("invoice:notification_queued", { invoiceId: invoice.id, count: created.length }, { tenantId, branchId });
    }
    return {
      invoiceId: invoice.id,
      invoiceNo: ctx.invoiceNo,
      queued: created.length,
      providerMode: profile.providerMode,
      rows: created
    };
  }

  markSent(id, payload = {}, access = {}) {
    const row = this.queueRecord(id, access);
    db.prepare(`
      UPDATE invoice_notification_queue
         SET status = 'sent', sent_at = @sentAt, attempts = attempts + 1, provider_payload_json = @payload, updated_at = @sentAt
       WHERE id = @id AND tenant_id = @tenantId
    `).run({ id, tenantId: access.tenantId, sentAt: now(), payload: json(payload.providerPayload || payload) });
    this.writeDeliveryLog(row, "sent", payload, access);
    realtimeService.broadcast("invoice:notification_sent", { id, invoiceId: row.invoice_id, channel: row.channel }, { tenantId: access.tenantId, branchId: row.branch_id });
    return queueRowToDto(this.queueRecord(id, access));
  }

  markFailed(id, payload = {}, access = {}) {
    const row = this.queueRecord(id, access);
    db.prepare(`
      UPDATE invoice_notification_queue
         SET status = 'failed', attempts = attempts + 1, provider_payload_json = @payload, updated_at = @updatedAt
       WHERE id = @id AND tenant_id = @tenantId
    `).run({ id, tenantId: access.tenantId, updatedAt: now(), payload: json(payload.providerPayload || payload) });
    this.writeDeliveryLog(row, "failed", payload, access);
    realtimeService.broadcast("invoice:notification_failed", { id, invoiceId: row.invoice_id, channel: row.channel }, { tenantId: access.tenantId, branchId: row.branch_id });
    return queueRowToDto(this.queueRecord(id, access));
  }

  notificationContext({ invoice, sale, client, payments, invoiceDocument, profile, access, branchId, clientId }) {
    const invoiceNo = invoiceValue(invoice, "invoiceNumber", "invoice_no") || invoice.id;
    const total = Number(invoiceValue(invoice, "total", "grand_total") || 0);
    const paid = Number(invoiceValue(invoice, "paid", "paid_amount") || 0);
    const due = Number(invoiceValue(invoice, "balance", "due_amount") || Math.max(0, total - paid));
    const clientName = client?.name || invoiceValue(invoice, "clientName", "customer_name") || "Walk-in client";
    const clientPhone = phonesFrom(client?.phone || client?.mobile || invoiceValue(invoice, "clientPhone", "customer_phone"))[0] || "";
    const businessName = profile.businessName || "AuraShine Salon";
    const subject = `${businessName} invoice ${invoiceNo}`;
    const advanceAdjusted = bookingAdvanceAdjustedAmount(payments || []);
    const counterPaid = counterPaymentCollectedAmount(invoice, payments || []);
    const counterDue = remainingCounterPaymentAmount(invoice);
    const settlementLine = `Advance adjusted: INR ${money(advanceAdjusted)} | Counter paid: INR ${money(counterPaid)} | Counter due: INR ${money(counterDue)}`;
    const clientBody = [
      `Hi ${clientName},`,
      `Your ${businessName} invoice ${invoiceNo} is ready.`,
      `Total: INR ${money(total)}`,
      `Paid: INR ${money(paid)}`,
      `Due: INR ${money(due)}`,
      settlementLine,
      profile.appointmentNumber || profile.mobileNumber ? `Salon contact: ${profile.appointmentNumber || profile.mobileNumber}` : "",
      "Thank you for visiting."
    ].filter(Boolean).join("\n");
    const ownerBody = [
      `Invoice closed: ${invoiceNo}`,
      `Client: ${clientName}${clientPhone ? ` (${clientPhone})` : ""}`,
      `Total: INR ${money(total)} | Paid: INR ${money(paid)} | Due: INR ${money(due)}`,
      settlementLine,
      `Branch: ${branchId || "All branches"}`,
      `Closed by: ${access.userId || access.role || "system"}`,
      invoiceDocument?.id ? `Invoice document: ${invoiceDocument.id}` : ""
    ].filter(Boolean).join("\n");
    return { invoice, sale, client, payments, invoiceDocument, profile, access, branchId, clientId, invoiceNo, total, paid, due, clientName, subject, clientBody, ownerBody, settlementLine, advanceAdjusted, counterPaid, counterDue };
  }

  clientMessages(ctx) {
    if (!ctx.profile.invoiceClientEnabled) return [];
    const channels = new Set(ctx.profile.clientChannels || []);
    const phone = phonesFrom(ctx.client?.phone || ctx.client?.mobile || "");
    const email = emailsFrom(ctx.client?.email || "");
    return [
      ...(["whatsapp", "sms"].flatMap((channel) => channels.has(channel) ? phone.map((address) => this.queuePayload(ctx, "client", channel, address, ctx.clientName, ctx.clientBody)) : [])),
      ...(channels.has("email") ? email.map((address) => this.queuePayload(ctx, "client", "email", address, ctx.clientName, ctx.clientBody)) : [])
    ];
  }

  ownerMessages(ctx) {
    if (!ctx.profile.invoiceOwnerEnabled) return [];
    const channels = new Set(ctx.profile.ownerChannels || []);
    const tenant = db.prepare("SELECT * FROM tenants WHERE id = ?").get(ctx.access.tenantId) || {};
    const users = db.prepare("SELECT * FROM tenant_users WHERE tenantId = ? AND status != 'inactive'").all(ctx.access.tenantId);
    const ownerUsers = users.filter((user) => ["owner", "admin"].includes(String(user.role || "").toLowerCase()));
    const emails = compactUnique([
      ...emailsFrom(ctx.profile.adminEmail),
      ...emailsFrom(ctx.profile.reportingEmails),
      ...emailsFrom(ctx.profile.ownerEmails),
      ...emailsFrom(tenant.ownerEmail),
      ...ownerUsers.map((user) => user.email)
    ]);
    const phones = compactUnique([
      ...phonesFrom(ctx.profile.ownerMobiles),
      ...phonesFrom(ctx.profile.mobileNumber),
      ...phonesFrom(ctx.profile.telephoneNumber)
    ]);
    return [
      ...(channels.has("email") ? emails.map((address) => this.queuePayload(ctx, "owner", "email", address, "Owner", ctx.ownerBody)) : []),
      ...(["sms", "whatsapp"].flatMap((channel) => channels.has(channel) ? phones.map((address) => this.queuePayload(ctx, "owner", channel, address, "Owner", ctx.ownerBody)) : []))
    ];
  }

  queuePayload(ctx, recipientType, channel, recipientAddress, recipientName, body) {
    return {
      id: makeId("inq"),
      tenant_id: ctx.access.tenantId,
      branch_id: ctx.branchId || "",
      invoice_id: ctx.invoice.id,
      sale_id: invoiceValue(ctx.sale, "id") || invoiceValue(ctx.invoice, "saleId", "sale_id") || "",
      client_id: ctx.clientId || "",
      invoice_no: ctx.invoiceNo,
      recipient_type: recipientType,
      recipient_name: recipientName || "",
      channel,
      recipient_address: normalizeRecipientAddress(channel, recipientAddress),
      message_subject: ctx.subject,
      message_body: body,
      status: "queued",
      provider_mode: ctx.profile.providerMode || "queued",
      requires_manual_send: 1,
      provider_payload_json: json({ providerMode: ctx.profile.providerMode || "queued", source: "invoice-close" }),
      metadata_json: json({ total: ctx.total, paid: ctx.paid, due: ctx.due, businessName: ctx.profile.businessName }),
      updated_at: now()
    };
  }

  invoiceItems(invoice = {}, sale = {}) {
    const enterpriseItems = db.prepare("SELECT * FROM invoice_items WHERE tenant_id = ? AND invoice_id = ? ORDER BY created_at, id").all(invoice.tenant_id || invoice.tenantId || "", invoice.id);
    if (enterpriseItems.length) return enterpriseItems;
    return parseJson(invoice.lineItems || sale?.items, []);
  }

  invoicePayments(invoice = {}, access = {}) {
    const tenantId = access.tenantId;
    const enterprisePayments = db.prepare("SELECT * FROM invoice_payments WHERE tenant_id = ? AND invoice_id = ? ORDER BY created_at, id").all(tenantId, invoice.id);
    if (enterprisePayments.length) return enterprisePayments;
    try {
      return db.prepare("SELECT * FROM payments WHERE tenantId = ? AND invoiceId = ? ORDER BY createdAt, id").all(tenantId, invoice.id);
    } catch {
      return [];
    }
  }

  invoicePdfItemSummary(items = []) {
    const grouped = items.reduce((summary, item) => {
      const type = itemType(item);
      const bucket = type === "product" ? "products" : type === "service" ? "services" : "other";
      summary[bucket].push(`${itemName(item)} x${Number(itemValue(item, "quantity", "qty") || 1)} INR ${money(itemTotal(item))}`);
      return summary;
    }, { services: [], products: [], other: [] });
    return {
      services: grouped.services.slice(0, 4).join(", "),
      products: grouped.products.slice(0, 4).join(", "),
      other: grouped.other.slice(0, 4).join(", "),
      serviceCount: grouped.services.length,
      productCount: grouped.products.length,
      otherCount: grouped.other.length
    };
  }

  upsertQueueRow(payload, access) {
    db.prepare(`
      INSERT INTO invoice_notification_queue (
        id, tenant_id, branch_id, invoice_id, sale_id, client_id, invoice_no,
        recipient_type, recipient_name, channel, recipient_address, message_subject,
        message_body, status, provider_mode, requires_manual_send, provider_payload_json,
        metadata_json, updated_at
      ) VALUES (
        @id, @tenant_id, @branch_id, @invoice_id, @sale_id, @client_id, @invoice_no,
        @recipient_type, @recipient_name, @channel, @recipient_address, @message_subject,
        @message_body, @status, @provider_mode, @requires_manual_send, @provider_payload_json,
        @metadata_json, @updated_at
      )
      ON CONFLICT(tenant_id, invoice_id, recipient_type, channel, recipient_address)
      DO UPDATE SET
        branch_id = excluded.branch_id,
        sale_id = excluded.sale_id,
        client_id = excluded.client_id,
        invoice_no = excluded.invoice_no,
        recipient_name = excluded.recipient_name,
        message_subject = excluded.message_subject,
        message_body = excluded.message_body,
        provider_mode = excluded.provider_mode,
        provider_payload_json = excluded.provider_payload_json,
        metadata_json = excluded.metadata_json,
        status = CASE WHEN invoice_notification_queue.status = 'sent' THEN invoice_notification_queue.status ELSE 'queued' END,
        updated_at = excluded.updated_at
    `).run(payload);
    return queueRowToDto(db.prepare(`
      SELECT * FROM invoice_notification_queue
       WHERE tenant_id = ? AND invoice_id = ? AND recipient_type = ? AND channel = ? AND recipient_address = ?
    `).get(access.tenantId, payload.invoice_id, payload.recipient_type, payload.channel, payload.recipient_address));
  }

  writeDeliveryLog(row, status, payload, access) {
    db.prepare(`
      INSERT INTO invoice_notification_delivery_logs (
        id, tenant_id, branch_id, queue_id, invoice_id, channel, recipient_address, status, provider, provider_response_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      makeId("inl"),
      access.tenantId,
      row.branch_id,
      row.id,
      row.invoice_id,
      row.channel,
      normalizeRecipientAddress(row.channel, row.recipient_address),
      status,
      payload.provider || "",
      json(payload)
    );
  }

  findInvoice(id, access) {
    const row = db.prepare("SELECT * FROM invoices WHERE id = ? AND (tenantId = ? OR tenant_id = ?)").get(id, access.tenantId, access.tenantId);
    if (!row) throw notFound("Invoice not found");
    const branchId = invoiceValue(row, "branchId", "branch_id");
    if (branchId) tenantService.assertBranchAccess(access, branchId);
    return row;
  }

  findSale(id, access) {
    return db.prepare("SELECT * FROM sales WHERE id = ? AND tenantId = ?").get(id, access.tenantId) || null;
  }

  findClient(id, access) {
    return db.prepare("SELECT * FROM clients WHERE id = ? AND tenantId = ?").get(id, access.tenantId) || null;
  }

  queueRecord(id, access) {
    const row = db.prepare("SELECT * FROM invoice_notification_queue WHERE id = ? AND tenant_id = ?").get(id, access.tenantId);
    if (!row) throw notFound("Notification queue item not found");
    if (row.branch_id) tenantService.assertBranchAccess(access, row.branch_id);
    return {
      ...row,
      recipient_address: normalizeRecipientAddress(row.channel, row.recipient_address)
    };
  }
}

export const invoiceNotificationService = new InvoiceNotificationService();
