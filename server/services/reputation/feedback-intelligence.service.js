import { db } from "../../db.js";
import { badRequest } from "../../utils/app-error.js";
import {
  auditDecision,
  branchFrom,
  makeId,
  now,
  parseJson,
  requireTenant
} from "../enterprise-command-utils.js";
import { reputationService } from "./reputation.service.js";

const RATING_BUCKETS = [
  { key: "veryPoor", label: "Very Poor", ratings: [1] },
  { key: "poor", label: "Poor", ratings: [2] },
  { key: "average", label: "Average", ratings: [3] },
  { key: "good", label: "Good", ratings: [4] },
  { key: "awesome", label: "Awesome", ratings: [5] }
];

export const feedbackIntelligenceService = {
  report(query = {}, access) {
    requireTenant(access);
    const rows = this.filteredRows(query, access);
    const summary = buildSummary(rows, query, access);
    return {
      generatedAt: now(),
      filters: normalizeFilters(query, access),
      summary,
      rows,
      negativeRecovery: rows.filter((row) => row.isNegative),
      ratingIntelligence: buildRatingIntelligence(rows),
      staffScore: buildStaffScore(rows),
      serviceScore: buildServiceScore(rows)
    };
  },

  staffScore(query = {}, access) {
    requireTenant(access);
    return { generatedAt: now(), rows: buildStaffScore(this.filteredRows(query, access)) };
  },

  serviceScore(query = {}, access) {
    requireTenant(access);
    return { generatedAt: now(), rows: buildServiceScore(this.filteredRows(query, access)) };
  },

  sendRecoveryMessage(id, payload = {}, access) {
    requireTenant(access);
    const review = reputationService.review(id, access);
    if (!isNegativeReview(review)) throw badRequest("Recovery message is only allowed for negative feedback");
    const client = clientById(access.tenantId, review.customerId || review.clientId || "");
    const message = String(payload.message || defaultRecoveryMessage(review, client)).trim();
    const reply = reputationService.createReply(id, {
      replyText: message,
      replyLanguage: payload.replyLanguage || "en",
      aiGenerated: false,
      approvalStatus: "pending"
    }, access);
    auditDecision("reputation.feedback_recovery_message_queued", review.source === "legacy" ? "reputation_reviews" : "reviews_v2", id, access, {
      branchId: review.branchId || "",
      details: { channel: payload.channel || "whatsapp", replyId: reply.id, phoneAvailable: Boolean(client.phone) }
    });
    return {
      id: makeId("frecovery"),
      reviewId: id,
      replyId: reply.id,
      channel: payload.channel || "whatsapp",
      status: client.phone ? "queued" : "phone_missing",
      message,
      clientPhone: client.phone || "",
      createdAt: now()
    };
  },

  markReviewed(id, payload = {}, access) {
    requireTenant(access);
    const review = reputationService.review(id, access);
    const result = reputationService.resolveReview(id, {
      resolutionAction: payload.resolutionAction || "manager_reviewed",
      recoveryOfferSent: payload.recoveryOfferSent || false,
      recoveryOfferType: payload.recoveryOfferType || "",
      recoveryOutcome: payload.recoveryOutcome || "reviewed"
    }, access);
    auditDecision("reputation.feedback_marked_reviewed", review.source === "legacy" ? "reputation_reviews" : "reviews_v2", id, access, {
      branchId: review.branchId || "",
      details: payload
    });
    return { status: "reviewed", review: result, reviewedAt: now() };
  },

  csv(query = {}, access) {
    const report = this.report(query, access);
    const columns = [
      "date",
      "time",
      "clientName",
      "clientPhone",
      "invoiceNumber",
      "appointmentId",
      "serviceNames",
      "staffName",
      "rating",
      "ratingBucket",
      "feedback",
      "status",
      "source",
      "branchName"
    ];
    return csvFromRows(columns, report.rows);
  },

  ownerPdf(query = {}, access) {
    const report = this.report(query, access);
    return {
      title: "Customer Feedback Intelligence",
      generatedAt: report.generatedAt,
      summary: report.summary,
      sections: [
        { title: "Negative recovery", rows: report.negativeRecovery.slice(0, 25) },
        { title: "Staff feedback score", rows: report.staffScore.slice(0, 25) },
        { title: "Service feedback score", rows: report.serviceScore.slice(0, 25) }
      ]
    };
  },

  filteredRows(query = {}, access) {
    const reviews = reputationService.reviews({
      branchId: branchFrom(query, access),
      status: query.status && query.status !== "all" ? query.status : "",
      staffId: query.staffId || "",
      customerId: query.clientId || query.customerId || "",
      search: query.search || "",
      limit: query.limit || 1000
    }, access);
    return reviews.map((review) => enrichReview(review, access)).filter((row) => rowMatches(row, query));
  }
};

