import { db, applyInventoryDelta, deductServiceUsage, updateInvoiceStatus } from "../db.js";
import { repositories } from "../repositories/repository-registry.js";
import { badRequest, conflict, notFound } from "../utils/app-error.js";
import { balanceSheetConnector } from "./balance-sheet-connector.service.js";
import { inventoryEnterpriseService } from "./inventory-enterprise.service.js";
import { invoiceNotificationService } from "./invoice-notification.service.js";
import { membershipEnterpriseService } from "./membership-enterprise.service.js";
import { reputationService } from "./reputation/reputation.service.js";
import { securityService } from "./security.service.js";
import { staffOsService } from "./staff-os.service.js";
import { tenantService } from "./tenant.service.js";
import { istToday } from "../utils/finance-time.js";

const now = () => new Date().toISOString();
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const makeId = (prefix) => `${prefix}_${crypto.randomUUID().slice(0, 10)}`;
const money = (value) => Math.round((Number(value) || 0) * 100) / 100;
const dayKey = (value = "") => String(value || "").slice(0, 10);
const appointmentCheckoutLocks = new Set();

function billingStamp(payload = {}) {
  const explicitStamp = String(payload.billingTimestamp || payload.createdAt || "").trim();
  if (explicitStamp && !Number.isNaN(Date.parse(explicitStamp))) {
    return new Date(explicitStamp).toISOString();
  }
  const selectedDate = String(payload.billingDate || payload.invoiceDate || "").trim();
  if (selectedDate) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(selectedDate)) throw badRequest("billingDate must be YYYY-MM-DD");
    if (selectedDate > istToday()) throw badRequest("billingDate cannot be in the future");
    return selectedDate === istToday() ? now() : dateWithCurrentIstTime(selectedDate);
  }
  return now();
}

function dateWithCurrentIstTime(dateKey) {
  const istNow = new Date(Date.now() + IST_OFFSET_MS);
  const hours = String(istNow.getUTCHours()).padStart(2, "0");
  const minutes = String(istNow.getUTCMinutes()).padStart(2, "0");
  const seconds = String(istNow.getUTCSeconds()).padStart(2, "0");
  const millis = String(istNow.getUTCMilliseconds()).padStart(3, "0");
  return new Date(`${dateKey}T${hours}:${minutes}:${seconds}.${millis}+05:30`).toISOString();
}

function latestStamp(current = "", candidate = "") {
  const currentMs = Date.parse(current || "");
  const candidateMs = Date.parse(candidate || "");
  if (Number.isNaN(candidateMs)) return current || candidate || "";
  if (Number.isNaN(currentMs)) return candidate;
  return candidateMs > currentMs ? candidate : current;
}

function scope(access, branchId = "") {
  const scoped = tenantService.accessScope(access || {}, "");
  if (branchId) scoped.branchId = branchId;
  return scoped;
}

function requireRecord(repo, id, label, access) {
  const row = repo.getById(id, scope(access));
  if (!row) throw notFound(`${label} not found`);
  if (row.branchId) tenantService.assertBranchAccess(access, row.branchId);
  return row;
}

function dateRange(query = {}) {
  return {
    from: dayKey(query.from || query.dateFrom || query.startDate || ""),
    to: dayKey(query.to || query.dateTo || query.endDate || "")
  };
}

function dateInRange(row = {}, range = {}, fields = ["createdAt", "updatedAt"]) {
  const key = fields.map((field) => dayKey(row[field])).find(Boolean) || "";
  if (!key) return true;
  if (range.from && key < range.from) return false;
  if (range.to && key > range.to) return false;
  return true;
}

function normalizeOperationalStaff(row = {}) {
  if (!row) return null;
  const incentive = row.employeeDetails?.incentive || {};
  const fixedPercent = Number(incentive.fixedIncentivePercent || incentive.fixed_incentive_percent || 0);
  const fixedAmount = Number(incentive.fixedIncentiveAmount || incentive.fixed_incentive_amount || 0);
  const fullName = row.fullName || row.name || [row.firstName, row.lastName].filter(Boolean).join(" ") || row.shortName || row.id || "Staff";
  const role = row.role || row.designation || row.staffCategoryName || row.department || "Staff";
  return {
    ...row,
    id: row.id,
    name: fullName,
    fullName,
    role,
    branchId: row.branchId || row.branch_id || "",
    commissionRule: row.commissionRule || {
      servicePercent: fixedPercent,
      retailPercent: fixedPercent,
      productPercent: fixedPercent,
      membershipPercent: fixedPercent,
      packagePercent: fixedPercent,
      giftCardPercent: 0,
      customPercent: fixedPercent,
      fixedPerLine: fixedAmount
    }
  };
}

function resolveOperationalStaff(staffId, access, options = {}) {
  if (!staffId) {
    if (options.required) throw notFound("Staff not found");
    return null;
  }
  const legacy = repositories.staff.getById(staffId, scope(access));
  if (legacy) return normalizeOperationalStaff(legacy);
  try {
    const staff = normalizeOperationalStaff(staffOsService.getStaff(staffId, access));
    if (staff?.branchId) tenantService.assertBranchAccess(access, staff.branchId);
    return staff;
  } catch (error) {
    if (options.required) throw notFound("Staff not found");
    return null;
  }
}

function listOperationalStaff(query = {}, access = {}) {
  const branchId = String(query.branchId || "").trim();
  const staff = new Map();
  for (const person of repositories.staff.list({ branchId, limit: 10000 }, scope(access, branchId)).map((row) => ({ ...normalizeOperationalStaff(row), source: "legacy_staff" }))) {
    if (person?.id) staff.set(person.id, person);
  }
  try {
    for (const person of staffOsService.listStaff({ branchId, status: query.status || "active", limit: query.limit || 200 }, access).map((row) => ({ ...normalizeOperationalStaff(row), source: "staff_os" }))) {
      if (person?.id) staff.set(person.id, person);
    }
  } catch {
    // Legacy staff remains available if Staff OS tables are unavailable during migration.
  }
  return [...staff.values()];
}

function hasLinePricing(item = {}) {
  return item.lineGross !== undefined || item.lineDiscountAmount !== undefined || item.lineTaxableSubtotal !== undefined;
}

function itemGross(item = {}) {
  return money(item.lineGross ?? (Number(item.price || 0) * Number(item.quantity || 1)));
}

function itemLineDiscount(item = {}) {
  if (item.lineDiscountAmount !== undefined) return money(item.lineDiscountAmount);
  const gross = itemGross(item);
  const value = Math.max(0, Number(item.discountValue || 0));
  const amount = item.discountType === "percent" ? (gross * Math.min(value, 100)) / 100 : value;
  return money(Math.min(gross, amount));
}

function itemTaxableSubtotal(item = {}) {
  if (item.lineTaxableSubtotal !== undefined) return money(item.lineTaxableSubtotal);
  return money(Math.max(0, itemGross(item) - itemLineDiscount(item)));
}

function calculateInvoice(items = [], discount = 0, tipTotal = 0) {
  const usesLinePricing = items.some(hasLinePricing);
  if (!usesLinePricing) {
    const subtotal = items.reduce((sum, item) => sum + Number(item.price || 0) * Number(item.quantity || 1), 0);
    const discountAmount = Math.min(Number(discount || 0), subtotal);
    const discountRatio = subtotal ? discountAmount / subtotal : 0;
    const gstAmount = items.reduce((sum, item) => {
      const line = Number(item.price || 0) * Number(item.quantity || 1);
      return sum + line * (1 - discountRatio) * (Number(item.gstRate ?? 18) / 100);
    }, 0);
    const tipAmount = money(tipTotal);
    return {
      subtotal: money(subtotal),
      discount: money(discountAmount),
      gstAmount: money(gstAmount),
      tipTotal: tipAmount,
      total: money(subtotal - discountAmount + gstAmount + tipAmount)
    };
  }

  const subtotal = items.reduce((sum, item) => sum + itemGross(item), 0);
  const itemDiscountTotal = items.reduce((sum, item) => sum + itemLineDiscount(item), 0);
  const taxableBeforeBillDiscount = items.reduce((sum, item) => sum + itemTaxableSubtotal(item), 0);
  const billDiscountAmount = Math.min(Number(discount || 0), taxableBeforeBillDiscount);
  const afterBillDiscountRatio = taxableBeforeBillDiscount
    ? Math.max(0, taxableBeforeBillDiscount - billDiscountAmount) / taxableBeforeBillDiscount
    : 0;
  const gstAmount = items.reduce((sum, item) => {
    const taxable = itemTaxableSubtotal(item) * afterBillDiscountRatio;
    return sum + taxable * (Number(item.gstRate ?? 18) / 100);
  }, 0);
  const tipAmount = money(tipTotal);
  return {
    subtotal: money(subtotal),
    discount: money(itemDiscountTotal + billDiscountAmount),
    gstAmount: money(gstAmount),
    tipTotal: tipAmount,
    total: money(subtotal - itemDiscountTotal - billDiscountAmount + gstAmount + tipAmount)
  };
}

