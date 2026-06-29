import { DEFAULT_TENANT_ID, db } from "../db.js";
import { forbidden } from "../utils/app-error.js";

const money = (value) => Math.round((Number(value) || 0) * 100) / 100;
const text = (value = "") => String(value || "").trim();
const lower = (value = "") => text(value).toLowerCase();
const dayKey = (value = "") => text(value).slice(0, 10);
const dateTime = (value = "") => text(value);

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

function initials(name = "") {
  const parts = text(name).split(/\s+/).filter(Boolean);
  return (parts[0]?.[0] || "S") + (parts.length > 1 ? parts.at(-1)?.[0] || "" : "");
}

function statusGroup(status = "") {
  const key = lower(status).replace(/[_\s]+/g, "-");
  if (["confirmed", "confirm"].includes(key)) return "confirmed";
  if (["arrived", "checked-in", "check-in"].includes(key)) return "arrived";
  if (["start", "started", "in-service", "in-progress"].includes(key)) return "started";
  if (["completed", "complete", "done", "paid", "billed", "checkout", "checked-out"].includes(key)) return "completed";
  if (["cancelled", "canceled", "cancel"].includes(key)) return "cancelled";
  if (["no-show", "not-came", "not-come", "noshow"].includes(key)) return "not_came";
  return "not_confirmed";
}

function statusLabel(group = "") {
  return {
    confirmed: "Confirmed",
    arrived: "Arrived",
    started: "Start",
    completed: "Completed",
    cancelled: "Cancel",
    not_came: "Not Came",
    not_confirmed: "Not Confirmed"
  }[group] || "Not Confirmed";
}

function modeGroup(appointment = {}) {
  const source = lower(appointment.source || appointment.mode || appointment.bookingMode || appointment.booking_mode);
  const onlineStatus = lower(appointment.onlineStatus || appointment.online_status);
  if (source.includes("online") || onlineStatus.includes("online") || source.includes("web") || source.includes("app")) return "online";
  if (source.includes("import")) return "import";
  return "manual";
}

function modeLabel(group = "") {
  return { online: "Online", import: "Import", manual: "Manual" }[group] || "Manual";
}

function branchScope(query = {}, access = {}) {
  const branchId = text(query.branchId || access.branchId);
  const privileged = ["superAdmin", "owner", "admin", "manager", "analyst"].includes(access.role);
  if (branchId && !privileged && !(access.branchIds || []).includes(branchId)) {
    throw forbidden("This user does not have access to the requested branch");
  }
  return {
    tenantId: text(access.tenantId) || DEFAULT_TENANT_ID,
    branchId
  };
}

function serviceIdsOf(appointment = {}) {
  const raw = readArray(appointment.serviceIds || appointment.service_ids);
  return raw.map((item) => text(typeof item === "object" ? item.id || item.serviceId || item.service_id : item)).filter(Boolean);
}

function fetchAppointments({ tenantId, branchId, from, to }) {
  return db.prepare(`
    SELECT *
    FROM appointments
    WHERE tenantId = @tenantId
      AND (@branchId = '' OR branchId = @branchId)
      AND substr(COALESCE(NULLIF(startAt, ''), createdAt), 1, 10) >= @from
      AND substr(COALESCE(NULLIF(startAt, ''), createdAt), 1, 10) <= @to
    ORDER BY datetime(COALESCE(NULLIF(startAt, ''), createdAt)) DESC
    LIMIT 10000
  `).all({ tenantId, branchId, from, to });
}

function fetchClients({ tenantId, branchId }) {
  return db.prepare(`
    SELECT *
    FROM clients
    WHERE tenantId = @tenantId
      AND (@branchId = '' OR branchId = @branchId OR branchId IS NULL OR branchId = '')
    LIMIT 20000
  `).all({ tenantId, branchId });
}

function fetchStaff({ tenantId, branchId }) {
  return db.prepare(`
    SELECT *
    FROM staff
    WHERE tenantId = @tenantId
      AND (@branchId = '' OR branchId = @branchId)
    ORDER BY name COLLATE NOCASE ASC
    LIMIT 5000
  `).all({ tenantId, branchId });
}

function fetchServices({ tenantId }) {
  return db.prepare(`
    SELECT *
    FROM services
    WHERE tenantId = @tenantId
    LIMIT 20000
  `).all({ tenantId });
}

function fetchSales({ tenantId, branchId, from, to }) {
  return db.prepare(`
    SELECT *
    FROM sales
    WHERE tenantId = @tenantId
      AND (@branchId = '' OR branchId = @branchId)
      AND appointmentId <> ''
      AND substr(COALESCE(NULLIF(createdAt, ''), updatedAt), 1, 10) >= @from
      AND substr(COALESCE(NULLIF(createdAt, ''), updatedAt), 1, 10) <= @to
    LIMIT 20000
  `).all({ tenantId, branchId, from, to });
}