function enrichReview(review = {}, access = {}) {
  const dateTime = review.reviewedAt || review.createdAt || review.updatedAt || "";
  const client = clientById(access.tenantId, review.customerId || review.clientId || "");
  const invoice = invoiceById(access.tenantId, review.invoiceId || "");
  const staff = staffById(access.tenantId, review.primaryStaffId || "");
  const services = servicesByIds(review.serviceIds || []);
  const branch = branchById(review.branchId || invoice.branchId || client.branchId || "");
  const rating = Number(review.rating || 0);
  const recoveryStatus = recoveryStatusFor(review);
  return {
    id: review.id,
    sourceId: review.id,
    source: review.platformName || review.platform || review.source || "Internal feedback",
    reviewSource: review.source || "",
    date: datePart(dateTime),
    time: timePart(dateTime),
    dateTime,
    clientId: review.customerId || review.clientId || "",
    clientName: client.name || review.reviewerName || review.reviewer || "Walk-in",
    clientPhone: client.phone || "",
    invoiceId: review.invoiceId || "",
    invoiceNumber: invoice.invoiceNumber || invoice.invoiceNo || "",
    appointmentId: review.appointmentId || invoice.appointmentId || "",
    serviceIds: review.serviceIds || [],
    serviceNames: services.map((service) => service.name).filter(Boolean).join(", ") || "",
    staffId: review.primaryStaffId || "",
    staffName: staff.name || staff.fullName || review.primaryStaffId || "Unassigned",
    rating,
    ratingBucket: ratingBucket(rating),
    feedback: review.reviewText || review.title || "",
    status: review.status || "new",
    sentiment: review.sentiment || "",
    branchId: review.branchId || invoice.branchId || client.branchId || "",
    branchName: branch.name || review.branchId || "",
    isNegative: isNegativeReview(review),
    recoveryStatus,
    resolvedAt: review.resolvedAt || "",
    assignedTo: review.assignedTo || "",
    actions: {
      openClient: client.id ? `/clients/${client.id}` : "",
      openInvoice: invoice.id ? `/pos/invoices?invoice=${encodeURIComponent(invoice.id)}` : "",
      sendRecovery: isNegativeReview(review),
      markReviewed: recoveryStatus !== "resolved"
    }
  };
}

function buildSummary(rows = [], query = {}, access = {}) {
  const total = rows.length;
  const negative = rows.filter((row) => row.isNegative).length;
  const recoveryPending = rows.filter((row) => row.isNegative && row.recoveryStatus !== "resolved").length;
  const requestSummary = reviewRequestSummary(query, access);
  const buckets = Object.fromEntries(RATING_BUCKETS.map((bucket) => [
    bucket.key,
    rows.filter((row) => bucket.ratings.includes(Math.round(row.rating))).length
  ]));
  return {
    totalFeedback: total,
    overallRating: average(rows.map((row) => row.rating).filter(Boolean)),
    ...buckets,
    negativeFeedback: negative,
    recoveryPending,
    reviewConversionRate: percentage(requestSummary.submitted, requestSummary.sent),
    reviewRequestsSent: requestSummary.sent,
    reviewRequestsSubmitted: requestSummary.submitted
  };
}

function buildRatingIntelligence(rows = []) {
  return RATING_BUCKETS.map((bucket) => {
    const bucketRows = rows.filter((row) => bucket.ratings.includes(Math.round(row.rating)));
    return {
      bucket: bucket.label,
      count: bucketRows.length,
      averageRating: average(bucketRows.map((row) => row.rating).filter(Boolean)),
      negativeCount: bucketRows.filter((row) => row.isNegative).length,
      recoveryPending: bucketRows.filter((row) => row.isNegative && row.recoveryStatus !== "resolved").length
    };
  });
}

