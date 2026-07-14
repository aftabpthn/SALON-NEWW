import { repositories } from "../repositories/repository-registry.js";
import { staffOsService } from "./staff-os.service.js";
import { tenantService } from "./tenant.service.js";

const money = (value) => Math.round((Number(value) || 0) * 100) / 100;
const dayKey = (value = "") => String(value || "").slice(0, 10);
const normalizeKey = (value = "") => String(value || "").trim().toLowerCase().replace(/\s+/g, " ");

const categoryLabels = {
  service: "Service",
  product: "Product",
  membership: "Membership",
  package: "Package",
  gift_card: "Gift card",
  custom: "Custom"
};

function dateTimeParts(value = "") {
  const text = String(value || "");
  return {
    date: text.slice(0, 10),
    time: text.length > 10 ? text.slice(11, 16) : ""
  };
}

function inDateRange(row, from, to) {
  const key = dayKey(row.createdAt || row.created_at || row.invoiceDate || row.invoice_date || row.updatedAt || row.updated_at);
  if (from && key < from) return false;
  if (to && key > to) return false;
  return true;
}

function readArray(value) {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function normalizedItemType(item = {}) {
  const raw = String(item.type || item.itemType || item.item_type || item.kind || item.category || "").toLowerCase();
  if (raw.includes("service")) return "service";
  if (raw.includes("product") || raw.includes("retail")) return "product";
  if (raw.includes("membership")) return "membership";
  if (raw.includes("package")) return "package";
  if (raw.includes("gift")) return "gift_card";
  return "custom";
}

function lineAmount(item = {}) {
  const direct = item.finalAmount ?? item.final_amount ?? item.totalAmount ?? item.total_amount ?? item.lineTotal ?? item.line_total ?? item.total ?? item.amount;
  if (direct !== undefined && direct !== null && direct !== "") return money(direct);
  const taxable = Number(item.taxableAmount ?? item.taxable_amount ?? 0);
  const gst = Number(item.gstAmount ?? item.gst_amount ?? item.taxAmount ?? item.tax_amount ?? 0);
  if (taxable || gst) return money(taxable + gst);
  return money(Number(item.price ?? item.rate ?? item.unitPrice ?? item.unit_price ?? 0) * Number(item.quantity || item.qty || 1));
}

function lineGross(item = {}) {
  const direct = item.grossAmount ?? item.gross_amount ?? item.actualPrice ?? item.actual_price ?? item.originalPrice ?? item.original_price;
  if (direct !== undefined && direct !== null && direct !== "") return money(direct);
  const price = Number(item.price ?? item.rate ?? item.unitPrice ?? item.unit_price ?? 0);
  const quantity = Number(item.quantity || item.qty || 1);
  return money(price * quantity);
}

function lineDiscount(item = {}, gross = 0, net = 0) {
  const direct = item.discountAmount ?? item.discount_amount ?? item.discount ?? item.manualDiscount ?? item.manual_discount;
  if (direct !== undefined && direct !== null && direct !== "") return money(direct);
  return money(Math.max(0, Number(gross || 0) - Number(net || 0)));
}

function lineGst(item = {}) {
  return money(item.gstAmount ?? item.gst_amount ?? item.taxAmount ?? item.tax_amount ?? item.gst ?? 0);
}

function lineCogs(item = {}) {
  return money(item.cogs ?? item.productCost ?? item.product_cost ?? item.serviceConsumableCost ?? item.service_consumable_cost ?? item.cost ?? item.costPrice ?? item.cost_price ?? 0);
}

function invoiceTotal(row = {}) {
  return money(row.total ?? row.grandTotal ?? row.grand_total ?? row.final ?? row.amount ?? 0);
}

function invoicePaid(row = {}, payments = []) {
  const direct = row.paid ?? row.paidAmount ?? row.paid_amount;
  if (direct !== undefined && direct !== null && direct !== "") return money(direct);
  return money(payments.reduce((sum, payment) => sum + Number(payment.amount || payment.paidAmount || payment.paid_amount || 0), 0));
}

function invoiceDue(row = {}, payments = []) {
  const direct = row.balance ?? row.balanceDue ?? row.balance_due ?? row.dueAmount ?? row.due_amount ?? row.due;
  if (direct !== undefined && direct !== null && direct !== "") return money(Math.max(0, Number(direct)));
  return money(Math.max(0, invoiceTotal(row) - invoicePaid(row, payments)));
}

function invoiceDiscount(row = {}) {
  return money(row.discount ?? row.discountAmount ?? row.discount_amount ?? row.couponDiscount ?? row.coupon_discount ?? row.manualDiscount ?? row.manual_discount ?? 0);
}

function invoiceTip(row = {}) {
  return money(row.tipAmount ?? row.tip_amount ?? row.staffTip ?? row.staff_tip ?? row.tips ?? 0);
}

function clientIdOf(row = {}, fallback = {}) {
  return String(row.clientId || row.client_id || row.customerId || row.customer_id || fallback.clientId || fallback.client_id || "");
}

function clientDisplayName(row = {}) {
  return row.name || row.fullName || [row.firstName, row.lastName].filter(Boolean).join(" ") || row.clientName || row.customerName || "";
}

function clientPhone(row = {}) {
  return String(row.phone || row.mobile || row.contact || row.whatsapp || row.clientPhone || row.customerPhone || "");
}

function branchDisplayName(row = {}) {
  return row.name || row.branchName || row.title || row.id || "";
}

function appointmentIdOf(row = {}, fallback = {}) {
  return String(row.appointmentId || row.appointment_id || row.bookingId || row.booking_id || fallback.appointmentId || fallback.appointment_id || fallback.bookingId || fallback.booking_id || "");
}

function appointmentDateOf(appointment = {}, source = {}, invoice = {}) {
  return dayKey(
    appointment.startAt || appointment.start_at || appointment.date || appointment.appointmentDate || appointment.appointment_date ||
    source.appointmentDate || source.appointment_date || invoice.appointmentDate || invoice.appointment_date
  );
}

function blankStaff(staffId, staffName = "") {
  return {
    staffId: staffId || "unassigned",
    staffName: staffName || (staffId ? staffId : "Unassigned"),
    staffCode: "",
    contact: "",
    totalRevenue: 0,
    itemCount: 0,
    serviceRevenue: 0,
    serviceCount: 0,
    productRevenue: 0,
    productCount: 0,
    membershipRevenue: 0,
    membershipCount: 0,
    packageRevenue: 0,
    packageCount: 0,
    giftCardRevenue: 0,
    giftCardCount: 0,
    customRevenue: 0,
    customCount: 0,
    clientsCount: 0,
    invoiceCount: 0,
    averageBill: 0,
    pendingDue: 0,
    discountGiven: 0,
    tips: 0,
    estimatedCommission: 0,
    performanceScore: 0,
    serviceBreakdown: [],
    productBreakdown: [],
    serviceSaleRows: [],
    serviceQty: 0,
    serviceClientsCount: 0,
    serviceInvoiceCount: 0,
    grossServiceSale: 0,
    finalServiceSale: 0,
    serviceDiscountAmount: 0,
    serviceDiscountPercent: 0,
    staffServiceShareBeforeDiscount: 0,
    staffServiceShareAfterDiscount: 0
  };
}

function staffDisplayName(row = {}) {
  return row.fullName || row.name || [row.firstName, row.lastName].filter(Boolean).join(" ") || row.shortName || row.id || "";
}

function staffCode(row = {}) {
  return String(row.staffCode || row.staff_code || row.employeeCode || row.employee_code || row.code || row.id || "");
}

function staffContact(row = {}) {
  return String(row.phone || row.mobile || row.contact || row.whatsapp || row.email || "");
}

function staffLookup(branchId, access = {}) {
  const staffById = new Map();
  for (const person of repositories.staff.list({ limit: 10000 }, { tenantId: access.tenantId })) {
    if (person?.id) staffById.set(person.id, { ...person, name: staffDisplayName(person) || person.name || person.id });
  }
  try {
    for (const person of staffOsService.listStaff({ branchId, status: "active", limit: 200 }, access)) {
      if (person?.id) staffById.set(person.id, { ...person, name: staffDisplayName(person) || person.id });
    }
  } catch {
    // Existing staff repository remains the fallback while Staff OS is being migrated.
  }
  return staffById;
}

function attributionRows(item = {}, sale = {}, amount = 0, staffById = new Map()) {
  const rawSplits = Array.isArray(item.staffSplits) ? item.staffSplits.filter((split) => split?.staffId) : [];
  if (rawSplits.length) {
    const totalShare = rawSplits.reduce((sum, split) => sum + Number(split.share || Number(split.percent || 0) / 100 || 0), 0);
    let allocated = 0;
    return rawSplits.map((split, index) => {
      const rawShare = Number(split.share || Number(split.percent || 0) / 100 || 0);
      const share = totalShare > 0 ? rawShare / totalShare : 1 / rawSplits.length;
      const splitAmount = index === rawSplits.length - 1 ? money(amount - allocated) : money(amount * share);
      allocated = money(allocated + splitAmount);
      const staffRecord = staffById.get(split.staffId);
      return {
        staffId: split.staffId,
        staffName: split.staffName || staffRecord?.name || split.staffId,
        amount: splitAmount,
        sharePercent: money(share * 100),
        sourceStaffId: rawSplits.length > 1 ? "split_attribution" : "line_item"
      };
    });
  }

  const staffId = item.staffId || item.staff_id || item.assignedStaffId || item.assigned_staff_id || sale.staffId || sale.staff_id || "";
  const staffRecord = staffById.get(staffId);
  return [{
    staffId: staffId || "unassigned",
    staffName: item.staffName || item.staff_name || item.assignedStaffName || item.assigned_staff_name || sale.staffName || sale.staff_name || staffRecord?.name || staffId || "Unassigned",
    amount,
    sharePercent: 100,
    sourceStaffId: (item.staffId || item.staff_id || item.assignedStaffId || item.assigned_staff_id) ? "line_item" : "invoice_fallback"
  }];
}

function addDocumentItems({
  source,
  items,
  sourceType,
  staffMap,
  itemRows,
  staffById,
  invoicesById = new Map(),
  clientsById = new Map(),
  branchesById = new Map(),
  appointmentsById = new Map(),
  paymentsByInvoice = new Map()
}) {
  let itemCount = 0;
  for (const [itemIndex, item] of items.entries()) {
    const type = normalizedItemType(item);
    const quantity = Number(item.quantity || item.qty || 1);
    const amount = lineAmount(item);
    if (!amount) continue;
    const grossSale = lineGross(item);
    const discount = lineDiscount(item, grossSale, amount);
    const gst = lineGst(item);
    const cogs = lineCogs(item);
    const splits = attributionRows(item, source, amount, staffById);
    const invoice = invoicesById.get(String(source.invoiceId || source.invoice_id || source.id || "")) || {};
    const invoiceId = sourceType === "invoice" ? source.id : source.invoiceId || source.invoice_id || "";
    const invoiceNumber = source.invoiceNumber || source.invoice_number || invoice.invoiceNumber || invoice.invoice_number || invoiceId;
    const clientId = clientIdOf(source, invoice);
    const client = clientsById.get(String(clientId)) || {};
    const branchId = source.branchId || source.branch_id || invoice.branchId || invoice.branch_id || "";
    const branch = branchesById.get(String(branchId)) || {};
    const appointmentId = appointmentIdOf(source, invoice);
    const appointment = appointmentsById.get(String(appointmentId)) || {};
    const invoiceCreatedAt = source.createdAt || source.created_at || invoice.createdAt || invoice.created_at || source.invoiceDate || source.invoice_date || invoice.invoiceDate || invoice.invoice_date || source.updatedAt || source.updated_at || invoice.updatedAt || invoice.updated_at;
    const invoiceDateValue = source.invoiceDate || source.invoice_date || invoice.invoiceDate || invoice.invoice_date || invoiceCreatedAt;
    const invoiceParts = dateTimeParts(invoiceDateValue || invoiceCreatedAt);
    const createdParts = dateTimeParts(invoiceCreatedAt);
    const dueAmount = invoiceDue(Object.keys(invoice).length ? invoice : source, paymentsByInvoice.get(String(invoiceId)) || []);
    const saleType = appointmentId || appointmentDateOf(appointment, source, invoice) ? "Appointment" : "Quick Sale";
    const invoicePayments = paymentsByInvoice.get(String(invoiceId)) || [];
    const paymentMode = paymentModeFor(Object.keys(invoice).length ? invoice : source, invoicePayments);
    const transactionId = transactionIdFor(Object.keys(invoice).length ? invoice : source, invoicePayments);
    const lineKey = [
      sourceType,
      source.id || invoiceId || source.saleId || "source",
      item.id || item.itemId || item.item_id || item.serviceId || item.service_id || item.productId || item.product_id || itemIndex
    ].join(":");
    const discountPercent = grossSale > 0 ? money((discount / grossSale) * 100) : 0;

    for (const split of splits) {
      const key = split.staffId && split.staffId !== "unassigned"
        ? split.staffId
        : `name:${normalizeKey(split.staffName) || "unassigned"}`;

      if (!staffMap.has(key)) staffMap.set(key, blankStaff(key, split.staffName));
      const summary = staffMap.get(key);
      const staffRecord = staffById.get(split.staffId) || staffById.get(key) || {};
      summary.staffName = split.staffName;
      summary.staffCode = summary.staffCode || staffCode(staffRecord);
      summary.contact = summary.contact || staffContact(staffRecord);
      summary.totalRevenue = money(summary.totalRevenue + split.amount);
      summary.itemCount += 1;

      const revenueKey = `${type === "gift_card" ? "giftCard" : type}Revenue`;
      const countKey = `${type === "gift_card" ? "giftCard" : type}Count`;
      if (revenueKey in summary) summary[revenueKey] = money(summary[revenueKey] + split.amount);
      if (countKey in summary) summary[countKey] += 1;

      itemRows.push({
        saleId: sourceType === "sale" ? source.id : source.saleId || "",
        invoiceId,
        invoiceNumber,
        date: invoiceParts.date || createdParts.date,
        time: invoiceParts.time || createdParts.time,
        invoiceDate: invoiceParts.date || createdParts.date,
        invoiceTime: invoiceParts.time || createdParts.time,
        appointmentId,
        appointmentDate: appointmentDateOf(appointment, source, invoice),
        createdDate: createdParts.date,
        createdTime: createdParts.time,
        branchId,
        branchName: branchDisplayName(branch) || branchId || "-",
        staffId: key,
        staffName: split.staffName,
        clientId,
        clientName: clientDisplayName(client) || source.clientName || source.customerName || invoice.clientName || invoice.customerName || "Walk-in",
        clientPhone: clientPhone(client) || source.clientPhone || source.customerPhone || invoice.clientPhone || invoice.customerPhone || "-",
        itemType: type,
        itemTypeLabel: categoryLabels[type] || "Item",
        itemId: item.id || item.itemId || item.item_id || item.serviceId || item.service_id || item.productId || item.product_id || "",
        itemName: item.name || item.itemName || item.item_name || item.id || "Item",
        itemCategory: item.category || item.group || item.serviceGroup || item.service_group || item.productCategory || item.product_category || type,
        serviceGroup: item.category || item.group || item.serviceGroup || item.service_group || type,
        quantity,
        price: Number(item.price || item.rate || item.unitPrice || item.unit_price || 0),
        grossSale: money(grossSale * (split.sharePercent / 100)),
        discount: money(discount * (split.sharePercent / 100)),
        netSale: split.amount,
        gst: money(gst * (split.sharePercent / 100)),
        cogs: money(cogs * (split.sharePercent / 100)),
        dueAmount: money(dueAmount * (split.sharePercent / 100)),
        lineKey,
        lineGrossAmount: grossSale,
        lineDiscountAmount: discount,
        lineFinalAmount: amount,
        serviceShareBeforeDiscount: money(grossSale * (split.sharePercent / 100)),
        serviceShareAfterDiscount: split.amount,
        discountPercent,
        paymentMode,
        transactionId,
        lineAmount: amount,
        amount: split.amount,
        sharePercent: split.sharePercent,
        saleType,
        sourceStaffId: split.sourceStaffId,
        sourceType
      });
      itemCount += 1;
    }
  }
  return itemCount;
}

function paymentInvoiceId(payment = {}) {
  return String(payment.invoiceId || payment.invoice_id || "");
}

function firstPresent(row = {}, keys = []) {
  for (const key of keys) {
    const value = row[key];
    if (value !== undefined && value !== null && value !== "") return String(value);
  }
  return "";
}

function uniqueJoined(values = []) {
  const clean = values.map((value) => String(value || "").trim()).filter(Boolean);
  return [...new Set(clean)].join(", ") || "-";
}

function paymentModeFor(invoice = {}, payments = []) {
  return uniqueJoined([
    ...payments.map((payment) => firstPresent(payment, ["paymentMode", "payment_mode", "mode", "method", "type", "channel"])),
    firstPresent(invoice, ["paymentMode", "payment_mode", "mode", "paymentMethod", "payment_method"])
  ]);
}

function transactionIdFor(invoice = {}, payments = []) {
  return uniqueJoined([
    ...payments.map((payment) => firstPresent(payment, ["transactionId", "transaction_id", "paymentId", "payment_id", "referenceNo", "reference_no", "reference", "utr", "id"])),
    firstPresent(invoice, ["transactionId", "transaction_id", "paymentReference", "payment_reference", "referenceNo", "reference_no"])
  ]);
}

function normalizedDiscountMode(value = "") {
  const mode = String(value || "").trim();
  return ["with_discount", "without_discount", "compare"].includes(mode) ? mode : "with_discount";
}

function matchesItemFilters(row = {}, query = {}) {
  const staffId = String(query.staffId || "").trim();
  if (staffId && ![row.staffId, row.staffName].map(String).includes(staffId)) return false;
  const saleType = String(query.saleType || "").trim();
  if (saleType && row.itemType !== saleType) return false;
  const serviceSaleType = String(query.serviceSaleType || "").trim();
  if (serviceSaleType) {
    if (row.itemType !== "service") return false;
    const normalizedSaleType = String(row.saleType || "").toLowerCase().includes("appointment") ? "appointment" : "quick_sale";
    if (serviceSaleType !== "all" && normalizedSaleType !== serviceSaleType) return false;
  }
  const dueStatus = String(query.dueStatus || "").trim();
  if (dueStatus) {
    if (row.itemType !== "service") return false;
    const hasDue = Number(row.dueAmount || 0) > 0;
    if (dueStatus === "pending" && !hasDue) return false;
    if (dueStatus === "clear" && hasDue) return false;
  }
  const client = String(query.client || query.clientId || "").trim().toLowerCase();
  if (client && !`${row.clientId} ${row.clientName} ${row.clientPhone}`.toLowerCase().includes(client)) return false;
  const service = String(query.service || query.serviceId || "").trim().toLowerCase();
  if (service && row.itemType === "service" && !`${row.itemId} ${row.itemName}`.toLowerCase().includes(service)) return false;
  if (service && row.itemType !== "service") return false;
  const product = String(query.product || query.productId || "").trim().toLowerCase();
  if (product && row.itemType === "product" && !`${row.itemId} ${row.itemName}`.toLowerCase().includes(product)) return false;
  if (product && row.itemType !== "product") return false;
  const category = String(query.category || "").trim().toLowerCase();
  if (category && !`${row.itemCategory} ${row.itemType}`.toLowerCase().includes(category)) return false;
  const q = String(query.q || query.query || "").trim().toLowerCase();
  if (q) {
    const haystack = `${row.staffName} ${row.itemName} ${row.itemCategory} ${row.invoiceNumber} ${row.clientId} ${row.clientName} ${row.clientPhone} ${row.branchName} ${row.saleType} ${row.itemTypeLabel}`.toLowerCase();
    if (!haystack.includes(q)) return false;
  }
  return true;
}

function serviceSaleRow(row = {}, discountMode = "with_discount") {
  const grossPrice = money(row.lineGrossAmount || row.grossSale || 0);
  const discountAmount = money(row.lineDiscountAmount || row.discount || 0);
  const finalPrice = money(row.lineFinalAmount || row.lineAmount || row.amount || row.netSale || 0);
  const serviceShareBeforeDiscount = money(row.serviceShareBeforeDiscount || row.grossSale || 0);
  const serviceShareAfterDiscount = money(row.serviceShareAfterDiscount || row.amount || row.netSale || 0);
  const displayTotal = discountMode === "without_discount" ? serviceShareBeforeDiscount : serviceShareAfterDiscount;
  return {
    serviceName: row.itemName || "Service",
    serviceId: row.itemId || "",
    serviceGroup: row.serviceGroup || row.itemCategory || "Service",
    qty: Number(row.quantity || 0),
    quantity: Number(row.quantity || 0),
    total: displayTotal,
    displayTotal,
    grossPrice,
    discountAmount,
    finalPrice,
    serviceShareBeforeDiscount,
    serviceShareAfterDiscount,
    discountPercent: Number(row.discountPercent || (grossPrice > 0 ? money((discountAmount / grossPrice) * 100) : 0)),
    paymentMode: row.paymentMode || "-",
    transactionId: row.transactionId || "-",
    lineKey: row.lineKey || "",
    invoiceId: row.invoiceId || "",
    invoiceNumber: row.invoiceNumber || "",
    invoiceDate: row.invoiceDate || row.date || "",
    invoiceTime: row.invoiceTime || row.time || "",
    appointmentId: row.appointmentId || "",
    appointmentDate: row.appointmentDate || "",
    createdDate: row.createdDate || "",
    createdTime: row.createdTime || "",
    customerName: row.clientName || "Walk-in",
    customerContact: row.clientPhone || "-",
    clientId: row.clientId || "",
    clientName: row.clientName || "Walk-in",
    clientPhone: row.clientPhone || "-",
    branchId: row.branchId || "",
    branchName: row.branchName || "-",
    saleType: row.saleType || "Quick Sale",
    staffId: row.staffId || "",
    staffName: row.staffName || "Unassigned",
    staffSharePercent: Number(row.sharePercent || 100),
    discount: money(row.discount || 0),
    gst: money(row.gst || 0),
    dueAmount: money(row.dueAmount || 0),
    actionInvoiceId: row.invoiceId || "",
    actionClientId: row.clientId || ""
  };
}

function serviceDiscountTotals(rows = []) {
  const totals = rows.reduce((acc, row) => {
    acc.grossServiceSale = money(acc.grossServiceSale + Number(row.serviceShareBeforeDiscount || row.grossPrice || 0));
    acc.finalServiceSale = money(acc.finalServiceSale + Number(row.serviceShareAfterDiscount || row.finalPrice || row.total || 0));
    acc.serviceDiscountAmount = money(acc.serviceDiscountAmount + Math.max(0, Number(row.serviceShareBeforeDiscount || 0) - Number(row.serviceShareAfterDiscount || 0)));
    acc.staffServiceShareBeforeDiscount = money(acc.staffServiceShareBeforeDiscount + Number(row.serviceShareBeforeDiscount || 0));
    acc.staffServiceShareAfterDiscount = money(acc.staffServiceShareAfterDiscount + Number(row.serviceShareAfterDiscount || 0));
    return acc;
  }, {
    grossServiceSale: 0,
    finalServiceSale: 0,
    serviceDiscountAmount: 0,
    serviceDiscountPercent: 0,
    staffServiceShareBeforeDiscount: 0,
    staffServiceShareAfterDiscount: 0
  });
  totals.serviceDiscountPercent = totals.grossServiceSale > 0 ? money((totals.serviceDiscountAmount / totals.grossServiceSale) * 100) : 0;
  return totals;
}

function breakdownRows(rows = [], type = "service") {
  const map = new Map();
  for (const row of rows.filter((item) => item.itemType === type)) {
    const key = `${row.itemId || ""}|${row.itemName || "Item"}`;
    if (!map.has(key)) {
      map.set(key, {
        itemId: row.itemId || "",
        serviceName: row.itemName || "Service",
        productName: row.itemName || "Product",
        quantity: 0,
        grossSale: 0,
        discount: 0,
        netSale: 0,
        gst: 0,
        cogs: 0,
        grossMargin: 0,
        marginPercent: 0,
        clientCount: 0,
        repeatClientCount: 0,
        lastSoldAt: "",
        costSignal: "ok",
        _clients: new Map()
      });
    }
    const target = map.get(key);
    target.quantity = money(target.quantity + Number(row.quantity || 0));
    target.grossSale = money(target.grossSale + Number(row.grossSale || 0));
    target.discount = money(target.discount + Number(row.discount || 0));
    target.netSale = money(target.netSale + Number(row.netSale || row.amount || 0));
    target.gst = money(target.gst + Number(row.gst || 0));
    target.cogs = money(target.cogs + Number(row.cogs || 0));
    if (row.clientId) target._clients.set(row.clientId, (target._clients.get(row.clientId) || 0) + 1);
    if (!target.lastSoldAt || String(row.date || "") > target.lastSoldAt) target.lastSoldAt = String(row.date || "");
  }
  return [...map.values()].map((row) => {
    row.grossMargin = money(Number(row.netSale || 0) - Number(row.gst || 0) - Number(row.cogs || 0));
    row.marginPercent = row.netSale ? money((row.grossMargin / row.netSale) * 100) : 0;
    row.clientCount = row._clients.size;
    row.repeatClientCount = [...row._clients.values()].filter((count) => count > 1).length;
    row.costSignal = row.cogs > 0 ? "ok" : "missing_cost";
    delete row._clients;
    return row;
  }).sort((a, b) => b.netSale - a.netSale || String(a.serviceName || a.productName).localeCompare(String(b.serviceName || b.productName)));
}

function performanceScore(row = {}) {
  const revenueScore = Math.min(40, Math.floor(Number(row.totalRevenue || 0) / 2500));
  const clientScore = Math.min(20, Number(row.clientsCount || 0) * 2);
  const marginScore = Math.max(0, Math.min(20, Math.round((Number(row.totalRevenue || 0) - Number(row.pendingDue || 0)) / Math.max(1, Number(row.totalRevenue || 1)) * 20)));
  const collectionPenalty = Number(row.pendingDue || 0) > 0 ? 10 : 0;
  const discountPenalty = Number(row.discountGiven || 0) > Number(row.totalRevenue || 0) * 0.15 ? 10 : 0;
  return Math.max(0, Math.min(100, revenueScore + clientScore + marginScore + 30 - collectionPenalty - discountPenalty));
}

function commissionEstimate(row = {}) {
  return money(Number(row.serviceRevenue || 0) * 0.1 + Number(row.productRevenue || 0) * 0.05 + (Number(row.membershipRevenue || 0) + Number(row.packageRevenue || 0)) * 0.03);
}

export class StaffSalesReportService {
  report(query = {}, access = {}) {
    const branchId = String(query.branchId || "").trim();
    if (branchId) tenantService.assertBranchAccess(access, branchId);

    const scope = tenantService.accessScope(access, "reports");
    const salesScope = { ...scope, ...(branchId ? { branchId } : {}) };
    const staffById = staffLookup(branchId, access);
    const from = String(query.from || query.dateFrom || "").slice(0, 10);
    const to = String(query.to || query.dateTo || "").slice(0, 10);

    const sales = repositories.sales
      .list({ limit: Number(query.limit || 10000) }, salesScope)
      .filter((sale) => inDateRange(sale, from, to));
    const invoices = repositories.invoices
      .list({ limit: Number(query.limit || 10000) }, salesScope)
      .filter((invoice) => inDateRange(invoice, from, to));
    const invoicesById = new Map(invoices.map((invoice) => [String(invoice.id || ""), invoice]));
    const branchQuery = branchId ? { branchId, limit: 10000 } : { limit: 10000 };
    const clientsById = new Map(repositories.clients.list(branchQuery, scope).map((client) => [String(client.id || ""), client]));
    const branchesById = new Map(repositories.branches.list({ limit: 10000 }, scope).map((branch) => [String(branch.id || ""), branch]));
    const appointmentsById = new Map(repositories.appointments.list(branchQuery, salesScope).map((appointment) => [String(appointment.id || ""), appointment]));
    const payments = repositories.payments
      .list({ limit: Number(query.limit || 10000) }, salesScope);
    const paymentsByInvoice = new Map();
    for (const payment of payments) {
      const invoiceId = paymentInvoiceId(payment);
      if (!invoiceId) continue;
      paymentsByInvoice.set(invoiceId, [...(paymentsByInvoice.get(invoiceId) || []), payment]);
    }

    const staffMap = new Map();
    const itemRows = [];
    const coveredInvoices = new Set();

    for (const sale of sales) {
      const saleItems = Array.isArray(sale.items) ? sale.items : [];
      if (addDocumentItems({ source: sale, items: saleItems, sourceType: "sale", staffMap, itemRows, staffById, invoicesById, clientsById, branchesById, appointmentsById, paymentsByInvoice })) {
        if (sale.invoiceId) coveredInvoices.add(sale.invoiceId);
      }
    }

    for (const invoice of invoices) {
      if (coveredInvoices.has(invoice.id)) continue;
      const items = readArray(invoice.lineItems).length
        ? readArray(invoice.lineItems)
        : readArray(invoice.items || invoice.line_items || invoice.invoiceItems || invoice.invoice_items);
      addDocumentItems({ source: invoice, items, sourceType: "invoice", staffMap, itemRows, staffById, invoicesById, clientsById, branchesById, appointmentsById, paymentsByInvoice });
    }

    const discountMode = normalizedDiscountMode(query.discountMode);
    const filteredItems = itemRows.filter((row) => matchesItemFilters(row, query));
    const serviceSaleRows = filteredItems
      .filter((row) => row.itemType === "service")
      .map((row) => serviceSaleRow(row, discountMode))
      .sort((a, b) => String(b.invoiceDate || b.createdDate).localeCompare(String(a.invoiceDate || a.createdDate)) || String(b.invoiceTime || "").localeCompare(String(a.invoiceTime || "")));
    const filteredStaffMap = new Map();
    for (const item of filteredItems) {
      if (!filteredStaffMap.has(item.staffId)) {
        const staffRecord = staffById.get(item.staffId) || {};
        filteredStaffMap.set(item.staffId, {
          ...blankStaff(item.staffId, item.staffName),
          staffCode: staffCode(staffRecord),
          contact: staffContact(staffRecord),
          _clientIds: new Set(),
          _invoiceIds: new Set()
        });
      }
      const row = filteredStaffMap.get(item.staffId);
      row.staffName = item.staffName || row.staffName;
      row.totalRevenue = money(row.totalRevenue + Number(item.amount || 0));
      row.itemCount += 1;
      const revenueKey = `${item.itemType === "gift_card" ? "giftCard" : item.itemType}Revenue`;
      const countKey = `${item.itemType === "gift_card" ? "giftCard" : item.itemType}Count`;
      if (revenueKey in row) row[revenueKey] = money(row[revenueKey] + Number(item.amount || 0));
      if (countKey in row) row[countKey] += 1;
      if (item.clientId) row._clientIds.add(item.clientId);
      if (item.invoiceId || item.saleId) row._invoiceIds.add(item.invoiceId || item.saleId);
    }

    const itemsByInvoice = new Map();
    for (const item of filteredItems.filter((row) => row.invoiceId)) {
      itemsByInvoice.set(item.invoiceId, [...(itemsByInvoice.get(item.invoiceId) || []), item]);
    }
    for (const [invoiceId, rowsForInvoice] of itemsByInvoice.entries()) {
      const invoice = invoicesById.get(String(invoiceId)) || {};
      const invoicePayments = paymentsByInvoice.get(String(invoiceId)) || [];
      const due = invoiceDue(invoice, invoicePayments);
      const discount = invoiceDiscount(invoice) || money(rowsForInvoice.reduce((sum, row) => sum + Number(row.discount || 0), 0));
      const tips = invoiceTip(invoice);
      const invoiceTotalForRows = rowsForInvoice.reduce((sum, row) => sum + Number(row.amount || 0), 0);
      const staffTotals = new Map();
      for (const item of rowsForInvoice) staffTotals.set(item.staffId, money((staffTotals.get(item.staffId) || 0) + Number(item.amount || 0)));
      for (const [staffId, amount] of staffTotals.entries()) {
        const row = filteredStaffMap.get(staffId);
        if (!row) continue;
        const share = invoiceTotalForRows > 0 ? amount / invoiceTotalForRows : 1 / staffTotals.size;
        row.pendingDue = money(row.pendingDue + due * share);
        row.discountGiven = money(row.discountGiven + discount * share);
        row.tips = money(row.tips + tips * share);
      }
    }

    let rows = [...filteredStaffMap.values()].map((row) => {
      const staffItems = filteredItems.filter((item) => item.staffId === row.staffId);
      row.clientsCount = row._clientIds.size;
      row.invoiceCount = row._invoiceIds.size;
      row.averageBill = row.invoiceCount ? money(row.totalRevenue / row.invoiceCount) : 0;
      row.estimatedCommission = commissionEstimate(row);
      row.serviceBreakdown = breakdownRows(staffItems, "service");
      row.productBreakdown = breakdownRows(staffItems, "product");
      row.serviceSaleRows = serviceSaleRows.filter((serviceRow) => serviceRow.staffId === row.staffId);
      row.serviceQty = money(row.serviceSaleRows.reduce((sum, serviceRow) => sum + Number(serviceRow.qty || 0), 0));
      row.serviceClientsCount = new Set(row.serviceSaleRows.map((serviceRow) => serviceRow.clientId || serviceRow.clientPhone || serviceRow.clientName).filter(Boolean)).size;
      row.serviceInvoiceCount = new Set(row.serviceSaleRows.map((serviceRow) => serviceRow.invoiceId || serviceRow.invoiceNumber).filter(Boolean)).size;
      Object.assign(row, serviceDiscountTotals(row.serviceSaleRows));
      row.performanceScore = performanceScore(row);
      delete row._clientIds;
      delete row._invoiceIds;
      return row;
    });

    const commissionStatus = String(query.commissionStatus || "").trim();
    if (commissionStatus === "commission_due") rows = rows.filter((row) => row.estimatedCommission > 0);
    if (commissionStatus === "no_commission") rows = rows.filter((row) => row.estimatedCommission <= 0);
    const performanceBucket = String(query.performanceBucket || "").trim();
    if (performanceBucket === "high") rows = rows.filter((row) => row.performanceScore >= 75);
    if (performanceBucket === "medium") rows = rows.filter((row) => row.performanceScore >= 45 && row.performanceScore < 75);
    if (performanceBucket === "low") rows = rows.filter((row) => row.performanceScore < 45);
    rows = rows.sort((a, b) => b.totalRevenue - a.totalRevenue || a.staffName.localeCompare(b.staffName));

    const totals = rows.reduce((acc, row) => {
      acc.totalRevenue = money(acc.totalRevenue + row.totalRevenue);
      acc.itemCount += row.itemCount;
      acc.serviceRevenue = money(acc.serviceRevenue + row.serviceRevenue);
      acc.productRevenue = money(acc.productRevenue + row.productRevenue);
      acc.membershipRevenue = money(acc.membershipRevenue + row.membershipRevenue);
      acc.packageRevenue = money(acc.packageRevenue + row.packageRevenue);
      acc.giftCardRevenue = money(acc.giftCardRevenue + row.giftCardRevenue);
      acc.customRevenue = money(acc.customRevenue + row.customRevenue);
      acc.clientsCount += row.clientsCount;
      acc.invoiceCount += row.invoiceCount;
      acc.pendingDue = money(acc.pendingDue + row.pendingDue);
      acc.discountGiven = money(acc.discountGiven + row.discountGiven);
      acc.tips = money(acc.tips + row.tips);
      acc.estimatedCommission = money(acc.estimatedCommission + row.estimatedCommission);
      acc.serviceQty = money(acc.serviceQty + Number(row.serviceQty || 0));
      acc.serviceSaleRows += Number(row.serviceSaleRows?.length || 0);
      acc.serviceClientsCount += Number(row.serviceClientsCount || 0);
      acc.serviceInvoiceCount += Number(row.serviceInvoiceCount || 0);
      acc.grossServiceSale = money(acc.grossServiceSale + Number(row.grossServiceSale || 0));
      acc.finalServiceSale = money(acc.finalServiceSale + Number(row.finalServiceSale || 0));
      acc.serviceDiscountAmount = money(acc.serviceDiscountAmount + Number(row.serviceDiscountAmount || 0));
      acc.staffServiceShareBeforeDiscount = money(acc.staffServiceShareBeforeDiscount + Number(row.staffServiceShareBeforeDiscount || 0));
      acc.staffServiceShareAfterDiscount = money(acc.staffServiceShareAfterDiscount + Number(row.staffServiceShareAfterDiscount || 0));
      return acc;
    }, {
      totalRevenue: 0,
      itemCount: 0,
      serviceRevenue: 0,
      productRevenue: 0,
      membershipRevenue: 0,
      packageRevenue: 0,
      giftCardRevenue: 0,
      customRevenue: 0,
      clientsCount: 0,
      invoiceCount: 0,
      averageBill: 0,
      pendingDue: 0,
      discountGiven: 0,
      tips: 0,
      estimatedCommission: 0,
      serviceQty: 0,
      serviceSaleRows: 0,
      serviceClientsCount: 0,
      serviceInvoiceCount: 0,
      grossServiceSale: 0,
      finalServiceSale: 0,
      serviceDiscountAmount: 0,
      serviceDiscountPercent: 0,
      staffServiceShareBeforeDiscount: 0,
      staffServiceShareAfterDiscount: 0
    });
    totals.averageBill = totals.invoiceCount ? money(totals.totalRevenue / totals.invoiceCount) : 0;
    totals.serviceDiscountPercent = totals.grossServiceSale > 0 ? money((totals.serviceDiscountAmount / totals.grossServiceSale) * 100) : 0;

    return {
      filters: {
        branchId,
        from,
        to,
        staffId: query.staffId || "",
        service: query.service || query.serviceId || "",
        product: query.product || query.productId || "",
        category: query.category || "",
        saleType: query.saleType || "",
        serviceSaleType: query.serviceSaleType || "",
        discountMode,
        dueStatus: query.dueStatus || "",
        client: query.client || query.clientId || "",
        commissionStatus: query.commissionStatus || "",
        performanceBucket: query.performanceBucket || "",
        q: query.q || query.query || ""
      },
      totals,
      staff: rows,
      serviceSaleRows,
      items: filteredItems.sort((a, b) => String(b.date).localeCompare(String(a.date)))
    };
  }
}

export const staffSalesReportService = new StaffSalesReportService();

// Additive raw attribution feed for self-scoped staff reporting. Existing report
// behavior remains unchanged; callers decide how to aggregate and normalize money.
export function attributedSalesItems({ sales = [], invoices = [], appointments = [], staff = [] } = {}) {
  const staffById = new Map(staff.map((row) => [String(row.id), row]));
  const invoicesById = new Map(invoices.map((row) => [String(row.id), row]));
  const appointmentsById = new Map(appointments.map((row) => [String(row.id), row]));
  const staffMap = new Map();
  const itemRows = [];
  const coveredInvoices = new Set();

  for (const sale of sales) {
    const invoice = invoicesById.get(String(sale.invoiceId || '')) || null;
    const appointment = appointmentsById.get(String(sale.appointmentId || invoice?.appointmentId || '')) || null;
    const items = readArray(sale.items || sale.lineItems || sale.lines || sale.cartItems);
    addDocumentItems({
      source: sale,
      sourceType: "sale",
      items,
      staffMap,
      itemRows,
      staffById,
      invoicesById,
      appointmentsById
    });
    if (invoice?.id) coveredInvoices.add(String(invoice.id));
  }

  for (const invoice of invoices) {
    if (coveredInvoices.has(String(invoice.id))) continue;
    const items = readArray(invoice.lineItems || invoice.items || invoice.lines);
    addDocumentItems({
      source: invoice,
      sourceType: "invoice",
      items,
      staffMap,
      itemRows,
      staffById,
      invoicesById,
      appointmentsById
    });
  }

  return itemRows;
}
