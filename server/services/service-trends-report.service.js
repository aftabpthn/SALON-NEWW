import { db, DEFAULT_TENANT_ID, listRows } from "../db.js";
import { tenantService } from "./tenant.service.js";

const money = (value) => Math.round((Number(value) || 0) * 100) / 100;
const serviceTypes = new Set(["service", "package_redeem", "custom"]);
const excludedStatuses = new Set(["deleted", "voided", "cancelled", "canceled"]);

function dateMs(value = "") {
  const time = new Date(String(value || "")).getTime();
  return Number.isFinite(time) ? time : 0;
}

function dateKey(value = "") {
  const time = dateMs(value);
  return time ? new Date(time).toISOString().slice(0, 10) : "";
}

function timeLabel(value = "") {
  const time = dateMs(value);
  return time
    ? new Date(time).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true, timeZone: "Asia/Kolkata" })
    : "";
}

function readArray(value) {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  try {
    const parsed = JSON.parse(String(value));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function normalizedType(item = {}) {
  const raw = String(item.type || item.itemType || item.kind || item.category || item.name || "").toLowerCase();
  if (raw.includes("membership")) return "membership";
  if (raw.includes("gift")) return "gift_card";
  if (raw.includes("product") || raw.includes("retail")) return "product";
  if (raw.includes("package") && !raw.includes("redeem")) return "package";
  if (raw.includes("service") || raw.includes("package_redeem")) return "service";
  return "service";
}

function lineRate(item = {}) {
  const explicit = item.rate ?? item.price ?? item.unitPrice ?? item.unit_price ?? item.sellingPrice ?? item.selling_price ?? item.mrp;
  if (explicit !== undefined && explicit !== null && explicit !== "") return money(explicit);
  const qty = Number(item.quantity || item.qty || 1) || 1;
  return money(Number(item.total || item.lineTotal || item.line_total || 0) / qty);
}

function lineGross(item = {}) {
  const explicit = item.gross ?? item.grossAmount ?? item.gross_amount ?? item.subtotal ?? item.lineSubtotal ?? item.line_subtotal;
  if (explicit !== undefined && explicit !== null && explicit !== "") return money(explicit);
  return money(lineRate(item) * Number(item.quantity || item.qty || 1));
}

function lineDiscount(item = {}, gross = 0, grossTotal = 0, invoiceDiscount = 0) {
  const explicit = item.discount ?? item.discountAmount ?? item.discount_amount ?? item.manualDiscount ?? item.manual_discount ?? item.lineDiscount ?? item.line_discount;
  if (explicit !== undefined && explicit !== null && explicit !== "") return money(explicit);
  if (invoiceDiscount <= 0 || grossTotal <= 0) return 0;
  return money((gross / grossTotal) * invoiceDiscount);
}

function lineGst(item = {}, taxable = 0, rate = 0) {
  const explicit = item.gstAmount ?? item.gst_amount ?? item.taxAmount ?? item.tax_amount ?? item.lineTax ?? item.line_tax;
  if (explicit !== undefined && explicit !== null && explicit !== "") return money(explicit);
  return money((taxable * rate) / 100);
}

function itemName(item = {}) {
  return String(item.name || item.serviceName || item.service_name || item.itemName || item.title || "Service").trim();
}

function itemServiceId(item = {}) {
  return String(item.serviceId || item.service_id || item.itemId || item.item_id || item.id || item.code || item.sku || "");
}

function serviceLookupKey(value = "") {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function tableExists(tableName) {
  return Boolean(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = @tableName").get({ tableName }));
}

function serviceCategory(item = {}, service = {}) {
  return String(item.group || item.serviceGroup || item.service_group || item.category || service.category || service.group || service.serviceGroup || "Services");
}

function hourLabel(value = "") {
  const time = dateMs(value);
  if (!time) return "";
  const date = new Date(time);
  const hour = Number(date.toLocaleString("en-IN", { hour: "2-digit", hour12: false, timeZone: "Asia/Kolkata" }));
  return `${String(hour).padStart(2, "0")}:00`;
}

function timeBucket(value = "") {
  const time = dateMs(value);
  if (!time) return "";
  const hour = Number(new Date(time).toLocaleString("en-IN", { hour: "2-digit", hour12: false, timeZone: "Asia/Kolkata" }));
  if (hour < 12) return "morning";
  if (hour < 17) return "afternoon";
  return "evening";
}

function branchOf(row = {}, sale = {}) {
  return String(row.branchId || row.branch_id || sale.branchId || sale.branch_id || "");
}

function productConsumeCosts(tenantId, branchId) {
  if (!tableExists("product_consume_drafts")) return new Map();
  const rows = db.prepare(`
    SELECT invoice_id AS invoiceId,
           service_id AS serviceId,
           service_name AS serviceName,
           SUM(COALESCE(actual_cost, expected_cost, 0)) AS cost
      FROM product_consume_drafts
     WHERE tenant_id = @tenantId
       AND (@branchId = '' OR branch_id = @branchId)
     GROUP BY invoice_id, service_id, service_name
  `).all({ tenantId, branchId: branchId || "" });
  const costs = new Map();
  for (const row of rows) {
    const invoiceId = String(row.invoiceId || "");
    const serviceId = String(row.serviceId || "");
    const nameKey = serviceLookupKey(row.serviceName || "");
    for (const key of [`${invoiceId}|${serviceId}`, `${invoiceId}|${nameKey}`]) {
      if (key.replace("|", "")) costs.set(key, money(row.cost || 0));
    }
  }
  return costs;
}

class ServiceTrendsReportService {
  report(query = {}, access = {}) {
    const tenantId = access.tenantId || DEFAULT_TENANT_ID;
    const branchId = String(query.branchId || access.branchId || "");
    if (branchId) tenantService.assertBranchAccess(access, branchId);

    const invoices = listRows("invoices", { tenantId, branchId, limit: Number(query.limit || 10000) || 10000 });
    const sales = listRows("sales", { tenantId, branchId, limit: 10000 });
    const clients = listRows("clients", { tenantId, branchId: "", limit: 10000 });
    const staff = listRows("staff", { tenantId, branchId: "", limit: 10000 });
    const services = listRows("services", { tenantId, branchId: "", limit: 20000 });

    const salesById = new Map(sales.map((sale) => [String(sale.id || ""), sale]));
    const clientsById = new Map(clients.map((client) => [String(client.id || ""), client]));
    const staffById = new Map(staff.map((person) => [String(person.id || ""), person]));
    const servicesById = new Map();
    const servicesByName = new Map();
    for (const service of services) {
      for (const id of [service.id, service.serviceId, service.service_id, service.code, service.sku]) {
        if (id !== undefined && id !== null && id !== "") servicesById.set(String(id), service);
      }
      const key = serviceLookupKey(service.name || service.serviceName || service.title || "");
      if (key) servicesByName.set(key, service);
    }

    const costs = productConsumeCosts(tenantId, branchId);
    const serviceLines = [];

    for (const invoice of invoices) {
      const status = String(invoice.status || invoice.payment_status || "").toLowerCase();
      if (excludedStatuses.has(status)) continue;
      const sale = salesById.get(String(invoice.saleId || invoice.sale_id || "")) || {};
      const createdAt = String(invoice.createdAt || invoice.created_at || invoice.date || sale.createdAt || sale.created_at || "");
      const invoiceDate = dateKey(createdAt);
      if (query.from && invoiceDate && invoiceDate < String(query.from)) continue;
      if (query.to && invoiceDate && invoiceDate > String(query.to)) continue;

      const items = readArray(invoice.lineItems?.length ? invoice.lineItems : invoice.line_items?.length ? invoice.line_items : sale.items);
      const grossTotal = money(items.reduce((sum, item) => sum + lineGross(item), 0));
      const invoiceDiscount = money(invoice.discount ?? invoice.discount_total ?? sale.discount ?? 0);
      const clientId = String(invoice.clientId || invoice.client_id || sale.clientId || sale.client_id || "");
      const client = clientsById.get(clientId) || {};
      const invoiceStaffId = String(invoice.staffId || invoice.staff_id || sale.staffId || sale.staff_id || "");
      const invoiceStaff = staffById.get(invoiceStaffId) || {};
      const invoiceId = String(invoice.id || invoice.invoiceId || invoice.invoice_id || "");

      for (const item of items) {
        const type = normalizedType(item);
        if (!serviceTypes.has(type)) continue;
        const serviceId = itemServiceId(item);
        const name = itemName(item);
        const service = servicesById.get(serviceId) || servicesByName.get(serviceLookupKey(name)) || {};
        const staffId = String(item.staffId || item.staff_id || item.assignedStaffId || item.assigned_staff_id || invoiceStaffId || "");
        const staffPerson = staffById.get(staffId) || invoiceStaff;
        const gross = lineGross(item);
        const discount = lineDiscount(item, gross, grossTotal, invoiceDiscount);
        const taxable = money(Math.max(0, gross - discount));
        const gstRate = money(item.gstRate ?? item.gst_rate ?? item.taxRate ?? item.tax_rate ?? item.gst ?? service.gstRate ?? service.gst_rate ?? 0);
        const gst = lineGst(item, taxable, gstRate);
        const cost = money(costs.get(`${invoiceId}|${serviceId}`) ?? costs.get(`${invoiceId}|${serviceLookupKey(name)}`) ?? 0);
        serviceLines.push({
          invoiceId,
          invoiceNumber: String(invoice.invoiceNumber || invoice.invoice_number || invoice.invoice_no || invoiceId),
          branchId: branchOf(invoice, sale),
          clientId,
          clientName: String(client.name || invoice.clientName || invoice.client_name || sale.clientName || "Walk-in"),
          staffId,
          staffName: String(item.staffName || item.staff_name || item.assignedStaffName || item.assigned_staff_name || staffPerson.name || "Unassigned"),
          serviceId,
          serviceName: name,
          serviceGroup: serviceCategory(item, service),
          quantity: money(item.quantity || item.qty || 1),
          gross,
          discount,
          netSale: taxable,
          gst,
          gstRate,
          productCost: cost,
          costStatus: cost > 0 ? "Cost linked" : "Cost missing",
          soldAt: createdAt,
          soldDate: invoiceDate,
          soldTime: timeLabel(createdAt),
          soldHour: hourLabel(createdAt),
          timeBucket: timeBucket(createdAt)
        });
      }
    }

    const rows = this.aggregate(serviceLines)
      .filter((row) => this.matches(row, query))
      .sort((a, b) => this.sortRows(a, b, String(query.sort || "revenue_desc")));
    return { summary: this.summary(rows), rows };
  }

  serviceClients(query = {}, access = {}) {
    const tenantId = access.tenantId || DEFAULT_TENANT_ID;
    const branchId = String(query.branchId || access.branchId || "");
    if (branchId) tenantService.assertBranchAccess(access, branchId);

    const invoices = listRows("invoices", { tenantId, branchId, limit: Number(query.limit || 10000) || 10000 });
    const sales = listRows("sales", { tenantId, branchId, limit: 10000 });
    const clients = listRows("clients", { tenantId, branchId: "", limit: 10000 });
    const staff = listRows("staff", { tenantId, branchId: "", limit: 10000 });
    const services = listRows("services", { tenantId, branchId: "", limit: 20000 });

    const salesById = new Map(sales.map((sale) => [String(sale.id || ""), sale]));
    const clientsById = new Map(clients.map((client) => [String(client.id || ""), client]));
    const staffById = new Map(staff.map((person) => [String(person.id || ""), person]));
    const servicesById = new Map();
    const servicesByName = new Map();
    for (const service of services) {
      for (const id of [service.id, service.serviceId, service.service_id, service.code, service.sku]) {
        if (id !== undefined && id !== null && id !== "") servicesById.set(String(id), service);
      }
      const key = serviceLookupKey(service.name || service.serviceName || service.title || "");
      if (key) servicesByName.set(key, service);
    }

    const rows = [];
    for (const invoice of invoices) {
      const status = String(invoice.status || invoice.payment_status || "").toLowerCase();
      if (excludedStatuses.has(status)) continue;
      const sale = salesById.get(String(invoice.saleId || invoice.sale_id || "")) || {};
      const createdAt = String(invoice.createdAt || invoice.created_at || invoice.date || sale.createdAt || sale.created_at || "");
      const invoiceDate = dateKey(createdAt);
      if (query.from && invoiceDate && invoiceDate < String(query.from)) continue;
      if (query.to && invoiceDate && invoiceDate > String(query.to)) continue;

      const items = readArray(invoice.lineItems?.length ? invoice.lineItems : invoice.line_items?.length ? invoice.line_items : sale.items);
      const grossTotal = money(items.reduce((sum, item) => sum + lineGross(item), 0));
      const invoiceDiscount = money(invoice.discount ?? invoice.discount_total ?? sale.discount ?? 0);
      const clientId = String(invoice.clientId || invoice.client_id || sale.clientId || sale.client_id || "");
      const client = clientsById.get(clientId) || {};
      const invoiceStaffId = String(invoice.staffId || invoice.staff_id || sale.staffId || sale.staff_id || "");
      const invoiceStaff = staffById.get(invoiceStaffId) || {};
      const invoiceId = String(invoice.id || invoice.invoiceId || invoice.invoice_id || "");
      const appointmentId = String(invoice.appointmentId || invoice.appointment_id || sale.appointmentId || sale.appointment_id || "");
      const saleType = appointmentId ? "Appointment" : "Quick Sale";

      for (const item of items) {
        const type = normalizedType(item);
        if (!serviceTypes.has(type)) continue;
        const serviceId = itemServiceId(item);
        const name = itemName(item);
        const service = servicesById.get(serviceId) || servicesByName.get(serviceLookupKey(name)) || {};
        const staffId = String(item.staffId || item.staff_id || item.assignedStaffId || item.assigned_staff_id || invoiceStaffId || "");
        const staffPerson = staffById.get(staffId) || invoiceStaff;
        const gross = lineGross(item);
        const discount = lineDiscount(item, gross, grossTotal, invoiceDiscount);
        const taxable = money(Math.max(0, gross - discount));
        const row = {
          date: invoiceDate,
          time: timeLabel(createdAt),
          soldAt: createdAt,
          serviceGroup: serviceCategory(item, service),
          serviceId,
          serviceName: name,
          clientId,
          clientName: String(client.name || invoice.clientName || invoice.client_name || sale.clientName || "Walk-in"),
          clientPhone: String(client.phone || client.mobile || client.contact || invoice.clientPhone || invoice.client_phone || sale.clientPhone || sale.client_phone || ""),
          servicePrice: taxable,
          saleType,
          staffId,
          staffName: String(item.staffName || item.staff_name || item.assignedStaffName || item.assigned_staff_name || staffPerson.name || "Unassigned"),
          invoiceId,
          invoiceNumber: String(invoice.invoiceNumber || invoice.invoice_number || invoice.invoice_no || invoiceId),
          branchId: branchOf(invoice, sale)
        };
        if (this.serviceClientMatches(row, query)) rows.push(row);
      }
    }

    rows.sort((a, b) => dateMs(b.soldAt) - dateMs(a.soldAt));
    return { summary: this.serviceClientsSummary(rows), rows };
  }

  serviceClientMatches(row = {}, query = {}) {
    if (query.serviceGroup && String(row.serviceGroup || "") !== String(query.serviceGroup)) return false;
    if (query.serviceId && ![row.serviceId, row.serviceName].map(String).includes(String(query.serviceId))) return false;
    if (query.clientId && ![row.clientId, row.clientName].map(String).includes(String(query.clientId))) return false;
    if (query.staffId && ![row.staffId, row.staffName].map(String).includes(String(query.staffId))) return false;
    if (query.branchId && String(row.branchId || "") !== String(query.branchId)) return false;
    if (query.saleType && String(row.saleType || "") !== String(query.saleType)) return false;
    const q = String(query.q || query.query || "").trim().toLowerCase();
    if (q) {
      const text = `${row.date} ${row.time} ${row.serviceGroup} ${row.serviceName} ${row.clientName} ${row.clientPhone} ${row.staffName} ${row.invoiceNumber} ${row.branchId} ${row.saleType}`.toLowerCase();
      if (!text.includes(q)) return false;
    }
    return true;
  }

  serviceClientsSummary(rows = []) {
    const clients = new Set(rows.map((row) => row.clientId || row.clientName).filter(Boolean));
    return {
      totalClients: clients.size,
      totalServiceRevenue: money(rows.reduce((sum, row) => sum + Number(row.servicePrice || 0), 0)),
      totalServiceRows: rows.length,
      appointmentRows: rows.filter((row) => row.saleType === "Appointment").length,
      quickSaleRows: rows.filter((row) => row.saleType === "Quick Sale").length
    };
  }

  aggregate(lines = []) {
    const grouped = new Map();
    for (const line of lines) {
      const key = `${line.serviceId || serviceLookupKey(line.serviceName)}|${line.staffId || line.staffName}`;
      grouped.set(key, [...(grouped.get(key) || []), line]);
    }
    return [...grouped.values()].map((items) => {
      const latest = [...items].sort((a, b) => dateMs(b.soldAt) - dateMs(a.soldAt))[0] || {};
      const netSale = money(items.reduce((sum, item) => sum + item.netSale, 0));
      const productCost = money(items.reduce((sum, item) => sum + item.productCost, 0));
      const grossMargin = money(netSale - productCost);
      const clientCounts = new Map();
      const clientNames = new Map();
      for (const item of items) {
        if (item.clientId) clientCounts.set(item.clientId, (clientCounts.get(item.clientId) || 0) + 1);
        if (item.clientId) clientNames.set(item.clientId, item.clientName || item.clientId);
      }
      return {
        serviceId: items[0].serviceId || serviceLookupKey(items[0].serviceName),
        serviceGroup: items[0].serviceGroup,
        serviceName: items[0].serviceName,
        quantitySold: money(items.reduce((sum, item) => sum + item.quantity, 0)),
        grossSale: money(items.reduce((sum, item) => sum + item.gross, 0)),
        discount: money(items.reduce((sum, item) => sum + item.discount, 0)),
        netSale,
        gst: money(items.reduce((sum, item) => sum + item.gst, 0)),
        productCost,
        cogs: productCost,
        costStatus: productCost > 0 ? "Cost linked" : "Cost missing",
        grossMargin,
        marginPercent: netSale > 0 && productCost > 0 ? money((grossMargin / netSale) * 100) : 0,
        marginBucket: this.marginBucket(netSale, grossMargin, productCost),
        staffId: items[0].staffId,
        staffName: items[0].staffName,
        clientCount: clientCounts.size,
        clientIds: [...clientCounts.keys()].join(","),
        clientNames: [...clientNames.values()].join(", "),
        repeatClientCount: [...clientCounts.values()].filter((count) => count > 1).length,
        invoiceCount: new Set(items.map((item) => item.invoiceId)).size,
        invoiceIds: [...new Set(items.map((item) => item.invoiceId).filter(Boolean))].join(","),
        lastSoldDate: latest.soldDate || "",
        lastSoldTime: latest.soldTime || "",
        lastSoldAt: latest.soldAt || "",
        peakSellingHour: this.peakHour(items),
        timeBucket: latest.timeBucket || "",
        gstRate: items[0].gstRate,
        actionRoute: "/reports/invoices"
      };
    });
  }

  matches(row = {}, query = {}) {
    if (query.serviceGroup && String(row.serviceGroup || "") !== String(query.serviceGroup)) return false;
    if (query.serviceId && ![row.serviceId, row.serviceName].map(String).includes(String(query.serviceId))) return false;
    if (query.staffId && String(row.staffId || row.staffName || "") !== String(query.staffId)) return false;
    if (query.gstRate && String(row.gstRate) !== String(query.gstRate)) return false;
    if (query.revenueBucket && this.revenueBucket(Number(row.netSale || 0)) !== query.revenueBucket) return false;
    if (query.marginBucket && row.marginBucket !== query.marginBucket) return false;
    if (query.quantityBucket && this.quantityBucket(Number(row.quantitySold || 0)) !== query.quantityBucket) return false;
    if (query.timeBucket && row.timeBucket !== query.timeBucket) return false;
    const clientId = String(query.clientId || "");
    if (clientId && !String(row.clientIds || "").split(",").includes(clientId)) return false;
    const q = String(query.q || query.query || "").trim().toLowerCase();
    if (q) {
      const text = `${row.serviceGroup} ${row.serviceName} ${row.staffName} ${row.clientNames} ${row.invoiceIds}`.toLowerCase();
      if (!text.includes(q)) return false;
    }
    return true;
  }

  summary(rows = []) {
    const topService = this.topBy(rows, "serviceName", "netSale");
    const topGroup = this.topBy(rows, "serviceGroup", "netSale");
    const lowestSelling = [...rows].filter((row) => Number(row.quantitySold || 0) > 0).sort((a, b) => Number(a.quantitySold) - Number(b.quantitySold))[0] || {};
    const marginReady = rows.filter((row) => Number(row.productCost || 0) > 0);
    const highestMargin = [...marginReady].sort((a, b) => Number(b.marginPercent) - Number(a.marginPercent))[0] || {};
    const lowestMargin = [...marginReady].sort((a, b) => Number(a.marginPercent) - Number(b.marginPercent))[0] || {};
    return {
      totalServicesSold: rows.length,
      totalServiceRevenue: money(rows.reduce((sum, row) => sum + Number(row.netSale || 0), 0)),
      totalQuantitySold: money(rows.reduce((sum, row) => sum + Number(row.quantitySold || 0), 0)),
      averageServicePrice: rows.length ? money(rows.reduce((sum, row) => sum + Number(row.netSale || 0), 0) / Math.max(1, rows.reduce((sum, row) => sum + Number(row.quantitySold || 0), 0))) : 0,
      topService: topService.label || "-",
      topServiceGroup: topGroup.label || "-",
      lowestSellingService: lowestSelling.serviceName || "-",
      highestMarginService: highestMargin.serviceName || "-",
      lowestMarginService: lowestMargin.serviceName || "-",
      peakSellingHour: this.peakHour(rows.map((row) => ({ soldHour: row.peakSellingHour }))),
      discountLeakage: money(rows.reduce((sum, row) => sum + Number(row.discount || 0), 0)),
      serviceGstCollected: money(rows.reduce((sum, row) => sum + Number(row.gst || 0), 0))
    };
  }

  sortRows(a, b, sort) {
    if (sort === "quantity_desc") return Number(b.quantitySold) - Number(a.quantitySold);
    if (sort === "margin_desc") return Number(b.grossMargin) - Number(a.grossMargin);
    if (sort === "latest_sold") return dateMs(b.lastSoldAt) - dateMs(a.lastSoldAt);
    return Number(b.netSale) - Number(a.netSale);
  }

  topBy(rows, labelKey, valueKey) {
    const map = new Map();
    for (const row of rows) {
      const label = String(row[labelKey] || "").trim();
      if (!label) continue;
      map.set(label, (map.get(label) || 0) + Number(row[valueKey] || 0));
    }
    return [...map.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value)[0] || { label: "", value: 0 };
  }

  peakHour(rows = []) {
    const map = new Map();
    for (const row of rows) {
      const hour = String(row.soldHour || row.peakSellingHour || "").trim();
      if (!hour) continue;
      map.set(hour, (map.get(hour) || 0) + 1);
    }
    return [...map.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || "-";
  }

  revenueBucket(value) {
    if (value >= 10000) return "10000+";
    if (value >= 5000) return "5000-9999";
    if (value >= 1000) return "1000-4999";
    return "0-999";
  }

  quantityBucket(value) {
    if (value >= 50) return "50+";
    if (value >= 20) return "20-49";
    if (value >= 5) return "5-19";
    return "1-4";
  }

  marginBucket(netSale, margin, cost) {
    if (cost <= 0 && netSale > 0) return "missing";
    const percent = netSale > 0 ? (margin / netSale) * 100 : 0;
    if (percent < 0) return "negative";
    if (percent < 20) return "low";
    return "healthy";
  }
}

export const serviceTrendsReportService = new ServiceTrendsReportService();
