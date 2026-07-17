import { repositories } from "../repositories/repository-registry.js";
import { db } from "../db.js";
import { badRequest, notFound } from "../utils/app-error.js";
import { tenantService } from "./tenant.service.js";

const now = () => new Date().toISOString();
const makeId = (prefix) => `${prefix}_${crypto.randomUUID().slice(0, 10)}`;
const money = (value) => Math.round((Number(value) || 0) * 100) / 100;
const cleanText = (value) => String(value ?? "").trim();

function clientDisplayName(client = {}) {
  if (!client || typeof client !== "object") return "Client";
  return cleanText(client.name || client.fullName || client.full_name || client.clientName || client.customerName || client.phone || client.email || client.id) || "Client";
}

function normalizeClient(client = {}) {
  const row = client && typeof client === "object" ? client : {};
  const tags = Array.isArray(row.tags) ? row.tags.filter(Boolean) : (row.tags ? [row.tags] : []);
  return {
    ...row,
    name: clientDisplayName(row),
    phone: cleanText(row.phone || row.mobile || row.mobileNumber || row.contactNumber),
    email: cleanText(row.email),
    tags
  };
}

const CONTACT_MASKED_ROLES = new Set(["marketingLead", "customMarketingLead"]);

function maskPhone(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  const digits = text.replace(/\D/g, "");
  if (digits.length <= 4) return "****";
  return `${"*".repeat(Math.max(4, digits.length - 4))}${digits.slice(-4)}`;
}

function maskEmail(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  const [name = "", domain = ""] = text.split("@");
  if (!domain) return "***";
  return `${name.slice(0, 1) || "*"}***@${domain}`;
}

function maskClientContacts(row, access = {}) {
  if (!row || !CONTACT_MASKED_ROLES.has(String(access.role || access.userRole || ""))) return row;
  const next = { ...row, contactMasked: true };
  for (const key of ["phone", "mobile", "clientPhone", "customerPhone"]) {
    if (next[key] !== undefined) next[key] = maskPhone(next[key]);
  }
  for (const key of ["email", "clientEmail", "customerEmail"]) {
    if (next[key] !== undefined) next[key] = maskEmail(next[key]);
  }
  return next;
}

function maskProfileContacts(profile, access = {}) {
  if (!profile || !CONTACT_MASKED_ROLES.has(String(access.role || access.userRole || ""))) return profile;
  return { ...profile, client: maskClientContacts(profile.client, access) };
}

function activeClient(client = {}) {
  return client && typeof client === "object" && !cleanText(client.deletedAt || client.deleted_at);
}

function safeObjectList(value) {
  if (Array.isArray(value)) return value.filter((item) => item && typeof item === "object");
  if (typeof value === "string" && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed.filter((item) => item && typeof item === "object") : [];
    } catch {
      return [];
    }
  }
  return [];
}

function safeIdList(value) {
  if (Array.isArray(value)) return value.filter(Boolean);
  if (typeof value === "string" && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed.filter(Boolean);
    } catch {
      return value.split(",").map((item) => item.trim()).filter(Boolean);
    }
  }
  return [];
}

function canReadAllBranches(access = {}) {
  return ["superAdmin", "owner", "admin", "manager", "analyst"].includes(access.role);
}

function scope(access, branchId = "", options = {}) {
  const scoped = options.allBranches && canReadAllBranches(access) ? { tenantId: access.tenantId } : tenantService.accessScope(access || {});
  if (branchId) scoped.branchId = branchId;
  return scoped;
}

function daysSince(value) {
  if (!value) return 999;
  const time = new Date(value).getTime();
  if (Number.isNaN(time)) return 999;
  return Math.max(0, Math.round((Date.now() - time) / 86400000));
}

function safeRows(sql, params = {}) {
  try {
    return db.prepare(sql).all(params);
  } catch {
    return [];
  }
}

function wantsAllBranches(query = {}) {
  return query.includeAllBranches === true || String(query.includeAllBranches || "").toLowerCase() === "true";
}