function buildStaffScore(rows = []) {
  return groupedScore(rows, (row) => row.staffId || row.staffName || "unassigned", (row) => ({
    staffId: row.staffId || "",
    staffName: row.staffName || "Unassigned"
  }));
}

function buildServiceScore(rows = []) {
  const expanded = [];
  for (const row of rows) {
    const names = row.serviceNames ? row.serviceNames.split(",").map((item) => item.trim()).filter(Boolean) : ["Unassigned service"];
    for (const name of names) expanded.push({ ...row, serviceName: name });
  }
  return groupedScore(expanded, (row) => row.serviceName || "unassigned", (row) => ({
    serviceId: "",
    serviceName: row.serviceName || "Unassigned service"
  }));
}

function groupedScore(rows, keyFn, baseFn) {
  const grouped = new Map();
  for (const row of rows) {
    const key = keyFn(row);
    const current = grouped.get(key) || { ...baseFn(row), feedbackCount: 0, ratingTotal: 0, negativeCount: 0, recoveryPending: 0, resolvedCount: 0 };
    current.feedbackCount += 1;
    current.ratingTotal += Number(row.rating || 0);
    if (row.isNegative) current.negativeCount += 1;
    if (row.isNegative && row.recoveryStatus !== "resolved") current.recoveryPending += 1;
    if (row.recoveryStatus === "resolved") current.resolvedCount += 1;
    grouped.set(key, current);
  }
  return [...grouped.values()].map((row) => ({
    ...row,
    averageRating: average([row.ratingTotal / Math.max(1, row.feedbackCount)]),
    repeatIssueSignal: row.negativeCount >= 2 ? "watch" : "normal"
  })).sort((a, b) => b.feedbackCount - a.feedbackCount || a.averageRating - b.averageRating);
}

function rowMatches(row, query = {}) {
  if (query.from && row.date && row.date < query.from) return false;
  if (query.to && row.date && row.date > query.to) return false;
  if (query.ratingBucket && query.ratingBucket !== "all" && row.ratingBucket !== query.ratingBucket) return false;
  if (query.negativeOnly === "true" || query.negativeOnly === true) {
    if (!row.isNegative) return false;
  }
  if (query.source && query.source !== "all" && !String(row.source).toLowerCase().includes(String(query.source).toLowerCase())) return false;
  if (query.service && query.service !== "all" && !String(row.serviceNames).toLowerCase().includes(String(query.service).toLowerCase())) return false;
  return true;
}

function reviewRequestSummary(query = {}, access = {}) {
  if (!tableExists("review_requests_sent")) return { sent: 0, submitted: 0 };
  const params = { tenant_id: access.tenantId, branch_id: branchFrom(query, access) || "", from: query.from || "", to: query.to || "" };
  const filters = ["tenant_id = @tenant_id"];
  if (params.branch_id) filters.push("branch_id = @branch_id");
  if (params.from) filters.push("date(COALESCE(sent_at, created_at)) >= date(@from)");
  if (params.to) filters.push("date(COALESCE(sent_at, created_at)) <= date(@to)");
  const row = db.prepare(
    `SELECT COUNT(*) AS sent, COALESCE(SUM(CASE WHEN review_submitted = 1 THEN 1 ELSE 0 END), 0) AS submitted
     FROM review_requests_sent
     WHERE ${filters.join(" AND ")}`
  ).get(params);
  return { sent: Number(row?.sent || 0), submitted: Number(row?.submitted || 0) };
}

function clientById(tenantId, id) {
  if (!id || !tableExists("clients")) return {};
  const columns = tableColumns("clients");
  const tenantFilter = columns.has("tenantId") ? " AND tenantId = @tenantId" : columns.has("tenant_id") ? " AND tenant_id = @tenantId" : "";
  return db.prepare(`SELECT * FROM clients WHERE id = @id${tenantFilter} LIMIT 1`).get({ id, tenantId }) || {};
}