function fetchInvoices({ tenantId, branchId, from, to }) {
  return db.prepare(`
    SELECT invoices.*, sales.appointmentId AS appointmentId
    FROM invoices
    LEFT JOIN sales ON sales.id = invoices.saleId AND sales.tenantId = invoices.tenantId
    WHERE invoices.tenantId = @tenantId
      AND (@branchId = '' OR invoices.branchId = @branchId OR sales.branchId = @branchId)
      AND COALESCE(sales.appointmentId, '') <> ''
      AND substr(COALESCE(NULLIF(invoices.createdAt, ''), invoices.updatedAt), 1, 10) >= @from
      AND substr(COALESCE(NULLIF(invoices.createdAt, ''), invoices.updatedAt), 1, 10) <= @to
    LIMIT 20000
  `).all({ tenantId, branchId, from, to });
}

function buildPriceMaps(sales = [], invoices = []) {
  const prices = new Map();
  const invoiceNumbers = new Map();
  for (const sale of sales) {
    const appointmentId = text(sale.appointmentId);
    if (!appointmentId) continue;
    prices.set(appointmentId, money(sale.total || sale.subtotal));
  }
  for (const invoice of invoices) {
    const appointmentId = text(invoice.appointmentId);
    if (!appointmentId) continue;
    const total = money(invoice.total || invoice.grand_total || invoice.grandTotal || invoice.paid);
    if (total) prices.set(appointmentId, total);
    if (invoice.invoiceNumber || invoice.invoice_no) invoiceNumbers.set(appointmentId, text(invoice.invoiceNumber || invoice.invoice_no));
  }
  return { prices, invoiceNumbers };
}

function serviceFallbackPrice(serviceIds = [], servicesById = new Map()) {
  return money(serviceIds.reduce((sum, serviceId) => sum + Number(servicesById.get(serviceId)?.price || 0), 0));
}

function buildRows(query = {}, access = {}) {
  const from = dayKey(query.from) || "0000-00-00";
  const to = dayKey(query.to) || "9999-12-31";
  const scope = branchScope(query, access);
  const appointments = fetchAppointments({ ...scope, from, to });
  const clientsById = new Map(fetchClients(scope).map((client) => [text(client.id), client]));
  const staff = fetchStaff(scope);
  const staffById = new Map(staff.map((person) => [text(person.id), person]));
  const servicesById = new Map(fetchServices(scope).map((service) => [text(service.id), service]));
  const { prices, invoiceNumbers } = buildPriceMaps(fetchSales({ ...scope, from, to }), fetchInvoices({ ...scope, from, to }));

  const rows = appointments.map((appointment) => {
    const client = clientsById.get(text(appointment.clientId)) || {};
    const person = staffById.get(text(appointment.staffId)) || {};
    const serviceIds = serviceIdsOf(appointment);
    const services = serviceIds.map((serviceId) => servicesById.get(serviceId)).filter(Boolean);
    const group = statusGroup(appointment.status);
    const mode = modeGroup(appointment);
    const startAt = dateTime(appointment.startAt || appointment.createdAt);
    const price = prices.has(appointment.id) ? prices.get(appointment.id) : serviceFallbackPrice(serviceIds, servicesById);

    return {
      id: text(appointment.id),
      appointmentId: text(appointment.id),
      mode: modeLabel(mode),
      modeGroup: mode,
      clientId: text(appointment.clientId),
      name: text(client.name || appointment.clientName) || "Walk-In",
      contact: text(client.phone || client.mobile || appointment.contact),
      notes: text(appointment.notes),
      serviceNames: services.length ? services.map((service) => service.name).join(", ") : "-",
      staffId: text(appointment.staffId),
      staffName: text(person.name) || "Unassigned",
      staffType: text(person.role) || "Employee",
      status: statusLabel(group),
      statusGroup: group,
      appointmentDate: dayKey(startAt),
      appointmentTime: startAt.length > 10 ? startAt.slice(11, 16) : "",
      startAt,
      price,
      invoiceNumber: invoiceNumbers.get(appointment.id) || ""
    };
  });
  return { rows, staff, filters: { from, to, branchId: scope.branchId } };
}