function paymentTotal(payments = []) {
  return money(payments.reduce((sum, payment) => sum + Math.max(0, Number(payment.amount || 0)), 0));
}

function paymentMode(payment = {}) {
  return String(payment.mode || payment.payment_mode || payment.paymentMode || "").toLowerCase();
}

function bookingAdvanceAdjustedAmount(payments = []) {
  return payments
    .filter((payment) => paymentMode(payment) === "booking_advance")
    .reduce((sum, payment) => sum + Math.max(0, Number(payment.amount || 0)), 0);
}

function counterPaymentCollectedAmount(invoice = {}, payments = []) {
  return money(Math.max(0, Number(invoice.paid || 0) - bookingAdvanceAdjustedAmount(payments)));
}

function remainingCounterPaymentAmount(invoice = {}) {
  return money(Math.max(0, Number(invoice.balance || 0)));
}

function isReceivedDuePayment(payment = {}) {
  const referenceText = `${payment.reference || ""} ${payment.remarks || ""} ${payment.note || ""}`.toLowerCase();
  return referenceText.includes("pos unpaid receive")
    || referenceText.includes("old unpaid")
    || referenceText.includes("receive due")
    || referenceText.includes("received due");
}

function normalizeTips(tips = [], access) {
  return tips
    .map((tip) => {
      const amount = money(tip.amount || 0);
      const staffId = tip.staffId || tip.staff_id || "";
      if (!staffId || amount <= 0) return null;
      const staff = resolveOperationalStaff(staffId, access, { required: true });
      return {
        id: tip.id || makeId("tip"),
        staffId,
        staffName: staff.name || tip.staffName || staffId,
        paymentMode: tip.paymentMode || tip.payment_mode || "cash",
        amount,
        note: tip.note || ""
      };
    })
    .filter(Boolean);
}

function totalTips(tips = []) {
  return money(tips.reduce((sum, tip) => sum + Number(tip.amount || 0), 0));
}

function giftCardCode(card = {}) {
  return String(card.code || "").trim().toUpperCase();
}

function giftCardBranchId(card = {}) {
  return card.branchId || card.branch_id || "";
}

function giftCardExpiryDate(card = {}) {
  return card.expiryDate || card.expiry_date || "";
}

function giftCardBalance(card = {}) {
  return money(card.balance ?? card.current_balance ?? card.initialValue ?? card.initial_value ?? 0);
}

function giftCardHistory(card = {}) {
  return Array.isArray(card.redeemHistory) ? card.redeemHistory : [];
}

function findRedeemableGiftCard(normalizedCode, branchId, access) {
  return repositories.giftCards
    .list({ limit: 10000 }, scope(access))
    .find((card) => {
      const cardBranchId = giftCardBranchId(card);
      return giftCardCode(card) === normalizedCode && (!cardBranchId || !branchId || cardBranchId === branchId);
    });
}

function addDays(days = 0, from = now()) {
  const date = new Date(from);
  if (Number.isNaN(date.getTime())) return addDays(days);
  date.setDate(date.getDate() + Number(days || 0));
  return date.toISOString().slice(0, 10);
}

function activeMembershipBenefit(clientId, items = [], access) {
  if (!clientId) return { percent: 0, amount: 0, membership: null };
  const today = now().slice(0, 10);
  const memberships = repositories.memberships
    .list({ limit: 10000 }, scope(access))
    .filter((membership) => membership.clientId === clientId && membership.status !== "expired" && (!membership.validityDate || membership.validityDate >= today));
  const best = memberships
    .map((membership) => {
      const benefit = Array.isArray(membership.serviceCredits)
        ? membership.serviceCredits.find((item) => item?.type === "bill_discount")
        : null;
      return { membership, percent: Number(benefit?.percent || 0) };
    })
    .filter((item) => item.percent > 0)
    .sort((a, b) => b.percent - a.percent)[0];
  if (!best) return { percent: 0, amount: 0, membership: null };
  const eligibleSubtotal = items
    .filter((item) => !["membership", "package", "gift_card"].includes(item.type))
    .reduce((sum, item) => sum + Number(item.price || 0) * Number(item.quantity || 1), 0);
  return {
    percent: best.percent,
    amount: money((eligibleSubtotal * best.percent) / 100),
    membership: best.membership
  };
}

function commissionFor(staffId, items = [], access) {
  const staff = staffId ? resolveOperationalStaff(staffId, access) : null;
  const rule = staff?.commissionRule || {};
  return money(
    items.reduce((sum, item) => {
      const line = Number(item.price || 0) * Number(item.quantity || 1);
      const percent = item.type === "product" ? Number(rule.retailPercent || 0) : Number(rule.servicePercent || 0);
      return sum + (line * percent) / 100;
    }, 0)
  );
}

function normalizeItemAttribution(item = {}, access) {
  const rawSplits = Array.isArray(item.staffSplits) ? item.staffSplits : [];
  const validSplits = rawSplits
    .map((split) => {
      const staffId = split.staffId || split.staff_id || "";
      if (!staffId) return null;
      const staff = resolveOperationalStaff(staffId, access, { required: true });
      return {
        staffId,
        staffName: split.staffName || split.staff_name || staff.name || staffId,
        percent: Math.max(0, Number(split.percent ?? split.sharePercent ?? 0))
      };
    })
    .filter(Boolean);

  const fallbackStaffId = item.staffId || "";
  if (!validSplits.length && fallbackStaffId) {
    const staff = resolveOperationalStaff(fallbackStaffId, access, { required: true });
    validSplits.push({
      staffId: fallbackStaffId,
      staffName: item.staffName || staff.name || fallbackStaffId,
      percent: 100
    });
  }

  const totalPercent = validSplits.reduce((sum, split) => sum + Number(split.percent || 0), 0);
  const normalizedSplits = validSplits.map((split) => {
    const percent = totalPercent > 0 ? money((Number(split.percent || 0) / totalPercent) * 100) : money(100 / validSplits.length);
    return {
      ...split,
      percent,
      share: money(percent / 100)
    };
  });
  const primary = normalizedSplits[0] || {};
  return {
    staffId: fallbackStaffId || primary.staffId || "",
    staffName: item.staffName || primary.staffName || "",
    staffSplits: normalizedSplits,
    attributionMode: normalizedSplits.length > 1 ? "split" : normalizedSplits.length === 1 ? "single" : "unassigned"
  };
}

function normalizeSaleItems(items = [], access) {
  return items.map((item) => {
    const attribution = normalizeItemAttribution(item, access);
    const linePricing = {
      discountType: item.discountType || "",
      discountValue: Number(item.discountValue || 0),
      discountSource: item.discountSource || "",
      ...(item.lineGross !== undefined ? { lineGross: money(item.lineGross) } : {}),
      ...(item.lineDiscountAmount !== undefined ? { lineDiscountAmount: money(item.lineDiscountAmount) } : {}),
      ...(item.lineTaxableSubtotal !== undefined ? { lineTaxableSubtotal: money(item.lineTaxableSubtotal) } : {})
    };
    if (item.type === "service" && item.id) {
      const service = requireRecord(repositories.services, item.id, "Service", access);
      return {
        type: "service",
        id: service.id,
        name: service.name,
        quantity: Number(item.quantity || 1),
        price: Number(item.price ?? service.price),
        gstRate: Number(service.gstRate || 18),
        ...linePricing,
        ...attribution
      };
    }
    if (item.type === "product" && item.id) {
      const product = requireRecord(repositories.products, item.id, "Product", access);
      return {
        type: "product",
        id: product.id,
        name: product.name,
        quantity: Number(item.quantity || 1),
        price: Number(item.price ?? product.price),
        gstRate: Number(product.gstRate || 18),
        ...linePricing,
        ...attribution
      };
    }
    return {
      type: item.type || "custom",
      id: item.id || "",
      name: item.name,
      quantity: Number(item.quantity || 1),
      price: Number(item.price || 0),
      gstRate: Number(item.gstRate ?? 18),
      ...linePricing,
      ...attribution,
      discountPercent: Number(item.discountPercent || 0),
      validityDays: Number(item.validityDays || 0),
      serviceCredits: Array.isArray(item.serviceCredits) ? item.serviceCredits : [],
      packageCredits: Array.isArray(item.packageCredits) ? item.packageCredits : [],
      giftCode: item.giftCode || "",
      expiryDate: item.expiryDate || ""
    };
  });
}