function staffById(tenantId, id) {
  if (!id || !tableExists("staff")) return {};
  const columns = tableColumns("staff");
  const tenantFilter = columns.has("tenantId") ? " AND tenantId = @tenantId" : columns.has("tenant_id") ? " AND tenant_id = @tenantId" : "";
  return db.prepare(`SELECT * FROM staff WHERE id = @id${tenantFilter} LIMIT 1`).get({ id, tenantId }) || {};
}

function branchById(id) {
  if (!id || !tableExists("branches")) return {};
  return db.prepare("SELECT * FROM branches WHERE id = @id LIMIT 1").get({ id }) || {};
}

function invoiceById(tenantId, id) {
  if (!id || !tableExists("invoices")) return {};
  const columns = tableColumns("invoices");
  const tenantFilter = columns.has("tenantId") ? " AND tenantId = @tenantId" : columns.has("tenant_id") ? " AND tenant_id = @tenantId" : "";
  const row = db.prepare(`SELECT * FROM invoices WHERE id = @id${tenantFilter} LIMIT 1`).get({ id, tenantId }) || {};
  return {
    ...row,
    invoiceNumber: row.invoiceNumber || row.invoice_no || row.invoiceNo || "",
    invoiceNo: row.invoice_no || row.invoiceNumber || "",
    appointmentId: row.appointment_id || row.appointmentId || "",
    branchId: row.branch_id || row.branchId || ""
  };
}

function servicesByIds(ids = []) {
  const clean = [...new Set((Array.isArray(ids) ? ids : parseJson(ids, [])).map(String).filter(Boolean))];
  if (!clean.length || !tableExists("services")) return [];
  const placeholders = clean.map((_, index) => `@id${index}`).join(",");
  const params = Object.fromEntries(clean.map((id, index) => [`id${index}`, id]));
  return db.prepare(`SELECT * FROM services WHERE id IN (${placeholders})`).all(params);
}

function tableExists(name) {
  return Boolean(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=@name").get({ name }));
}

function tableColumns(name) {
  return new Set(db.prepare(`PRAGMA table_info(${name})`).all().map((column) => column.name));
}

function ratingBucket(rating) {
  const rounded = Math.round(Number(rating || 0));
  return RATING_BUCKETS.find((bucket) => bucket.ratings.includes(rounded))?.key || "unrated";
}

function isNegativeReview(review = {}) {
  const sentiment = String(review.sentiment || "").toLowerCase();
  return Number(review.rating || 0) <= 2 || sentiment.includes("negative");
}

function recoveryStatusFor(review = {}) {
  if (review.resolvedAt || ["resolved", "closed", "reviewed"].includes(String(review.status || "").toLowerCase())) return "resolved";
  if (review.assignedTo) return "assigned";
  if (isNegativeReview(review)) return "pending";
  return "not_required";
}

function defaultRecoveryMessage(review = {}, client = {}) {
  const name = client.name || review.reviewerName || "Client";
  return `Hi ${name}, thank you for your feedback. We are sorry your visit did not meet expectations. Our manager will review this and help resolve it. - Aura Salon`;
}

function normalizeFilters(query = {}, access = {}) {
  return {
    branchId: branchFrom(query, access) || "",
    from: query.from || "",
    to: query.to || "",
    status: query.status || "all",
    ratingBucket: query.ratingBucket || "all",
    negativeOnly: query.negativeOnly === true || query.negativeOnly === "true"
  };
}

function csvFromRows(columns, rows) {
  return [
    columns.join(","),
    ...rows.map((row) => columns.map((column) => csvCell(row[column])).join(","))
  ].join("\n");
}

function csvCell(value) {
  const text = Array.isArray(value) ? value.join("; ") : String(value ?? "");
  return `"${text.replace(/"/g, '""')}"`;
}

function datePart(value) {
  return value ? String(value).slice(0, 10) : "";
}

function timePart(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).slice(11, 16);
  return date.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: true, timeZone: "Asia/Kolkata" });
}

function average(values = []) {
  const clean = values.map(Number).filter(Number.isFinite);
  if (!clean.length) return 0;
  return Math.round((clean.reduce((sum, value) => sum + value, 0) / clean.length) * 10) / 10;
}

function percentage(value, total) {
  return total > 0 ? Math.round((Number(value || 0) / Number(total || 0)) * 100) : 0;
}