function boundedLimit(value, fallback, max) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.min(Math.floor(parsed), max);
}

function dateKey(value) {
  return String(value || "").slice(0, 10);
}

function monthKey(value) {
  return dateKey(value).slice(0, 7);
}

function riskLabel(score) {
  if (score >= 85) return "Critical";
  if (score >= 70) return "High";
  if (score >= 40) return "Medium";
  return "Low";
}

function averageDiscountPercent(invoices = []) {
  const values = invoices
    .map((invoice) => Number(invoice.discountPercent ?? invoice.discount_percent ?? 0))
    .filter((value) => Number.isFinite(value) && value > 0);
  if (values.length) return money(values.reduce((sum, value) => sum + value, 0) / values.length);
  const inferred = invoices
    .map((invoice) => {
      const subtotal = Number(invoice.subtotal || 0);
      const discount = Number(invoice.discount || invoice.discountAmount || 0);
      return subtotal > 0 ? (discount / subtotal) * 100 : 0;
    })
    .filter((value) => value > 0);
  return inferred.length ? money(inferred.reduce((sum, value) => sum + value, 0) / inferred.length) : 0;
}

function visitFrequencyDays(dates = []) {
  if (dates.length < 2) return 0;
  const sorted = dates.map((value) => new Date(value).getTime()).filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (sorted.length < 2) return 0;
  const gaps = [];
  for (let index = 1; index < sorted.length; index += 1) gaps.push((sorted[index] - sorted[index - 1]) / 86400000);
  return Math.max(1, Math.round(gaps.reduce((sum, value) => sum + value, 0) / gaps.length));
}