function detailSummary(rows = []) {
  return rows.reduce((summary, row) => {
    summary.total += 1;
    summary.appointmentPrice = money(summary.appointmentPrice + row.price);
    if (row.statusGroup === "confirmed") summary.confirmed += 1;
    if (row.statusGroup === "arrived") summary.arrived += 1;
    if (row.statusGroup === "started") summary.started += 1;
    if (row.statusGroup === "completed") summary.completed += 1;
    if (row.statusGroup === "cancelled") summary.cancelled += 1;
    if (row.statusGroup === "not_came") summary.notCame += 1;
    if (row.statusGroup === "not_confirmed") summary.notConfirmed += 1;
    return summary;
  }, {
    total: 0,
    confirmed: 0,
    arrived: 0,
    started: 0,
    completed: 0,
    cancelled: 0,
    notCame: 0,
    notConfirmed: 0,
    appointmentPrice: 0,
    averagePrice: 0
  });
}

function applyDetailFilters(rows = [], query = {}) {
  const type = lower(query.type || "all");
  const status = lower(query.status || "all");
  const mode = lower(query.mode || "all");
  const search = lower(query.search);
  return rows.filter((row) => {
    if (type !== "all" && row.statusGroup !== type) return false;
    if (status !== "all" && row.statusGroup !== status) return false;
    if (mode !== "all" && row.modeGroup !== mode) return false;
    if (!search) return true;
    return [row.name, row.contact, row.serviceNames, row.staffName, row.invoiceNumber].join(" ").toLowerCase().includes(search);
  });
}

function paginate(rows = [], query = {}) {
  const limit = Math.min(500, Math.max(1, Number(query.limit || 25)));
  const offset = Math.max(0, Number(query.offset || 0));
  return { limit, offset, pageRows: rows.slice(offset, offset + limit) };
}

function staffReportRows(rows = [], staff = [], query = {}) {
  const staffMap = new Map();
  for (const person of staff) {
    staffMap.set(text(person.id), {
      staffId: text(person.id),
      name: text(person.name) || "Unassigned",
      initials: initials(person.name),
      type: text(person.role) || "Employee",
      appointmentCount: 0,
      appointmentPrice: 0,
      completed: 0,
      cancelled: 0,
      notCame: 0,
      averagePrice: 0
    });
  }
  for (const row of rows) {
    const key = row.staffId || "unassigned";
    if (!staffMap.has(key)) {
      staffMap.set(key, {
        staffId: key,
        name: row.staffName || "Unassigned",
        initials: initials(row.staffName),
        type: row.staffType || "Employee",
        appointmentCount: 0,
        appointmentPrice: 0,
        completed: 0,
        cancelled: 0,
        notCame: 0,
        averagePrice: 0
      });
    }
    const person = staffMap.get(key);
    person.appointmentCount += 1;
    person.appointmentPrice = money(person.appointmentPrice + row.price);
    if (row.statusGroup === "completed") person.completed += 1;
    if (row.statusGroup === "cancelled") person.cancelled += 1;
    if (row.statusGroup === "not_came") person.notCame += 1;
  }
  const search = lower(query.search);
  return [...staffMap.values()]
    .map((person) => ({ ...person, averagePrice: person.appointmentCount ? money(person.appointmentPrice / person.appointmentCount) : 0 }))
    .filter((person) => !search || [person.name, person.type].join(" ").toLowerCase().includes(search))
    .sort((a, b) => b.appointmentCount - a.appointmentCount || a.name.localeCompare(b.name));
}

function staffSummary(rows = []) {
  return rows.reduce((summary, row) => {
    summary.staffCount += 1;
    summary.totalAppointments += row.appointmentCount;
    summary.appointmentPrice = money(summary.appointmentPrice + row.appointmentPrice);
    if (row.appointmentCount > 0) summary.activeStaff += 1;
    if (row.appointmentCount <= 0) summary.zeroAppointmentStaff += 1;
    return summary;
  }, {
    staffCount: 0,
    totalAppointments: 0,
    appointmentPrice: 0,
    activeStaff: 0,
    zeroAppointmentStaff: 0
  });
}

class AppointmentSalonistReportService {
  detail(query = {}, access = {}) {
    const built = buildRows(query, access);
    const filteredRows = applyDetailFilters(built.rows, query);
    const summary = detailSummary(filteredRows);
    summary.averagePrice = summary.total ? money(summary.appointmentPrice / summary.total) : 0;
    const { limit, offset, pageRows } = paginate(filteredRows, query);
    return {
      summary,
      rows: pageRows,
      total: filteredRows.length,
      limit,
      offset,
      filters: built.filters,
      generatedAt: new Date().toISOString()
    };
  }

  staffAppointments(query = {}, access = {}) {
    const built = buildRows(query, access);
    const rows = staffReportRows(built.rows, built.staff, query);
    const summary = staffSummary(rows);
    const { limit, offset, pageRows } = paginate(rows, query);
    return {
      summary,
      rows: pageRows,
      total: rows.length,
      limit,
      offset,
      filters: built.filters,
      generatedAt: new Date().toISOString()
    };
  }
}

export const appointmentSalonistReportService = new AppointmentSalonistReportService();