function createSoldEntitlements({ clientId, branchId, saleId, items = [], access, soldAt = now() }) {
  const created = [];
  const soldDate = dayKey(soldAt) || now().slice(0, 10);
  for (const item of items) {
    if (item.type === "membership") {
      created.push(repositories.memberships.create({
        id: makeId("mem"),
        clientId,
        planName: item.name,
        price: money(item.price),
        planCredits: 0,
        creditsRemaining: 0,
        serviceCredits: item.serviceCredits?.length ? item.serviceCredits : [{ type: "bill_discount", percent: Number(item.discountPercent || 0), planId: item.id || "" }],
        validityDate: addDays(item.validityDays || 365, soldAt),
        autoRenew: 0,
        loyaltyMultiplier: 1,
        status: "active",
        redeemHistory: [{ date: soldDate, saleId, type: "membership_sale", planId: item.id || "" }],
        branchId,
        createdAt: soldAt,
        updatedAt: soldAt
      }, scope(access)));
    }
    if (item.type === "package") {
      const credits = item.packageCredits?.length ? item.packageCredits : [{ packageId: item.id, credits: 1 }];
      const totalCredits = credits.reduce((sum, credit) => sum + Number(credit.credits || credit.quantity || 1), 0);
      created.push(repositories.memberships.create({
        id: makeId("pkgmem"),
        clientId,
        planName: `Package: ${item.name}`,
        price: money(item.price),
        planCredits: totalCredits,
        creditsRemaining: totalCredits,
        serviceCredits: credits,
        validityDate: addDays(item.validityDays || 90, soldAt),
        autoRenew: 0,
        loyaltyMultiplier: 1,
        status: "active",
        redeemHistory: [{ date: soldDate, saleId, type: "package_sale", packageId: item.id }],
        branchId,
        createdAt: soldAt,
        updatedAt: soldAt
      }, scope(access)));
    }
    if (item.type === "gift_card") {
      const code = item.giftCode || `GC-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
      created.push(repositories.giftCards.create({
        id: makeId("gift"),
        code,
        clientId,
        initialValue: money(item.price),
        balance: money(item.price),
        expiryDate: item.expiryDate || addDays(item.validityDays || 365, soldAt),
        status: "active",
        redeemHistory: [{ date: soldDate, saleId, type: "gift_card_sale" }],
        createdAt: soldAt,
        updatedAt: soldAt
      }, scope(access)));
    }
  }
  return created;
}

function applyWalletDebit({ clientId, branchId, amount, invoiceId, access, createdAt = now() }) {
  if (!amount) return null;
  const client = requireRecord(repositories.clients, clientId, "Client", access);
  const balance = money(client.walletBalance || 0);
  if (amount > balance) throw conflict("Wallet payment exceeds available wallet balance");
  const nextBalance = money(balance - amount);
  repositories.clients.update(clientId, { walletBalance: nextBalance }, scope(access));
  return repositories.walletTransactions.create({
    id: makeId("wallet"),
    branchId,
    clientId,
    type: "debit",
    amount,
    balanceAfter: nextBalance,
    referenceType: "invoice",
    referenceId: invoiceId,
    notes: "Wallet payment applied to invoice",
    metadata: { invoiceId },
    createdAt
  }, scope(access, branchId));
}

function createPaymentRecords(invoiceId, payments = [], access, { clientId = "", branchId = "", invoiceTotal = 0, createdAt = now() } = {}) {
  const totalPaid = paymentTotal(payments);
  if (invoiceTotal && totalPaid > money(invoiceTotal) + 0.01) throw conflict("Payment total cannot exceed invoice total");
  payments
    .filter((payment) => Number(payment.amount) > 0)
    .forEach((payment) => {
      if (payment.mode === "wallet") {
        applyWalletDebit({ clientId, branchId, amount: money(payment.amount), invoiceId, access, createdAt });
      }
      repositories.payments.create({
        id: makeId("pay"),
        invoiceId,
        mode: payment.mode,
        amount: money(payment.amount),
        reference: payment.reference || "",
        createdAt
      }, scope(access));
    });
  return updateInvoiceStatus(invoiceId, access?.tenantId);
}

function nextInvoiceNumber(access, stamp = now()) {
  const invoiceDate = new Date(stamp);
  const year = Number.isNaN(invoiceDate.getTime()) ? new Date().getFullYear() : invoiceDate.getFullYear();
  let sequence = repositories.invoices.count(scope(access)) + 1;
  for (let attempt = 0; attempt < 1000; attempt += 1) {
    const invoiceNumber = `AURA-${year}-${String(sequence + attempt).padStart(5, "0")}`;
    const existing = db.prepare("SELECT id FROM invoices WHERE tenantId = ? AND invoiceNumber = ?").get(access.tenantId, invoiceNumber);
    if (!existing) return invoiceNumber;
  }
  return `AURA-${year}-${Date.now()}`;
}

function updateClientAfterSale(clientId, sale, invoice, access) {
  const client = requireRecord(repositories.clients, clientId, "Client", access);
  const visitHistory = Array.isArray(client.visitHistory) ? client.visitHistory : [];
  const purchaseHistory = Array.isArray(client.purchaseHistory) ? client.purchaseHistory : [];
  const loyaltyEarned = Math.floor(Number(invoice.total || 0) / 100);
  const saleStamp = sale.createdAt || now();
  const saleDate = dayKey(saleStamp) || now().slice(0, 10);
  repositories.clients.update(clientId, {
    totalSpend: money(Number(client.totalSpend || 0) + Number(invoice.total || 0)),
    visitCount: Number(client.visitCount || 0) + 1,
    lastVisitAt: latestStamp(client.lastVisitAt || "", saleStamp),
    loyaltyPoints: Number(client.loyaltyPoints || 0) + loyaltyEarned,
    visitHistory: [
      { date: saleDate, saleId: sale.id, staffId: sale.staffId, appointmentId: sale.appointmentId || "" },
      ...visitHistory
    ].slice(0, 50),
    purchaseHistory: [
      { date: saleDate, invoice: invoice.invoiceNumber, amount: invoice.total, items: sale.items },
      ...purchaseHistory
    ].slice(0, 50)
  }, scope(access));
}

function escapeHtml(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function invoiceMoney(value = 0) {
  return `INR ${money(value).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function invoiceDateTime(value = "") {
  const date = new Date(String(value || ""));
  if (Number.isNaN(date.getTime())) return String(value || "");
  return date.toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true
  });
}

function renderInvoiceHtml({ invoice, sale, client, branch, payments }) {
  const tips = Array.isArray(sale?.membershipRedeem?.tips) ? sale.membershipRedeem.tips : [];
  const membershipDiscount = money(sale?.membershipRedeem?.autoDiscountAmount || 0);
  const membershipDiscountPercent = Number(sale?.membershipRedeem?.autoDiscountPercent || 0);
  const taxable = money(Number(invoice.subtotal || 0) - Number(invoice.discount || 0) - Number(invoice.couponDiscount || 0) - membershipDiscount);
  const rows = (invoice.lineItems || []).map((item) => `
    <tr>
      <td>${escapeHtml(item.name)}</td>
      <td>${Number(item.quantity || 1)}</td>
      <td class="num">${invoiceMoney(item.price || 0)}</td>
      <td>${Number(item.gstRate || 0)}%</td>
      <td class="num">${invoiceMoney(Number(item.price || 0) * Number(item.quantity || 1))}</td>
    </tr>`).join("");
  const tipRows = tips.map((tip) => `
    <tr>
      <td>${escapeHtml(tip.staffName || tip.staffId || "Staff")}</td>
      <td>${escapeHtml(tip.paymentMode || "cash")}</td>
      <td class="num">${invoiceMoney(tip.amount || 0)}</td>
    </tr>`).join("");
  const paymentRows = payments.map((payment) => `
    <tr>
      <td>${escapeHtml(payment.mode || "cash")}</td>
      <td>${escapeHtml(payment.reference || payment.remarks || "Counter collection")}</td>
      <td>${escapeHtml(invoiceDateTime(payment.createdAt || payment.created_at))}</td>
      <td class="num">${invoiceMoney(payment.amount)}</td>
    </tr>`).join("");
  const tipAmount = totalTips(tips);
  const advanceAdjusted = bookingAdvanceAdjustedAmount(payments);
  const counterPaid = counterPaymentCollectedAmount(invoice, payments);
  const counterDue = remainingCounterPaymentAmount(invoice);
  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>${escapeHtml(invoice.invoiceNumber)}</title>
  <style>
    @page { size: A4; margin: 12mm; }
    * { box-sizing: border-box; }
    body { margin: 0; background: #eef2f4; color: #111827; font-family: Arial, sans-serif; font-size: 12px; }
    .sheet { width: 210mm; min-height: 297mm; margin: 0 auto; padding: 14mm; background: #fff; }
    .top { display: flex; justify-content: space-between; gap: 18px; border-bottom: 2px solid #0f766e; padding-bottom: 12px; }
    h1, h2, h3, p { margin: 0; }
    h1 { font-size: 24px; letter-spacing: 0; }
    h2 { font-size: 18px; color: #0f766e; text-align: right; }
    h3 { font-size: 13px; margin: 16px 0 8px; text-transform: uppercase; color: #475569; }
    .muted { color: #64748b; }
    .meta { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin: 14px 0; }
    .box { border: 1px solid #dbe4e8; border-radius: 6px; padding: 8px; min-height: 52px; }
    .box span { display: block; color: #64748b; font-size: 10px; text-transform: uppercase; margin-bottom: 4px; }
    .box strong { font-size: 13px; }
    table { width: 100%; border-collapse: collapse; margin-top: 6px; }
    th { background: #f3f7f7; color: #475569; font-size: 10px; text-transform: uppercase; }
    th, td { border: 1px solid #dbe4e8; padding: 8px; vertical-align: top; }
    .num { text-align: right; white-space: nowrap; }
    .summary { margin-left: auto; margin-top: 14px; width: 86mm; border: 1px solid #dbe4e8; border-radius: 6px; overflow: hidden; }
    .summary div { display: flex; justify-content: space-between; gap: 12px; padding: 8px 10px; border-bottom: 1px solid #e5edf0; }
    .summary div:last-child { border-bottom: 0; }
    .summary .grand { background: #0f766e; color: #fff; font-size: 15px; font-weight: 700; }
    .footer { margin-top: 18px; border-top: 1px solid #dbe4e8; padding-top: 10px; display: flex; justify-content: space-between; color: #64748b; }
    .printbar { position: sticky; top: 0; padding: 10px; background: #0f172a; text-align: center; }
    .printbar button { border: 0; border-radius: 6px; padding: 10px 16px; font-weight: 700; cursor: pointer; }
    @media print {
      body { background: #fff; }
      .sheet { width: auto; min-height: auto; margin: 0; padding: 0; }
      .printbar { display: none; }
    }
  </style>
</head>
<body>
  <div class="printbar"><button onclick="window.print()">Print / Save as PDF A4</button></div>
  <main class="sheet">
  <section class="top">
    <div>
      <h1>${escapeHtml(branch?.name || "Aura Salon")}</h1>
      <p class="muted">${escapeHtml(branch?.address || "")}</p>
    </div>
    <div>
      <h2>Tax Invoice</h2>
      <p><strong>${escapeHtml(invoice.invoiceNumber)}</strong></p>
    </div>
  </section>
  <section class="meta">
    <div class="box"><span>Client</span><strong>${escapeHtml(client?.name || "")}</strong><p class="muted">${escapeHtml(client?.phone || "")}</p></div>
    <div class="box"><span>Branch</span><strong>${escapeHtml(branch?.name || sale?.branchId || "")}</strong></div>
    <div class="box"><span>Date</span><strong>${escapeHtml(invoiceDateTime(invoice.createdAt))}</strong></div>
    <div class="box"><span>Status</span><strong>${escapeHtml(invoice.status || "")}</strong></div>
  </section>
  <h3>Items</h3>
  <table>
    <thead><tr><th>Item</th><th>Qty</th><th>Price</th><th>GST</th><th>Total</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  ${tips.length ? `<h3>Staff tips</h3><table><thead><tr><th>Staff</th><th>Mode</th><th class="num">Amount</th></tr></thead><tbody>${tipRows}</tbody></table>` : ""}
  ${payments.length ? `<h3>Payments</h3><table><thead><tr><th>Mode</th><th>Reference</th><th>Date</th><th class="num">Amount</th></tr></thead><tbody>${paymentRows}</tbody></table>` : ""}
  <section class="summary">
    <div><span>Subtotal</span><strong>${invoiceMoney(invoice.subtotal)}</strong></div>
    <div><span>Discount</span><strong>${invoiceMoney(invoice.discount)}</strong></div>
    ${membershipDiscount ? `<div><span>Membership discount ${membershipDiscountPercent}%</span><strong>${invoiceMoney(membershipDiscount)}</strong></div>` : ""}
    <div><span>Coupon ${escapeHtml(invoice.couponCode || sale?.couponCode || "None")}</span><strong>${invoiceMoney(invoice.couponDiscount || 0)}</strong></div>
    <div><span>Taxable</span><strong>${invoiceMoney(taxable)}</strong></div>
    <div><span>GST</span><strong>${invoiceMoney(invoice.gstAmount)}</strong></div>
    <div><span>Tips</span><strong>${invoiceMoney(tipAmount)}</strong></div>
    <div class="grand"><span>Total</span><strong>${invoiceMoney(invoice.total)}</strong></div>
    <div><span>Paid</span><strong>${invoiceMoney(invoice.paid)}</strong></div>
    <div><span>Balance</span><strong>${invoiceMoney(invoice.balance)}</strong></div>
    <div><span>Advance adjusted</span><strong>${invoiceMoney(advanceAdjusted)}</strong></div>
    <div><span>Counter paid</span><strong>${invoiceMoney(counterPaid)}</strong></div>
    <div><span>Counter due</span><strong>${invoiceMoney(counterDue)}</strong></div>
  </section>
  <section class="footer">
    <span>Generated by Aura Salon OS</span>
    <span>Thank you</span>
  </section>
  </main>
</body>
</html>`;
}

export class SalonOperationsService {
  completeAppointment(id, notes, access) {
    const appointment = requireRecord(repositories.appointments, id, "Appointment", access);
    const updated = repositories.appointments.update(appointment.id, {
      status: "completed",
      billable: 1,
      notes: notes ?? appointment.notes
    }, scope(access));
    const inventoryDeductions = [];
    for (const serviceId of appointment.serviceIds || []) {
      const deduction = inventoryEnterpriseService.consumeServiceRecipe({
        serviceId,
        branchId: appointment.branchId,
        quantity: 1,
        referenceType: "appointment",
        referenceId: appointment.id,
        staffId: appointment.staffId,
        clientId: appointment.clientId
      }, access);
      if (deduction.status === "deducted") inventoryDeductions.push(deduction);
      else inventoryDeductions.push(...deductServiceUsage([serviceId], appointment.branchId, "appointment", appointment.id, access.tenantId));
    }
    return { appointment: updated, billable: true, inventoryDeductions };
  }

  updateAppointmentStatus(id, status, access) {
    const allowed = ["booked", "arrived", "no-show", "completed", "cancelled"];
    if (!allowed.includes(status)) throw badRequest("Invalid appointment status");
    const appointment = requireRecord(repositories.appointments, id, "Appointment", access);
    return repositories.appointments.update(appointment.id, {
      status,
      billable: status === "completed" ? 1 : appointment.billable
    }, scope(access));
  }

  adjustInventory({ productId, branchId, quantity, type = "adjustment", reason = "Manual stock adjustment" }, access) {
    if (!productId || !branchId || !quantity) throw badRequest("productId, branchId and quantity are required");
    tenantService.assertBranchAccess(access, branchId);
    return applyInventoryDelta({
      productId,
      branchId,
      quantity: Number(quantity),
      type,
      reason,
      referenceType: "manual",
      referenceId: "",
      tenantId: access.tenantId
    });
  }

  transferStock({ productId, fromBranchId, toBranchId, quantity }, access) {
    if (!productId || !fromBranchId || !toBranchId || !quantity) {
      throw badRequest("productId, fromBranchId, toBranchId and quantity are required");
    }
    tenantService.assertBranchAccess(access, fromBranchId);
    tenantService.assertBranchAccess(access, toBranchId);
    const product = requireRecord(repositories.products, productId, "Product", access);
    const outgoing = applyInventoryDelta({
      productId,
      branchId: fromBranchId,
      quantity: -Math.abs(Number(quantity)),
      type: "transfer-out",
      reason: `Transfer to ${toBranchId}`,
      referenceType: "branch-transfer",
      referenceId: toBranchId,
      tenantId: access.tenantId
    });
    const targetProduct = repositories.products.list({ branchId: toBranchId, limit: 10000 }, scope(access)).find((item) => item.sku === product.sku);
    const incomingProduct =
      targetProduct ||
      repositories.products.create({
        ...product,
        id: makeId("prod"),
        branchId: toBranchId,
        stock: 0,
        createdAt: undefined,
        updatedAt: undefined
      }, scope(access));
    const incoming = applyInventoryDelta({
      productId: incomingProduct.id,
      branchId: toBranchId,
      quantity: Math.abs(Number(quantity)),
      type: "transfer-in",
      reason: `Transfer from ${fromBranchId}`,
      referenceType: "branch-transfer",
      referenceId: fromBranchId,
      tenantId: access.tenantId
    });
    return { outgoing, incoming };
  }

  checkoutSale(payload, access) {
    const {
      clientId,
      appointmentId = "",
      branchId,
      staffId = "",
      discount = 0,
      couponCode = "",
      payments = [],
      tips = [],
      membershipRedeem = {},
      discountBreakdown = {}
    } = payload;
    const requestedItems = payload.items || [];
    if (!clientId || !branchId || !requestedItems.length) throw badRequest("clientId, branchId and items are required");
    tenantService.ensureSubscriptionActive(access.tenantId);
    tenantService.assertBranchAccess(access, branchId);
    const client = requireRecord(repositories.clients, clientId, "Client", access);
    const invoiceStamp = billingStamp(payload);
    const invoiceDate = dayKey(invoiceStamp) || now().slice(0, 10);
    const checkoutLockKey = appointmentId ? `${access.tenantId || ""}:${appointmentId}` : "";
    if (checkoutLockKey && appointmentCheckoutLocks.has(checkoutLockKey)) {
      throw conflict("Appointment billing is already in progress");
    }
    if (checkoutLockKey) appointmentCheckoutLocks.add(checkoutLockKey);

    try {
    if (appointmentId) {
      const appointment = requireRecord(repositories.appointments, appointmentId, "Appointment", access);
      if (appointment.status !== "completed") throw conflict("Appointment must be completed before billing");
      const appointmentSaleIds = new Set(
        repositories.sales
          .list({ limit: 10000 }, scope(access))
          .filter((sale) => String(sale.appointmentId || "") === appointmentId)
          .map((sale) => String(sale.id || ""))
      );
      const existingInvoice = repositories.invoices
        .list({ limit: 10000 }, scope(access))
        .find((invoice) => {
          const status = String(invoice.status || "").trim().toLowerCase();
          if (status === "deleted") return false;
          return String(invoice.appointmentId || "") === appointmentId || appointmentSaleIds.has(String(invoice.saleId || ""));
        });
      if (existingInvoice) throw conflict("Appointment is already billed");
    }

    const items = normalizeSaleItems(requestedItems, access);
    const normalizedTips = normalizeTips(tips, access);
    const tipTotal = totalTips(normalizedTips);
    const coupon = couponCode ? this.validateCoupon({ code: couponCode, branchId, items, subtotal: items.reduce((sum, item) => sum + Number(item.price || 0) * Number(item.quantity || 1), 0) }, access) : null;
    const couponDiscount = money(coupon?.discountAmount || 0);
    const membershipBenefit = activeMembershipBenefit(clientId, items, access);
    const membershipDiscount = membershipBenefit.amount;
    const hasSubmittedLinePricing = items.some(hasLinePricing);
    const manualBillDiscount = money(Number(discountBreakdown?.manualDiscountAmount ?? discount ?? 0));
    const billDiscount = hasSubmittedLinePricing
      ? manualBillDiscount + couponDiscount
      : Number(discount || 0) + membershipDiscount + couponDiscount;
    const totals = calculateInvoice(items, billDiscount, tipTotal);
    const sale = repositories.sales.create({
      id: makeId("sale"),
      clientId,
      appointmentId,
      branchId,
      staffId,
      items,
      ...totals,
      couponCode: coupon?.coupon?.code || "",
      couponDiscount,
      commissionTotal: commissionFor(staffId, items, access),
      membershipRedeem: {
        ...membershipRedeem,
        autoDiscountAmount: membershipDiscount,
        autoDiscountPercent: membershipBenefit.percent,
        autoDiscountMembershipId: membershipBenefit.membership?.id || "",
        tips: normalizedTips,
        tipTotal
      },
      splitPayments: payments,
      status: "completed",
      createdAt: invoiceStamp,
      updatedAt: invoiceStamp
    }, scope(access));
    const attributionAudit = items.map((item) => ({
      itemId: item.id,
      itemName: item.name,
      itemType: item.type,
      staffId: item.staffId,
      staffName: item.staffName,
      attributionMode: item.attributionMode,
      staffSplits: item.staffSplits || []
    }));
    securityService.audit({ action: "sale.checkout", targetType: "sale", targetId: sale.id, details: { branchId, staffId, appointmentId, itemCount: items.length, attribution: attributionAudit } }, access);
    if (items.some((item) => Array.isArray(item.staffSplits) && item.staffSplits.length)) {
      securityService.audit({ action: "sale.staff_attribution.recorded", targetType: "sale", targetId: sale.id, details: { branchId, clientId, attribution: attributionAudit } }, access);
    }
    if (items.some((item) => item.attributionMode === "split")) {
      securityService.audit({ action: "sale.staff_attribution.split", targetType: "sale", targetId: sale.id, details: { branchId, clientId, splits: attributionAudit.filter((item) => item.attributionMode === "split") } }, access);
    }
    const entitlements = createSoldEntitlements({ clientId, branchId, saleId: sale.id, items, access, soldAt: invoiceStamp });

    for (const item of items) {
      if (item.type === "product") {
        inventoryEnterpriseService.consumeProductFifo({
          productId: item.id,
          branchId,
          quantity: Math.abs(Number(item.quantity || 1)),
          type: "sale-deduction",
          reason: "Retail product sold",
          referenceType: "sale",
          referenceId: sale.id
        }, access);
      }
    }

    if (membershipRedeem?.membershipId && membershipRedeem?.creditsUsed) {
      const serviceLineMappings = Array.isArray(membershipRedeem.serviceLineMappings) ? membershipRedeem.serviceLineMappings : [];
      this.redeemMembership({
        ...membershipRedeem,
        saleId: sale.id,
        serviceId: membershipRedeem.serviceId || serviceLineMappings[0]?.serviceId || "",
        serviceLineMappings
      }, access);
    }

    const invoice = repositories.invoices.create({
      id: makeId("inv"),
      saleId: sale.id,
      appointmentId,
      clientId,
      invoiceNumber: nextInvoiceNumber(access, invoiceStamp),
      lineItems: items,
      ...totals,
      couponCode: coupon?.coupon?.code || "",
      couponDiscount,
      paid: 0,
      balance: totals.total,
      status: "unpaid",
      dueDate: invoiceDate,
      createdAt: invoiceStamp,
      updatedAt: invoiceStamp
    }, scope(access));
    if (coupon?.coupon?.id && coupon.coupon.source !== "gift_card") {
      repositories.couponCodes.update(coupon.coupon.id, { usedCount: Number(coupon.coupon.usedCount || 0) + 1 }, scope(access));
    }
    const paidInvoice = createPaymentRecords(invoice.id, payments, access, { clientId, branchId, invoiceTotal: totals.total, createdAt: invoiceStamp });
    if (coupon?.coupon?.source === "gift_card" && couponDiscount > 0) {
      this.redeemGiftCardCoupon(coupon.coupon, { amount: couponDiscount, sale, invoice: paidInvoice, branchId }, access);
    }
    const productConsumeDrafts = inventoryEnterpriseService.createProductConsumeDraftsForInvoice({
      invoice: paidInvoice,
      sale,
      client,
      items
    }, access);
    membershipEnterpriseService.createInvoiceSnapshot({ sale, invoice: paidInvoice, membershipBenefit, membershipRedeem: sale.membershipRedeem }, access);
    membershipEnterpriseService.recordSoldEntitlements({ entitlements, sale, invoice: paidInvoice, items }, access);
    const balanceSheetLink = balanceSheetConnector.connectPosCheckout({
      sale,
      invoice: paidInvoice,
      payments,
      items,
      entitlements
    }, access);
    updateClientAfterSale(clientId, sale, paidInvoice, access);
    if (entitlements.length) {
      securityService.audit({ action: "sale.entitlements.created", targetType: "sale", targetId: sale.id, details: { branchId, clientId, count: entitlements.length } }, access);
    }
    tenantService.recordUsage({ tenantId: access.tenantId, metric: "sales", referenceType: "sale", referenceId: sale.id });
    const invoiceDocument = this.generateInvoiceDocument(paidInvoice.id, access);
    let invoiceNotifications = { invoiceId: paidInvoice.id, queued: 0, rows: [] };
    try {
      invoiceNotifications = invoiceNotificationService.queueForPosInvoice({ invoice: paidInvoice, sale, client, payments, invoiceDocument }, access);
    } catch (error) {
      invoiceNotifications = { invoiceId: paidInvoice.id, queued: 0, rows: [], skipped: true, error: error.message };
    }
    let reviewRequest = { status: "skipped", reason: "missing_appointment" };
    try {
      reviewRequest = appointmentId
        ? reputationService.sendReviewRequest(appointmentId, { invoiceId: paidInvoice.id, force: true, channel: "auto" }, access)
        : reviewRequest;
    } catch (error) {
      reviewRequest = { status: "skipped", reason: "review_request_failed", error: error.message };
    }
    return { sale, invoice: paidInvoice, coupon, invoiceDocument, invoiceNotifications, reviewRequest, productConsumeDrafts, balanceSheetLink };
    } finally {
      if (checkoutLockKey) appointmentCheckoutLocks.delete(checkoutLockKey);
    }
  }

  addInvoicePayment(invoiceId, { mode, amount, reference = "" }, access) {
    const invoice = requireRecord(repositories.invoices, invoiceId, "Invoice", access);
    const sale = invoice.saleId ? repositories.sales.getById(invoice.saleId, scope(access)) : null;
    if (mode === "wallet") {
      applyWalletDebit({ clientId: invoice.clientId, branchId: sale?.branchId || "", amount: money(amount), invoiceId, access });
    }
    const payment = repositories.payments.create({
      id: makeId("pay"),
      invoiceId,
      mode,
      amount: money(amount),
      reference
    }, scope(access));
    const updatedInvoice = updateInvoiceStatus(invoiceId, access.tenantId);
    const balanceSheetLink = balanceSheetConnector.connectClassicInvoicePayment({ invoice: updatedInvoice, payment }, access);
    return { payment, invoice: updatedInvoice, balanceSheetLink };
  }

  redeemGiftCardCoupon(giftCardCoupon, { amount = 0, sale = {}, invoice = {}, branchId = "" } = {}, access) {
    const giftCardId = giftCardCoupon?.giftCardId || giftCardCoupon?.id || "";
    const redeemAmount = money(amount);
    if (!giftCardId || redeemAmount <= 0) return null;
    const giftCard = repositories.giftCards.getById(giftCardId, scope(access));
    if (!giftCard) throw notFound("Gift card not found");
    const currentBalance = giftCardBalance(giftCard);
    if (redeemAmount > currentBalance) throw conflict("Gift card balance is lower than the redeem amount");
    const nextBalance = money(currentBalance - redeemAmount);
    const cardBranchId = giftCardBranchId(giftCard);
    const redeemHistory = [
      {
        date: now().slice(0, 10),
        type: "gift_card_redeem",
        amount: redeemAmount,
        saleId: sale.id || "",
        invoiceId: invoice.id || "",
        invoiceNumber: invoice.invoiceNumber || "",
        branchId: branchId || cardBranchId
      },
      ...giftCardHistory(giftCard)
    ].slice(0, 100);
    return repositories.giftCards.update(giftCard.id, {
      balance: nextBalance,
      status: nextBalance <= 0 ? "redeemed" : "active",
      redeemHistory
    }, scope(access));
  }

  validateCoupon({ code = "", branchId = "", items = [], subtotal = 0 } = {}, access) {
    const normalizedCode = String(code || "").trim().toUpperCase();
    if (!normalizedCode) throw badRequest("coupon code is required");
    if (branchId) tenantService.assertBranchAccess(access, branchId);
    const coupon = repositories.couponCodes
      .list({ limit: 10000 }, scope(access))
      .find((item) => String(item.code || "").toUpperCase() === normalizedCode && (!item.branchId || item.branchId === branchId));
    const subtotalAmount = money(subtotal || items.reduce((sum, item) => sum + Number(item.price || 0) * Number(item.quantity || 1), 0));
    if (!coupon || coupon.status !== "active") {
      const giftCard = findRedeemableGiftCard(normalizedCode, branchId, access);
      if (!giftCard || giftCard.status !== "active") throw notFound("Coupon code not found or inactive");
      const expiryDate = giftCardExpiryDate(giftCard);
      const today = now().slice(0, 10);
      if (expiryDate && expiryDate < today) throw conflict("Gift card has expired");
      const balance = giftCardBalance(giftCard);
      if (balance <= 0) throw conflict("Gift card has no balance");
      const discountAmount = money(Math.min(subtotalAmount, balance));
      return {
        coupon: {
          id: giftCard.id,
          code: giftCard.code || normalizedCode,
          source: "gift_card",
          type: "gift_card",
          giftCardId: giftCard.id,
          balance,
          expiryDate
        },
        subtotal: subtotalAmount,
        discountAmount,
        giftCard: true
      };
    }
    const today = now().slice(0, 10);
    if (coupon.startsAt && coupon.startsAt > today) throw conflict("Coupon is not active yet");
    if (coupon.endsAt && coupon.endsAt < today) throw conflict("Coupon has expired");
    if (Number(coupon.usageLimit || 0) && Number(coupon.usedCount || 0) >= Number(coupon.usageLimit)) throw conflict("Coupon usage limit reached");
    if (subtotalAmount < Number(coupon.minSubtotal || 0)) throw conflict(`Coupon requires minimum subtotal of ${coupon.minSubtotal}`);
    const rawDiscount = coupon.type === "percentage" ? subtotalAmount * (Number(coupon.value || 0) / 100) : Number(coupon.value || 0);
    const maxDiscount = Number(coupon.maxDiscount || 0);
    const discountAmount = money(Math.min(subtotalAmount, maxDiscount ? Math.min(rawDiscount, maxDiscount) : rawDiscount));
    return { coupon, subtotal: subtotalAmount, discountAmount };
  }

  adjustWallet(clientId, payload = {}, access) {
    const client = requireRecord(repositories.clients, clientId, "Client", access);
    const amount = money(payload.amount);
    if (!amount || amount <= 0) throw badRequest("amount must be greater than zero");
    const type = payload.type === "debit" ? "debit" : "credit";
    const branchId = payload.branchId || client.branchId || access.branchId || "";
    if (branchId) tenantService.assertBranchAccess(access, branchId);
    const current = money(client.walletBalance || 0);
    const nextBalance = type === "credit" ? money(current + amount) : money(current - amount);
    if (nextBalance < 0) throw conflict("Wallet balance cannot go below zero");
    const transactionStamp = billingStamp(payload);
    repositories.clients.update(client.id, { walletBalance: nextBalance }, scope(access));
    const transaction = repositories.walletTransactions.create({
      id: makeId("wallet"),
      branchId,
      clientId: client.id,
      type,
      amount,
      balanceAfter: nextBalance,
      referenceType: payload.referenceType || "manual",
      referenceId: payload.referenceId || "",
      notes: payload.notes || "",
      metadata: payload.metadata || {},
      createdAt: transactionStamp
    }, scope(access, branchId));
    return { transaction, client: repositories.clients.getById(client.id, scope(access)) };
  }

  generateInvoiceDocument(invoiceId, access) {
    const invoice = requireRecord(repositories.invoices, invoiceId, "Invoice", access);
    const sale = invoice.saleId ? repositories.sales.getById(invoice.saleId, scope(access)) : null;
    if (sale?.branchId) tenantService.assertBranchAccess(access, sale.branchId);
    const client = repositories.clients.getById(invoice.clientId, scope(access));
    const branch = sale?.branchId ? repositories.branches.getById(sale.branchId, scope(access)) : null;
    const payments = repositories.payments.list({ limit: 10000 }, scope(access)).filter((payment) => payment.invoiceId === invoice.id);
    const payload = { invoice, sale, client, branch, payments };
    const content = renderInvoiceHtml(payload);
    return repositories.invoiceDocuments.create({
      id: makeId("idoc"),
      branchId: sale?.branchId || "",
      invoiceId: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      format: "html",
      content,
      payload,
      status: "generated"
    }, scope(access, sale?.branchId || ""));
  }

  createCreditNote({ invoiceId, amount, reason = "", lineItems = [] } = {}, access) {
    if (!invoiceId || !amount) throw badRequest("invoiceId and amount are required");
    const invoice = requireRecord(repositories.invoices, invoiceId, "Invoice", access);
    const sale = invoice.saleId ? repositories.sales.getById(invoice.saleId, scope(access)) : null;
    if (sale?.branchId) tenantService.assertBranchAccess(access, sale.branchId);
    const count = repositories.creditNotes.count(scope(access));
    return repositories.creditNotes.create({
      id: makeId("cn"),
      branchId: sale?.branchId || "",
      invoiceId: invoice.id,
      saleId: invoice.saleId || "",
      clientId: invoice.clientId,
      creditNoteNumber: `CN-${new Date().getFullYear()}-${String(count + 1).padStart(5, "0")}`,
      amount: money(amount),
      reason,
      lineItems: lineItems.length ? lineItems : invoice.lineItems,
      status: "issued",
      createdBy: access.userId || ""
    }, scope(access, sale?.branchId || ""));
  }

  redeemMembership({ membershipId, creditsUsed = 0, saleId = "", serviceId = "", serviceLineMappings = [], benefitType = "", benefitName = "", remainingAfterRedeem = 0 }, access) {
    if (!membershipId || !creditsUsed) return null;
    const membership = requireRecord(repositories.memberships, membershipId, "Membership", access);
    if (Number(membership.creditsRemaining) < Number(creditsUsed)) {
      throw conflict("Membership does not have enough credits");
    }
    return repositories.memberships.update(membershipId, {
      creditsRemaining: Number(membership.creditsRemaining) - Number(creditsUsed),
      redeemHistory: [
        {
          date: now().slice(0, 10),
          credits: Number(creditsUsed),
          saleId,
          serviceId,
          benefitType,
          benefitName,
          remainingAfterRedeem: Number(remainingAfterRedeem || 0),
          serviceLineMappings: Array.isArray(serviceLineMappings) ? serviceLineMappings : []
        },
        ...(membership.redeemHistory || [])
      ]
    }, scope(access));
  }

  segmentClients({ tag = "", minSpend = 0, minVisits = 0, branchId = "", membershipOnly = false }, access) {
    if (branchId) tenantService.assertBranchAccess(access, branchId);
    const clients = repositories.clients.list({ branchId, limit: 10000 }, scope(access)).filter((client) => {
      const tagMatch = tag ? (client.tags || []).map((item) => String(item).toLowerCase()).includes(String(tag).toLowerCase()) : true;
      const spendMatch = Number(client.totalSpend || 0) >= Number(minSpend || 0);
      const visitMatch = Number(client.visitCount || 0) >= Number(minVisits || 0);
      const membershipMatch = membershipOnly ? Boolean(client.membershipId) : true;
      return tagMatch && spendMatch && visitMatch && membershipMatch;
    });
    return { count: clients.length, clients };
  }

  sendCampaign(id, clients = [], access) {
    const campaign = requireRecord(repositories.campaigns, id, "Campaign", access);
    const segment = clients.length ? clients : repositories.clients.list({ limit: 10000 }, scope(access));
    segment.forEach((client) => {
      repositories.notifications.create({
        id: makeId("note"),
        clientId: client.id,
        type: "campaign",
        channel: campaign.channel,
        message: campaign.template.replaceAll("{{name}}", client.name),
        status: campaign.channel.toLowerCase() === "whatsapp" ? "queued-whatsapp" : "queued"
      }, scope(access));
    });
    return repositories.campaigns.update(campaign.id, {
      status: "sent",
      sentCount: Number(campaign.sentCount || 0) + segment.length
    }, scope(access));
  }

  dashboardReport(branchId = "", access) {
    if (branchId) tenantService.assertBranchAccess(access, branchId);
    const queryScope = scope(access, branchId);
    const sales = repositories.sales.list({ branchId, limit: 10000 }, queryScope);
    const invoices = repositories.invoices.list({ limit: 10000 }, queryScope);
    const appointments = repositories.appointments.list({ branchId, limit: 10000 }, queryScope);
    const clients = repositories.clients.list({ branchId, limit: 10000 }, queryScope);
    const products = repositories.products.list({ branchId, limit: 10000 }, queryScope);
    const memberships = repositories.memberships.list({ branchId, limit: 10000 }, queryScope);
    const staff = repositories.staff.list({ branchId, limit: 10000 }, queryScope);
    const payments = repositories.payments.list({ limit: 10000 }, scope(access));
    const today = new Date().toISOString().slice(0, 10);
    const month = today.slice(0, 7);
    const todaySales = sales.filter((sale) => sale.createdAt?.startsWith(today));
    const monthSales = sales.filter((sale) => sale.createdAt?.startsWith(month));
    const pendingInvoices = invoices.filter((invoice) => invoice.status !== "paid");
    const invoiceIdsInScope = new Set(
      invoices
        .filter((invoice) => !branchId || sales.some((sale) => sale.id === invoice.saleId))
        .map((invoice) => invoice.id)
    );
    const receivedDue = payments
      .filter((payment) => invoiceIdsInScope.has(payment.invoiceId))
      .filter(isReceivedDuePayment)
      .reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
    const completedAppointments = appointments.filter((appointment) => appointment.status === "completed");
    const repeatCustomers = clients.filter((client) => Number(client.visitCount) > 1).length;

    return {
      revenueToday: money(todaySales.reduce((sum, sale) => sum + Number(sale.total), 0)),
      revenueMonth: money(monthSales.reduce((sum, sale) => sum + Number(sale.total), 0)),
      totalBookings: appointments.length,
      newClients: clients.filter((client) => client.createdAt?.startsWith(month)).length,
      pendingPayments: money(pendingInvoices.reduce((sum, invoice) => sum + Number(invoice.balance), 0)),
      receivedDue: money(receivedDue),
      lowStockAlerts: products.filter((product) => Number(product.stock) <= Number(product.lowStockThreshold)),
      expiryAlerts: products.filter((product) => product.expiryDate && product.expiryDate <= "2026-08-31"),
      staffPerformance: staff.map((person) => ({
        id: person.id,
        name: person.name,
        role: person.role,
        branchId: person.branchId,
        revenue: Number(person.performance?.revenue || 0),
        bookings: Number(person.performance?.bookings || 0),
        commission: commissionFor(person.id, sales.flatMap((sale) => sale.items || []), access)
      })),
      membershipRevenue: money(memberships.reduce((sum, membership) => sum + Number(membership.price || 0), 0)),
      repeatCustomerRate: clients.length ? Math.round((repeatCustomers / clients.length) * 100) : 0,
      clientRetention: appointments.length ? Math.round((completedAppointments.length / appointments.length) * 100) : 0,
      quickActions: ["Front-desk quick booking", "Walk-in POS checkout", "WhatsApp confirmation", "Purchase entry", "Daily closing"]
    };
  }

  advancedReport(query = {}, access = {}) {
    if (query?.tenantId && !access?.tenantId) {
      access = query;
      query = {};
    }
    const branchId = String(query.branchId || "").trim();
    if (branchId) tenantService.assertBranchAccess(access, branchId);
    const range = dateRange(query);
    const queryScope = scope(access, branchId);
    const tenantScope = scope(access);

    const sales = repositories.sales
      .list({ branchId, limit: Number(query.limit || 10000) }, queryScope)
      .filter((sale) => dateInRange(sale, range));
    const saleIds = new Set(sales.map((sale) => sale.id));
    const invoices = repositories.invoices
      .list({ limit: 10000 }, tenantScope)
      .filter((invoice) => (!branchId || saleIds.has(invoice.saleId)))
      .filter((invoice) => !range.from && !range.to ? true : saleIds.has(invoice.saleId) || dateInRange(invoice, range));
    const invoiceIds = new Set(invoices.map((invoice) => invoice.id));
    const appointments = repositories.appointments
      .list({ branchId, limit: 10000 }, queryScope)
      .filter((appointment) => dateInRange(appointment, range, ["startAt", "createdAt", "updatedAt"]));
    const clients = repositories.clients
      .list({ branchId, limit: 10000 }, queryScope);
    const periodClients = clients.filter((client) => dateInRange(client, range));
    const products = repositories.products.list({ branchId, limit: 10000 }, queryScope);
    const memberships = repositories.memberships
      .list({ branchId, limit: 10000 }, queryScope)
      .filter((membership) => dateInRange(membership, range));
    const payments = repositories.payments
      .list({ limit: 10000 }, tenantScope)
      .filter((payment) => invoiceIds.has(payment.invoiceId))
      .filter((payment) => dateInRange(payment, range, ["createdAt"]));
    const staffRows = listOperationalStaff({ branchId, status: "active", limit: 200 }, access);
    const staffById = new Map(staffRows.map((person) => [person.id, {
      id: person.id,
      name: person.name || person.fullName || person.id,
      role: person.role || "Staff",
      branchId: person.branchId || "",
      source: person.source || "staff",
      revenue: 0,
      bookings: 0,
      completedBookings: 0,
      commission: 0,
      rating: 0
    }]));

    const unassignedStaff = () => {
      if (!staffById.has("unassigned")) {
        staffById.set("unassigned", { id: "unassigned", name: "Unassigned", role: "Staff", branchId: "", revenue: 0, bookings: 0, completedBookings: 0, commission: 0, rating: 0 });
      }
      return staffById.get("unassigned");
    };
    const ensureStaffSummary = (staffId, staffName = "") => {
      if (!staffId) return unassignedStaff();
      if (!staffById.has(staffId)) {
        const staff = resolveOperationalStaff(staffId, access) || {};
        staffById.set(staffId, {
          id: staffId,
          name: staffName || staff.name || staff.fullName || staffId,
          role: staff.role || staff.designation || "Staff",
          branchId: staff.branchId || "",
          revenue: 0,
          bookings: 0,
          completedBookings: 0,
          commission: 0,
          rating: 0
        });
      }
      return staffById.get(staffId);
    };

    for (const sale of sales) {
      const items = Array.isArray(sale.items) ? sale.items : [];
      for (const item of items) {
        const line = money(Number(item.price || 0) * Number(item.quantity || 1));
        const rawSplits = Array.isArray(item.staffSplits) ? item.staffSplits.filter((split) => split?.staffId) : [];
        const splits = rawSplits.length ? rawSplits : [{ staffId: item.staffId || sale.staffId || "", staffName: item.staffName || "" }];
        const totalShare = splits.reduce((sum, split) => sum + Number(split.share || Number(split.percent || 0) / 100 || 0), 0);
        let allocated = 0;
        splits.forEach((split, index) => {
          const rawShare = Number(split.share || Number(split.percent || 0) / 100 || 0);
          const share = totalShare > 0 ? rawShare / totalShare : 1 / splits.length;
          const amount = index === splits.length - 1 ? money(line - allocated) : money(line * share);
          allocated = money(allocated + amount);
          const summary = ensureStaffSummary(split.staffId || "", split.staffName || item.staffName || "");
          summary.revenue = money(summary.revenue + amount);
        });
      }
      if (sale.staffId) {
        const summary = ensureStaffSummary(sale.staffId);
        summary.commission = money(summary.commission + Number(sale.commissionTotal || 0));
      }
    }

    for (const appointment of appointments) {
      const summary = ensureStaffSummary(appointment.staffId);
      summary.bookings += 1;
      if (appointment.status === "completed") summary.completedBookings += 1;
    }

    const revenue = sales.reduce((sum, sale) => sum + Number(sale.total || 0), 0);
    const cost = products.reduce((sum, product) => sum + Number(product.unitCost || 0) * Number(product.stock || 0), 0);
    const gstCollected = invoices.reduce((sum, invoice) => sum + Number(invoice.gstAmount || 0), 0);
    const paymentAmount = (mode) => money(payments
      .filter((item) => String(item.mode || "").toLowerCase() === mode)
      .reduce((sum, item) => sum + Number(item.amount || 0), 0));
    const repeatCustomers = clients.filter((item) => Number(item.visitCount || 0) > 1).length;
    const staff = [...staffById.values()]
      .filter((person) => person.id !== "unassigned" || person.revenue || person.bookings)
      .filter((person) => person.source === "staff_os" || person.revenue || person.bookings || person.commission)
      .map((person) => ({
        ...person,
        revenue: money(person.revenue),
        commission: money(person.commission),
        rating: person.bookings ? money((person.completedBookings / person.bookings) * 100) : Number(person.rating || 0)
      }))
      .sort((a, b) => b.revenue - a.revenue || b.bookings - a.bookings || a.name.localeCompare(b.name));

    return {
      filters: { branchId, from: range.from, to: range.to },
      generatedAt: now(),
      sales: { count: sales.length, revenue: money(revenue), gst: money(gstCollected) },
      bookings: {
        total: appointments.length,
        completed: appointments.filter((item) => item.status === "completed").length,
        booked: appointments.filter((item) => item.status === "booked").length,
        cancelled: appointments.filter((item) => item.status === "cancelled").length,
        noShow: appointments.filter((item) => item.status === "no-show").length
      },
      clients: {
        total: clients.length,
        newInPeriod: periodClients.length,
        repeat: repeatCustomers
      },
      staff,
      inventory: { lowStock: products.filter((item) => Number(item.stock) <= Number(item.lowStockThreshold)).length, stockValue: money(cost) },
      retention: { repeatCustomerRate: clients.length ? Math.round((repeatCustomers / clients.length) * 100) : 0 },
      memberships: {
        active: memberships.filter((item) => item.status === "active").length,
        creditsOpen: memberships.reduce((sum, item) => sum + Number(item.creditsRemaining || 0), 0)
      },
      gst: { collected: money(gstCollected), invoices: invoices.length },
      dailyClosing: {
        cash: paymentAmount("cash"),
        upi: paymentAmount("upi"),
        card: paymentAmount("card"),
        other: money(payments
          .filter((item) => !["cash", "upi", "card"].includes(String(item.mode || "").toLowerCase()))
          .reduce((sum, item) => sum + Number(item.amount || 0), 0))
      },
      profitLoss: { revenue: money(revenue), estimatedInventoryCost: money(cost), grossProfit: money(revenue - cost) },
      quickLinks: [
        { label: "Staff Sales", path: "/reports/staff-sales", module: "POS attribution" },
        { label: "Commission Preview", path: "/reports/commission-preview", module: "Payroll" },
        { label: "Account Ledger", path: "/reports/account-ledger", module: "Finance" },
        { label: "Inventory Reports", path: "/inventory/reports", module: "Inventory" },
        { label: "Appointment Activity", path: "/appointment-activity", module: "Bookings" },
        { label: "Client CRM", path: "/clients", module: "Clients" }
      ]
    };
  }

  reportByType(type, branchId = "", access) {
    const report = db.prepare("SELECT ? AS type").get(type);
    return { ...report, generatedAt: now(), dashboard: this.dashboardReport(branchId, access) };
  }
}

export const salonOperationsService = new SalonOperationsService();