function peakVisit(appointments = []) {
  const byDay = new Map();
  const byHour = new Map();
  for (const appointment of appointments) {
    const date = appointment.startAt ? new Date(appointment.startAt) : null;
    if (!date || Number.isNaN(date.getTime())) continue;
    const day = date.toLocaleDateString("en-IN", { weekday: "long", timeZone: "Asia/Kolkata" });
    const hour = date.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" });
    byDay.set(day, (byDay.get(day) || 0) + 1);
    byHour.set(hour, (byHour.get(hour) || 0) + 1);
  }
  return {
    day: [...byDay.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || "Unknown",
    time: [...byHour.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || "Unknown"
  };
}

function allergyStatus(client = {}) {
  const text = `${client.allergies || ""} ${client.notes || ""}`.toLowerCase();
  if (/allerg|rash|reaction|sensitive/.test(text)) return "Flagged";
  if (client.patchTestDate || client.lastPatchTestAt) return "Clear";
  return "Not Tested";
}

function daysUntil(value) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const today = new Date();
  const target = new Date(today.getFullYear(), date.getMonth(), date.getDate());
  if (target < new Date(today.getFullYear(), today.getMonth(), today.getDate())) target.setFullYear(today.getFullYear() + 1);
  return Math.round((target - new Date(today.getFullYear(), today.getMonth(), today.getDate())) / 86400000);
}

export class Customer360Service {
  summary(query = {}, access) {
    const includeAllBranches = wantsAllBranches(query) && canReadAllBranches(access);
    const branchId = includeAllBranches ? "" : query.branchId || access.branchId || "";
    if (branchId) tenantService.assertBranchAccess(access, branchId);
    const limit = boundedLimit(query.limit, 10000, 50000);
    const clientScope = scope(access, branchId, { allBranches: includeAllBranches });
    const clientQuery = branchId ? { branchId } : {};
    const snapshotQuery = branchId ? { branchId, limit: 50 } : { limit: 50 };
    const clients = repositories.clients.list({ ...clientQuery, limit: 1000000 }, clientScope).filter(activeClient).map(normalizeClient);
    const allProfiles = clients.map((client) => this.summaryProfile(client));
    const visibleClients = clients.slice(0, limit);
    const profiles = allProfiles.slice(0, limit).map((profile) => maskProfileContacts(profile, access));
    const result = {
      metrics: {
        clients: clients.length,
        totalLtv: money(allProfiles.reduce((sum, item) => sum + Number(item.metrics.lifetimeValue || 0), 0)),
        avgSpend: allProfiles.length ? money(allProfiles.reduce((sum, item) => sum + Number(item.metrics.averageSpend || 0), 0) / allProfiles.length) : 0,
        highRisk: allProfiles.filter((item) => item.metrics.riskScore >= 70).length,
        vip: clients.filter((client) => (client.tags || []).includes("VIP")).length
      },
      profiles,
      clientList: visibleClients.map((client) => maskClientContacts({
        id: client.id,
        name: client.name,
        phone: client.phone || "",
        email: client.email || "",
        branchId: client.branchId || "",
        lastVisitAt: client.lastVisitAt || "",
        totalSpend: money(client.totalSpend || 0),
        visitCount: Number(client.visitCount || 0)
      }, access)),
      snapshots: repositories.customerIntelligenceSnapshots.list(snapshotQuery, scope(access, branchId, { allBranches: includeAllBranches }))
    };
    return result;
  }

  summaryProfile(client = {}) {
    client = normalizeClient(client);
    const lifetimeValue = money(client.totalSpend || client.lifetimeValue || 0);
    const visitCount = Number(client.visitCount || 0);
    const averageSpend = visitCount ? money(lifetimeValue / visitCount) : 0;
    const inactiveDays = daysSince(client.lastVisitAt || client.updatedAt || client.createdAt);
    const riskScore = Math.min(100, Math.round((inactiveDays > 90 ? 45 : inactiveDays > 45 ? 25 : 8) + (visitCount <= 1 ? 15 : 0)));
    const favoriteService = client.favoriteService || client.preferredService || "No favorite yet";
    const profile = {
      client,
      metrics: {
        lifetimeValue,
        averageSpend,
        favoriteService,
        riskScore,
        lastVisit: client.lastVisitAt || "",
        inactiveDays,
        visitCount,
        loyaltyPoints: Number(client.loyaltyPoints || 0),
        outstandingBalance: 0,
        membershipStatus: client.membershipStatus || "none"
      },
      nextBestAction: riskScore >= 70
        ? { action: "Send personal win-back WhatsApp", reason: "High churn risk", channel: "WhatsApp", priority: "high" }
        : { action: "Ask for review after next visit", reason: "Healthy customer profile", channel: "WhatsApp", priority: "normal" },
      insights: []
    };
    return profile;
  }
  profile(clientId, access) {
    return this.intelligenceForClient(clientId, access, true);
  }

  addTimelineEvent(clientId, payload = {}, access) {
    if (!payload.title && !payload.body) throw badRequest("title or body is required");
    const storedClient = repositories.clients.getById(clientId, scope(access));
    if (!storedClient) throw notFound("Client not found");
    const client = normalizeClient(storedClient);
    if (client.branchId) tenantService.assertBranchAccess(access, client.branchId);
    const event = repositories.customerTimelineEvents.create({
      id: makeId("ctime"),
      branchId: client.branchId || "",
      clientId,
      type: payload.type || "note",
      title: payload.title || "Client note",
      body: payload.body || "",
      metadata: payload.metadata || { author: access.userId || "system" }
    }, scope(access, client.branchId || ""));
    if (payload.body) {
      repositories.clients.update(clientId, {
        notes: [client.notes, `${now().slice(0, 10)}: ${payload.body}`].filter(Boolean).join("\n")
      }, scope(access));
    }
    return event;
  }

  generateSnapshot(clientId, access) {
    const profile = this.intelligenceForClient(clientId, access, false);
    const snapshot = repositories.customerIntelligenceSnapshots.create({
      id: makeId("c360"),
      branchId: profile.client.branchId || "",
      clientId,
      metrics: profile.metrics,
      insights: profile.insights,
      nextBestAction: profile.nextBestAction,
      status: "generated"
    }, scope(access, profile.client.branchId || ""));
    return { snapshot, profile };
  }

  intelligenceForClient(clientId, access, includeTimeline = true) {
    const storedClient = repositories.clients.getById(clientId, scope(access));
    if (!storedClient) throw notFound("Client not found");
    const client = normalizeClient(storedClient);
    if (client.branchId) tenantService.assertBranchAccess(access, client.branchId);
    const queryScope = scope(access, client.branchId || "");
    const sales = repositories.sales.list({ branchId: client.branchId || "", limit: 10000 }, queryScope).filter((sale) => sale.clientId === clientId);
    const invoices = repositories.invoices.list({ limit: 10000 }, scope(access)).filter((invoice) => invoice.clientId === clientId);
    const appointments = repositories.appointments.list({ branchId: client.branchId || "", limit: 10000 }, queryScope).filter((appointment) => appointment.clientId === clientId);
    const memberships = repositories.memberships.list({ branchId: client.branchId || "", limit: 10000 }, queryScope).filter((membership) => membership.clientId === clientId);
    const walletTransactions = this.walletTransactions(clientId, access);
    const loyaltyTransactions = this.loyaltyTransactions(clientId, access);
    const reviews = this.reviewLinkage(clientId, access);
    const serviceCounts = new Map();
    const staffCounts = new Map();
    const productCounts = new Map();
    const colorHistory = [];
    for (const sale of sales) {
      for (const item of safeObjectList(sale.items)) {
        const name = cleanText(item.name || item.serviceName || item.productName || item.title || item.id);
        if (!name) continue;
        if (item.type === "service") serviceCounts.set(name, (serviceCounts.get(name) || 0) + Number(item.quantity || 1));
        if (item.type === "product") productCounts.set(name, (productCounts.get(name) || 0) + Number(item.quantity || 1));
        if (/colo[u]?r|highlight|balayage|global/i.test(name)) colorHistory.push(name);
      }
      if (sale.staffId) staffCounts.set(sale.staffId, (staffCounts.get(sale.staffId) || 0) + 1);
    }
    for (const appointment of appointments) {
      if (appointment.staffId) staffCounts.set(appointment.staffId, (staffCounts.get(appointment.staffId) || 0) + 1);
      for (const serviceId of safeIdList(appointment.serviceIds)) {
        const service = repositories.services.getById(serviceId, scope(access));
        if (service && typeof service === "object") {
          const serviceName = cleanText(service.name || service.serviceName || service.title || service.id);
          if (serviceName) serviceCounts.set(serviceName, (serviceCounts.get(serviceName) || 0) + 1);
        }
      }
    }
    const favoriteService = [...serviceCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || "No favorite yet";
    const preferredStaffId = [...staffCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || "";
    const preferredStaff = preferredStaffId ? repositories.staff.getById(preferredStaffId, scope(access)) : null;
    const lifetimeValue = money(Number(client.totalSpend || 0) || invoices.reduce((sum, invoice) => sum + Number(invoice.total || 0), 0));
    const visitCount = Number(client.visitCount || appointments.filter((item) => item.status === "completed").length || sales.length);
    const averageSpend = visitCount ? money(lifetimeValue / visitCount) : 0;
    const inactiveDays = daysSince(client.lastVisitAt);
    const noShows = appointments.filter((item) => item.status === "no-show").length;
    const cancellations = appointments.filter((item) => ["cancelled", "canceled"].includes(String(item.status || "").toLowerCase())).length;
    const negativeReviews = reviews.filter((review) => Number(review.rating || 0) <= 3 || String(review.sentiment || "").includes("negative"));
    const riskScore = Math.min(100, Math.round((inactiveDays > 90 ? 45 : inactiveDays > 45 ? 25 : 8) + noShows * 12 + cancellations * 5 + negativeReviews.length * 10 + (visitCount <= 1 ? 15 : 0)));
    const membershipSummary = this.membershipSummary(memberships);
    const wallet = this.walletSummary(client, walletTransactions, loyaltyTransactions);
    const nextBestAction = this.nextBestAction({ client, lifetimeValue, inactiveDays, riskScore, favoriteService, memberships, wallet, reviews });
    const visitHistory = this.visitHistory({ sales, invoices, appointments });
    const invoiceTotals = invoices.map((invoice) => Number(invoice.total || 0));
    const currentMonth = new Date().toISOString().slice(0, 7);
    const previousMonth = new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1).toISOString().slice(0, 7);
    const monthToDateSpend = money(invoices.filter((invoice) => monthKey(invoice.createdAt || invoice.invoiceDate) === currentMonth).reduce((sum, invoice) => sum + Number(invoice.total || 0), 0));
    const previousMonthSpend = money(invoices.filter((invoice) => monthKey(invoice.createdAt || invoice.invoiceDate) === previousMonth).reduce((sum, invoice) => sum + Number(invoice.total || 0), 0));
    const serviceSpend = money(sales.reduce((sum, sale) => sum + safeObjectList(sale.items).filter((item) => item.type === "service").reduce((lineSum, item) => lineSum + Number(item.total || item.price || 0) * Number(item.quantity || 1), 0), 0));
    const productSpend = money(sales.reduce((sum, sale) => sum + safeObjectList(sale.items).filter((item) => item.type === "product").reduce((lineSum, item) => lineSum + Number(item.total || item.price || 0) * Number(item.quantity || 1), 0), 0));
    const completedDates = appointments.filter((item) => item.status === "completed" && item.startAt).map((item) => item.startAt).sort();
    const topServices = [...serviceCounts.entries()].sort((a, b) => b[1] - a[1]).map(([name]) => name).slice(0, 3);
    const allServices = repositories.services.list({ limit: 10000 }, scope(access))
      .filter((service) => service && typeof service === "object")
      .map((service) => cleanText(service.name || service.serviceName || service.title))
      .filter(Boolean);
    const untriedServices = allServices.filter((name) => !serviceCounts.has(name)).slice(0, 5);
    const reviewAverage = reviews.length ? money(reviews.reduce((sum, review) => sum + Number(review.rating || 0), 0) / reviews.length) : null;
    const sentimentScore = reviews.length ? Math.max(0, Math.min(100, Math.round((reviewAverage || 0) * 20 - negativeReviews.length * 8))) : 70;
    const insights = [
      `${client.name} has lifetime value INR ${lifetimeValue}.`,
      favoriteService === "No favorite yet" ? "Favorite service is not established yet." : `Favorite service is ${favoriteService}.`,
      preferredStaff ? `Preferred staff appears to be ${preferredStaff.name}.` : "Preferred staff is not established yet.",
      riskScore >= 70 ? "High churn risk; prioritize personal follow-up." : "Risk is manageable with normal follow-up.",
      wallet.balance > 0 ? `Wallet balance INR ${wallet.balance} is available for retention offers.` : "No wallet balance is currently linked.",
      membershipSummary.activeMembership ? `Active membership: ${membershipSummary.activeMembership.planName || membershipSummary.activeMembership.name || membershipSummary.activeMembership.id}.` : "No active membership linked."
    ];
    const completeTimeline = includeTimeline ? this.timeline(client, sales, invoices, appointments, access, { walletTransactions, loyaltyTransactions, reviews, memberships }, { limit: 0 }) : [];
    const result = {
      client,
      metrics: {
        lifetimeValue,
        lastVisit: client.lastVisitAt || "",
        inactiveDays,
        favoriteService,
        averageSpend,
        riskScore,
        preferredStaffId,
        preferredStaffName: preferredStaff?.name || "",
        visitCount,
        outstandingBalance: money(invoices.reduce((sum, invoice) => sum + Number(invoice.balance || 0), 0)),
        loyaltyPoints: wallet.loyaltyBalance,
        membershipStatus: membershipSummary.status,
        firstVisitDate: completedDates[0] || client.createdAt || "",
        monthToDateSpend,
        previousMonthSpend,
        highestSingleBill: invoiceTotals.length ? Math.max(...invoiceTotals) : 0,
        averageDiscountPercent: averageDiscountPercent(invoices),
        productSpend,
        serviceSpend,
        visitFrequencyDays: visitFrequencyDays(completedDates),
        noShowCount: noShows,
        cancellationCount: cancellations,
        cancellationRate: appointments.length ? Math.round((cancellations / appointments.length) * 100) : 0,
        bookedCount: appointments.filter((item) => item.source !== "walk-in").length,
        walkInCount: appointments.filter((item) => item.source === "walk-in").length,
        peakVisitDay: peakVisit(appointments).day,
        peakVisitTime: peakVisit(appointments).time,
        topServices,
        untriedServices,
        lastProductPurchased: [...productCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || "",
        colorHistory: [...new Set(colorHistory)].slice(0, 5),
        allergyStatus: allergyStatus(client),
        patchTestDate: client.patchTestDate || client.lastPatchTestAt || "",
        referralCount: Number(client.referralCount || 0),
        reviewScore: reviewAverage,
        reviewCount: reviews.length,
        campaignOpenRate: Number(client.campaignOpenRate || 0),
        lastCampaignOpened: client.lastCampaignOpenedAt || "",
        birthday: client.birthday || "",
        anniversary: client.anniversary || "",
        daysUntilBirthday: daysUntil(client.birthday),
        communicationPreference: client.communicationPreference || client.preferredChannel || "WhatsApp",
        churnRiskScore: riskLabel(riskScore),
        churnRiskPercent: riskScore,
        sentimentScore,
        complaintCount: negativeReviews.length,
        lastComplaintDate: negativeReviews[0]?.createdAt || negativeReviews[0]?.reviewedAt || "",
        winBackStatus: riskScore >= 85 ? "Churned" : riskScore >= 70 ? "Lapsed" : riskScore >= 40 ? "Recovering" : "Active",
        aiInsightSummary: this.aiInsightSummary({ client, riskScore, nextBestAction, wallet, membershipSummary, reviews })
      },
      insights,
      nextBestAction,
      wallet,
      membershipSummary,
      reviewLinkage: {
        averageRating: reviewAverage,
        reviewCount: reviews.length,
        negativeCount: negativeReviews.length,
        latestReview: reviews[0] || null,
        reviews: reviews.slice(0, 10)
      },
      visitHistory,
      timeline: completeTimeline.slice(0, 80),
      serviceHistoryTimeline: completeTimeline.filter((event) => event.type === "purchase"),
      timelineMeta: { total: completeTimeline.length, returned: Math.min(80, completeTimeline.length), hasMore: completeTimeline.length > 80 }
    };
    return maskProfileContacts(result, access);
  }

  timeline(client, sales, invoices, appointments, access, linked = {}, options = {}) {
    const events = repositories.customerTimelineEvents.list({ branchId: client.branchId || "", limit: 100 }, scope(access, client.branchId || "")).filter((item) => item.clientId === client.id);
    const appointmentEvents = appointments.map((appointment) => ({
      id: `appt-${appointment.id}`,
      type: "appointment",
      title: `Appointment ${appointment.status}`,
      body: appointment.notes || appointment.source,
      createdAt: appointment.startAt,
      metadata: { appointmentId: appointment.id }
    }));
    const saleEvents = sales.map((sale) => ({
      id: `sale-${sale.id}`,
      type: "purchase",
      title: `Sale INR ${sale.total}`,
      body: safeObjectList(sale.items).map((item) => cleanText(item.name || item.serviceName || item.productName || item.title || "Item")).join(", "),
      createdAt: sale.createdAt,
      metadata: { saleId: sale.id }
    }));
    const invoiceEvents = invoices.map((invoice) => ({
      id: `invoice-${invoice.id}`,
      type: "invoice",
      title: `${invoice.invoiceNumber} ${invoice.status}`,
      body: `Paid INR ${invoice.paid}, balance INR ${invoice.balance}`,
      createdAt: invoice.createdAt,
      metadata: { invoiceId: invoice.id }
    }));
    const walletEvents = (linked.walletTransactions || []).map((row) => ({
      id: `wallet-${row.id}`,
      type: "wallet",
      title: `Wallet ${row.type}`,
      body: `Amount INR ${money(row.amount)}, balance INR ${money(row.balance_after)}`,
      createdAt: row.created_at,
      metadata: { invoiceId: row.invoice_id || "" }
    }));
    const reviewEvents = (linked.reviews || []).map((review) => ({
      id: `review-${review.id}`,
      type: "review",
      title: `Review ${review.rating || ""}/5`,
      body: review.reviewText || review.title || "",
      createdAt: review.reviewedAt || review.createdAt,
      metadata: { reviewId: review.id, platform: review.platformName || review.platformCode || "" }
    }));
    const membershipEvents = (linked.memberships || []).map((membership) => ({
      id: `membership-${membership.id}`,
      type: "membership",
      title: `Membership ${membership.status || "linked"}`,
      body: membership.planName || membership.name || membership.packageName || "",
      createdAt: membership.createdAt || membership.startDate || membership.validityDate,
      metadata: { membershipId: membership.id }
    }));
    const timeline = [...events, ...appointmentEvents, ...saleEvents, ...invoiceEvents, ...walletEvents, ...reviewEvents, ...membershipEvents].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
    return Number(options.limit || 0) > 0 ? timeline.slice(0, Number(options.limit)) : timeline;
  }

  nextBestAction({ client, lifetimeValue, inactiveDays, riskScore, favoriteService, memberships, wallet, reviews }) {
    if (riskScore >= 70) {
      return { action: "Send personal win-back WhatsApp", reason: "High churn risk", channel: "WhatsApp", priority: "high" };
    }
    if (reviews?.length && Number(reviews[0].rating || 0) <= 3) {
      return { action: "Manager recovery call", reason: "Recent low review needs recovery", channel: "Call", priority: "high" };
    }
    if (!memberships.length && lifetimeValue > 5000) {
      return { action: "Offer premium membership", reason: "High LTV without membership", channel: "Front desk", priority: "medium" };
    }
    if (wallet?.balance > 0 && inactiveDays > 15) {
      return { action: "Send wallet balance reminder", reason: "Unused wallet balance can drive next visit", channel: "WhatsApp", priority: "medium" };
    }
    if (inactiveDays > 30) {
      return { action: `Offer ${favoriteService} comeback package`, reason: "Client has not visited recently", channel: "WhatsApp", priority: "medium" };
    }
    if ((client.tags || []).includes("VIP")) {
      return { action: "Invite to priority slot or new launch", reason: "VIP relationship", channel: "Call", priority: "medium" };
    }
    return { action: "Ask for review after next visit", reason: "Healthy customer profile", channel: "WhatsApp", priority: "normal" };
  }

  walletTransactions(clientId, access) {
    return safeRows(
      `SELECT *
       FROM wallet_transactions
       WHERE tenant_id = @tenantId AND customer_id = @clientId
       ORDER BY created_at DESC, id DESC
       LIMIT 20`,
      { tenantId: access.tenantId, clientId }
    );
  }

  loyaltyTransactions(clientId, access) {
    return safeRows(
      `SELECT *
       FROM loyalty_transactions
       WHERE tenant_id = @tenantId AND customer_id = @clientId
       ORDER BY created_at DESC, id DESC
       LIMIT 20`,
      { tenantId: access.tenantId, clientId }
    );
  }

  reviewLinkage(clientId, access) {
    const reviewsV2 = safeRows(
      `SELECT r.*, p.platform_name, p.platform_code
       FROM reviews_v2 r
       LEFT JOIN review_platforms p ON p.id = r.platform_id AND p.tenant_id = r.tenant_id
       WHERE r.tenant_id = @tenantId AND r.customer_id = @clientId
       ORDER BY COALESCE(r.reviewed_at, r.imported_at, r.updated_at) DESC
       LIMIT 50`,
      { tenantId: access.tenantId, clientId }
    ).map((row) => ({
      id: row.id,
      rating: Number(row.rating || 0),
      title: row.title || "",
      reviewText: row.review_text || "",
      sentiment: row.sentiment || "",
      platformName: row.platform_name || row.platform_code || "Review",
      platformCode: row.platform_code || "",
      reviewedAt: row.reviewed_at || row.imported_at || row.updated_at || "",
      createdAt: row.created_at || row.imported_at || row.updated_at || ""
    }));
    if (reviewsV2.length) return reviewsV2;
    return repositories.reputationReviews.list({ limit: 10000 }, scope(access))
      .filter((review) => review.clientId === clientId || review.customerId === clientId)
      .map((review) => ({
        id: review.id,
        rating: Number(review.rating || 0),
        title: review.title || "",
        reviewText: review.reviewText || "",
        sentiment: review.sentiment || "",
        platformName: review.platform || "Legacy review",
        platformCode: review.platform || "legacy",
        reviewedAt: review.createdAt || "",
        createdAt: review.createdAt || ""
      }));
  }

  membershipSummary(memberships = []) {
    const activeMembership = memberships.find((membership) => membership.status === "active" || membership.isActive) || null;
    return {
      status: activeMembership ? "active" : memberships[0]?.status || "none",
      activeMembership,
      totalMemberships: memberships.length,
      activeCount: memberships.filter((membership) => membership.status === "active" || membership.isActive).length,
      renewalDue: memberships.some((membership) => membership.validityDate && daysSince(new Date(membership.validityDate).getTime() - 30 * 86400000) >= 0),
      memberships: memberships.slice(0, 10)
    };
  }

  walletSummary(client, walletTransactions = [], loyaltyTransactions = []) {
    const latestWallet = walletTransactions[0] || null;
    const latestLoyalty = loyaltyTransactions[0] || null;
    return {
      balance: money(latestWallet?.balance_after ?? client.walletBalance ?? 0),
      loyaltyBalance: Number(latestLoyalty?.balance_after ?? client.loyaltyPoints ?? 0),
      latestWalletTransaction: latestWallet,
      latestLoyaltyTransaction: latestLoyalty,
      transactions: walletTransactions.slice(0, 10),
      loyaltyTransactions: loyaltyTransactions.slice(0, 10)
    };
  }

  visitHistory({ sales = [], invoices = [], appointments = [] }) {
    return appointments
      .map((appointment) => {
        const invoice = invoices.find((item) => item.appointmentId === appointment.id) || null;
        const sale = sales.find((item) => item.appointmentId === appointment.id) || null;
        return {
          appointmentId: appointment.id,
          invoiceId: invoice?.id || "",
          saleId: sale?.id || "",
          status: appointment.status || "",
          startAt: appointment.startAt || appointment.createdAt || "",
          services: safeIdList(appointment.serviceIds).length ? safeIdList(appointment.serviceIds) : safeObjectList(sale?.items).filter((item) => item.type === "service").map((item) => cleanText(item.name || item.serviceName || item.title || "Service")),
          amount: money(invoice?.total || sale?.total || 0),
          paid: money(invoice?.paid || 0),
          balance: money(invoice?.balance || 0)
        };
      })
      .sort((a, b) => String(b.startAt).localeCompare(String(a.startAt)))
      .slice(0, 20);
  }

  aiInsightSummary({ client, riskScore, nextBestAction, wallet, membershipSummary, reviews }) {
    if (riskScore >= 70) return `${client.name} needs recovery: ${nextBestAction.action}.`;
    if (!membershipSummary.activeMembership && Number(client.totalSpend || 0) > 5000) return "High value client without membership; offer a relevant package.";
    if (wallet.balance > 0) return "Wallet balance is available; use it as a soft rebooking reminder.";
    if (reviews.length) return "Review history is linked; keep response tone aligned with latest sentiment.";
    return "Profile is healthy; continue normal follow-up and ask for feedback after next visit.";
  }
}

export const customer360Service = new Customer360Service();
