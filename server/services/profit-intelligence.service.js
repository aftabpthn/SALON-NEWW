import { db } from "../db.js";
import { tenantService } from "./tenant.service.js";

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
const OPERATING_EXPENSE_LIMIT = 1000;
const BREAKDOWN_LIMIT = 12;
const BUSINESS_HOURS_PER_DAY = 10;

const toPaise = (value) => Math.round((Number(value) || 0) * 100);
const fromPaise = (value) => Math.round(Number(value || 0)) / 100;
const clampPaise = (value) => Math.max(0, Math.round(Number(value || 0)));

function istDate(date = new Date()) {
  return new Date(date.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

function monthStart(dateText = istDate()) {
  return `${dateText.slice(0, 7)}-01`;
}

function dateValue(dateText = istDate()) {
  const [year, month, day] = String(dateText).slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(year || 1970, (month || 1) - 1, day || 1));
}

function dateText(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function addDaysText(date, days) {
  const value = dateValue(date);
  value.setUTCDate(value.getUTCDate() + Number(days || 0));
  return dateText(value);
}

function addYearsText(date, years) {
  const value = dateValue(date);
  value.setUTCFullYear(value.getUTCFullYear() + Number(years || 0));
  return dateText(value);
}

function periodDays(from, to) {
  const diff = dateValue(to).getTime() - dateValue(from).getTime();
  if (Number.isNaN(diff) || diff < 0) return 1;
  return Math.floor(diff / 86400000) + 1;
}

function periodWindow(from, to, params = {}) {
  return {
    ...params,
    from,
    to,
    startAt: `${from}T00:00:00`,
    endAt: `${to}T23:59:59`
  };
}

function tableExists(name) {
  return Boolean(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=@name").get({ name }));
}

function safeAll(sql, params = {}) {
  try {
    return db.prepare(sql).all(params);
  } catch {
    return [];
  }
}

function safeGet(sql, params = {}) {
  try {
    return db.prepare(sql).get(params) || {};
  } catch {
    return {};
  }
}

function periodParams(query = {}, access = {}) {
  const to = String(query.to || query.endDate || istDate()).slice(0, 10);
  const from = String(query.from || query.startDate || monthStart(to)).slice(0, 10);
  const branchId = String(query.branchId || access.branchId || "").trim();
  if (branchId) tenantService.assertBranchAccess(access, branchId);
  return {
    tenantId: access.tenantId,
    branchId,
    from,
    to,
    startAt: `${from}T00:00:00`,
    endAt: `${to}T23:59:59`
  };
}

function marginBps(amountPaise, revenuePaise) {
  if (!revenuePaise) return 0;
  return Math.round((Number(amountPaise || 0) / Number(revenuePaise || 1)) * 10000);
}

function changeBps(current, previous) {
  if (!previous) return current ? 10000 : 0;
  return Math.round(((Number(current || 0) - Number(previous || 0)) / Math.abs(Number(previous || 1))) * 10000);
}

function numberParam(query = {}, key, fallback = 0) {
  const value = Number(query[key]);
  return Number.isFinite(value) ? value : fallback;
}

function clampPercent(value, min = -100, max = 100) {
  return Math.max(min, Math.min(max, Number(value || 0)));
}

function roundPricePaise(value, stepPaise = 5000) {
  const amount = Math.max(0, Number(value || 0));
  return Math.ceil(amount / stepPaise) * stepPaise;
}

function textValue(value, fallback = "") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function classifyExpense(category = "") {
  const text = String(category || "").toLowerCase();
  if (/(cogs|consume|consumable|product cost|backbar|recipe)/.test(text)) return "productCost";
  if (/(salary|payroll|commission|incentive|bonus|overtime|pf|esi|tds|leave)/.test(text)) return "staffCost";
  return "operatingExpense";
}

function revenueType(line = {}) {
  const text = [
    line.type,
    line.itemType,
    line.category,
    line.name,
    line.serviceName,
    line.productName
  ].filter(Boolean).join(" ").toLowerCase();
  if (text.includes("membership")) return "membership";
  if (text.includes("package")) return "package";
  if (text.includes("gift")) return "giftCard";
  if (text.includes("tip")) return "tips";
  if (text.includes("cancel")) return "cancellationFees";
  if (text.includes("late")) return "lateFees";
  if (text.includes("product") || text.includes("retail")) return "product";
  if (text.includes("addon") || text.includes("add-on")) return "addOn";
  return "service";
}

function lineAmountPaise(line = {}) {
  const direct = line.total ?? line.amount ?? line.netAmount ?? line.lineTotal;
  if (direct !== undefined && direct !== null && direct !== "") return toPaise(direct);
  return toPaise(Number(line.price || line.rate || 0) * Number(line.quantity || line.qty || 1));
}

function lineName(line = {}) {
  return String(line.name || line.serviceName || line.productName || line.itemName || line.id || "Unmapped").trim() || "Unmapped";
}

function lineServiceId(line = {}) {
  return String(line.serviceId || line.service_id || line.id || "").trim();
}

function lineCategory(line = {}, serviceLookup = new Map()) {
  const serviceId = lineServiceId(line);
  const service = serviceId ? serviceLookup.get(serviceId) : null;
  const category = line.category || service?.category || (revenueType(line) === "product" ? "Products" : "Services");
  return String(category || "Uncategorized").trim() || "Uncategorized";
}

function entitlementType(line = {}) {
  const type = revenueType(line);
  if (type === "package") return "package";
  if (type === "membership") return "membership";
  return "";
}

function membershipRecordType(membership = {}) {
  const history = parseJsonArray(membership.redeemHistory);
  const credits = parseJsonArray(membership.serviceCredits);
  const planName = String(membership.planName || "").toLowerCase();
  if (history.some((item) => item?.type === "package_sale" || item?.packageId)) return "package";
  if (credits.some((item) => item?.packageId)) return "package";
  if (String(membership.id || "").startsWith("pkgmem_") || planName.startsWith("package:")) return "package";
  return "membership";
}

function mapKey(parts = []) {
  return parts.map((part) => String(part || "").trim().toLowerCase()).join("|");
}

function addAmount(map, key, seed, field, amountPaise) {
  if (!map.has(key)) map.set(key, { ...seed });
  const row = map.get(key);
  row[field] = Number(row[field] || 0) + Number(amountPaise || 0);
  return row;
}

function marginRow(row = {}) {
  const revenuePaise = Number(row.revenuePaise || 0);
  const productCostPaise = Number(row.productCostPaise || 0);
  const staffCostPaise = Number(row.staffCostPaise || 0);
  const operatingExpensePaise = Number(row.operatingExpensePaise || 0);
  const grossProfitPaise = revenuePaise - productCostPaise;
  const netProfitPaise = grossProfitPaise - staffCostPaise - operatingExpensePaise;
  return {
    ...row,
    grossProfitPaise,
    netProfitPaise,
    grossMarginBps: marginBps(grossProfitPaise, revenuePaise),
    netMarginBps: marginBps(netProfitPaise, revenuePaise)
  };
}

function parseJsonArray(value) {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function revenueBreakdown(invoices = []) {
  const totals = new Map();
  for (const invoice of invoices) {
    const lines = parseJsonArray(invoice.lineItems);
    if (!lines.length) {
      totals.set("service", Number(totals.get("service") || 0) + toPaise(invoice.total));
      continue;
    }
    for (const line of lines) {
      const type = revenueType(line);
      totals.set(type, Number(totals.get(type) || 0) + lineAmountPaise(line));
    }
  }
  return [...totals.entries()]
    .map(([key, amountPaise]) => ({ key, label: labelForRevenue(key), amountPaise }))
    .sort((a, b) => b.amountPaise - a.amountPaise);
}

function labelForRevenue(key) {
  return {
    service: "Service Sales",
    product: "Product Sales",
    membership: "Membership Sales",
    package: "Package Sales",
    giftCard: "Gift Card Sales",
    tips: "Tips",
    addOn: "Add-on Services",
    cancellationFees: "Cancellation Fees",
    lateFees: "Late Fees"
  }[key] || key;
}

export class ProfitIntelligenceService {
  summary(query = {}, access = {}) {
    const params = periodParams(query, access);
    const invoices = this.invoiceRows(params);
    const payments = this.paymentRows(params);
    const revenuePaise = invoices.reduce((sum, row) => sum + toPaise(row.total), 0);
    const collectionsPaise = payments.reduce((sum, row) => sum + Math.max(0, toPaise(row.amount)), 0);
    const refundPaise = payments.reduce((sum, row) => sum + Math.abs(Math.min(0, toPaise(row.amount))), 0);
    const expenseRows = this.operatingExpenseRows(params);
    const expenseTotals = this.classifiedExpenses(expenseRows);
    const journalCogsPaise = this.journalCogsPaise(params);
    const consumeCogsPaise = this.productConsumeCogsPaise(params);
    const operationalCogsPaise = consumeCogsPaise + expenseTotals.productCostPaise;
    const productCostPaise = journalCogsPaise > 0 ? journalCogsPaise : operationalCogsPaise;
    const payoutStaffPaise = this.staffPayoutPaise(params);
    const commissionPaise = this.salesCommissionPaise(params);
    const staffCostPaise = payoutStaffPaise > 0 ? payoutStaffPaise : expenseTotals.staffCostPaise + commissionPaise;
    const operatingExpensePaise = expenseTotals.operatingExpensePaise;
    const grossProfitPaise = revenuePaise - productCostPaise;
    const netProfitPaise = grossProfitPaise - staffCostPaise - operatingExpensePaise - refundPaise;
    const breakdown = revenueBreakdown(invoices);
    const metrics = {
      revenuePaise,
      collectionsPaise,
      refundPaise,
      productCostPaise,
      staffCostPaise,
      operatingExpensePaise,
      grossProfitPaise,
      netProfitPaise,
      grossMarginBps: marginBps(grossProfitPaise, revenuePaise),
      netMarginBps: marginBps(netProfitPaise, revenuePaise)
    };
    const profitBreakdown = this.breakdown(query, access);
    const recipeVariance = this.recipeVariance(params);
    const ceoKpis = this.ceoKpis(params, metrics, profitBreakdown, expenseTotals.breakdown);
    const pricingAutopilot = this.pricingAutopilot(query, profitBreakdown);
    const profitLeaks = this.profitLeaks(params, metrics, invoices, payments, recipeVariance);
    const customerProfitScore = this.customerProfitScore(profitBreakdown);
    const membershipRisk = this.membershipRisk(profitBreakdown);
    const enterpriseAnalytics = this.enterpriseAnalytics(params, metrics, invoices, expenseRows, profitBreakdown);

    return {
      period: { from: params.from, to: params.to, branchId: params.branchId },
      metrics,
      ceoKpis,
      profitDigitalTwin: this.profitDigitalTwin(query, metrics),
      pricingAutopilot,
      recipeVariance,
      profitLeaks,
      customerProfitScore,
      membershipRisk,
      enterpriseAnalytics,
      autoBoardReport: this.autoBoardReport({ metrics, ceoKpis, revenueBreakdown: breakdown, expenseBreakdown: expenseTotals.breakdown, profitBreakdown, recipeVariance, pricingAutopilot, profitLeaks, membershipRisk, enterpriseAnalytics }),
      revenueBreakdown: breakdown,
      expenseBreakdown: expenseTotals.breakdown,
      sourceHealth: {
        invoices: invoices.length,
        payments: payments.length,
        expenses: expenseRows.length,
        cogsSource: journalCogsPaise > 0 ? "journalEntryLines" : consumeCogsPaise > 0 ? "productConsumeDrafts" : expenseTotals.productCostPaise > 0 ? "financeExpenses" : "missing",
        staffCostSource: payoutStaffPaise > 0 ? "financeStaffPayouts" : commissionPaise > 0 ? "salesCommission" : expenseTotals.staffCostPaise > 0 ? "financeExpenses" : "missing"
      },
      diagnostics: this.diagnostics({ revenuePaise, productCostPaise, staffCostPaise, operatingExpensePaise, invoices }),
      display: {
        revenue: fromPaise(revenuePaise),
        grossProfit: fromPaise(grossProfitPaise),
        netProfit: fromPaise(netProfitPaise)
      }
    };
  }

  copilot(payload = {}, access = {}) {
    const question = textValue(payload.question, "profit kam kyu hai?");
    const report = this.summary(payload, access);
    const reasons = this.copilotReasons(report);
    const metrics = this.copilotMetrics(report);
    const recommendedActions = this.copilotActions(report);
    return {
      engine: "rule-based",
      question,
      answer: this.copilotAnswer(question, report, reasons, recommendedActions),
      reasons,
      metrics,
      recommendedActions
    };
  }

  copilotAnswer(question = "", report = {}, reasons = [], actions = []) {
    const q = String(question || "").toLowerCase();
    const metrics = report.metrics || {};
    const analytics = report.enterpriseAnalytics || {};
    if (/(forecast|next month|agla mahina|agle mahine)/.test(q)) {
      return `Next month forecast ${fromPaise(analytics.forecast?.nextMonthProfitPaise)} hai, basis: ${analytics.forecast?.basis || "current run-rate"}. Net margin abhi ${(Number(metrics.netMarginBps || 0) / 100).toFixed(1)}% hai.`;
    }
    if (/(top loss|loss reason|sabse bada|biggest)/.test(q)) {
      const top = reasons[0];
      return top
        ? `Top loss/profit pressure reason: ${top.message} Estimated impact ${fromPaise(top.impactPaise)}. Next action: ${actions[0]?.title || "profit action queue review karein"}.`
        : "Abhi koi major loss signal nahi mila. Margin stable hai; top services aur repeat customers par focus rakhein.";
    }
    if (/(kyu|why|kam|down|gir|profit)/.test(q)) {
      const topReasons = reasons.slice(0, 3).map((item, index) => `${index + 1}. ${item.message}`).join(" ");
      return topReasons
        ? `Profit pressure ke main reasons: ${topReasons} Sabse pehla fix: ${actions[0]?.title || "pricing, wastage aur expenses review karein"}.`
        : `Profit stable dikh raha hai. Net profit ${fromPaise(metrics.netProfitPaise)} aur net margin ${(Number(metrics.netMarginBps || 0) / 100).toFixed(1)}% hai.`;
    }
    return `Current revenue ${fromPaise(metrics.revenuePaise)}, net profit ${fromPaise(metrics.netProfitPaise)}, net margin ${(Number(metrics.netMarginBps || 0) / 100).toFixed(1)}%. Top recommendation: ${actions[0]?.title || "profit action queue review karein"}.`;
  }

  copilotReasons(report = {}) {
    const reasons = [];
    for (const leak of report.profitLeaks || []) {
      reasons.push({
        type: leak.type || "profit_leak",
        label: leak.type || "Profit leak",
        impactPaise: Math.max(0, Number(leak.estimatedImpactPaise || 0)),
        message: leak.message || leak.recommendedAction || "Profit leak detected"
      });
    }
    for (const row of report.recipeVariance?.rows || []) {
      if (!["red", "amber", "high", "medium"].includes(String(row.severity || "").toLowerCase())) continue;
      reasons.push({
        type: "recipe_variance",
        label: row.productName || row.serviceName || row.staffName || "Wastage",
        impactPaise: Math.max(0, Number(row.variancePaise || 0)),
        message: row.recommendation || "Recipe variance high hai"
      });
    }
    for (const risk of report.membershipRisk || []) {
      if (!["high", "medium"].includes(String(risk.severity || "").toLowerCase())) continue;
      reasons.push({
        type: "membership_liability_risk",
        label: risk.planName || "Membership",
        impactPaise: Math.abs(Math.min(0, Number(risk.riskImpactPaise || 0))) || Number(risk.remainingLiabilityPaise || 0),
        message: risk.recommendation || "Membership liability risk high hai"
      });
    }
    for (const alert of report.enterpriseAnalytics?.alerts || []) {
      reasons.push({
        type: alert.type || "analytics_alert",
        label: alert.type || "Analytics alert",
        impactPaise: 0,
        message: alert.message || "Enterprise analytics alert"
      });
    }
    return reasons.sort((a, b) => Number(b.impactPaise || 0) - Number(a.impactPaise || 0)).slice(0, 8);
  }

  copilotMetrics(report = {}) {
    const metrics = report.metrics || {};
    const forecast = report.enterpriseAnalytics?.forecast || {};
    return [
      { label: "Revenue", valuePaise: Number(metrics.revenuePaise || 0) },
      { label: "Gross Profit", valuePaise: Number(metrics.grossProfitPaise || 0), valueBps: Number(metrics.grossMarginBps || 0) },
      { label: "Net Profit", valuePaise: Number(metrics.netProfitPaise || 0), valueBps: Number(metrics.netMarginBps || 0) },
      { label: "Next Month Forecast", valuePaise: Number(forecast.nextMonthProfitPaise || 0) }
    ];
  }

  copilotActions(report = {}) {
    const actions = [];
    for (const rec of report.pricingAutopilot?.recommendations || []) {
      if (Number(rec.expectedProfitLiftPaise || 0) <= 0) continue;
      actions.push({ title: `Approve ${rec.serviceName} price review`, impactPaise: Number(rec.expectedProfitLiftPaise || 0), sourceType: "pricing_recommendation" });
    }
    for (const leak of report.profitLeaks || []) {
      actions.push({ title: leak.recommendedAction || "Fix profit leak", impactPaise: Number(leak.estimatedImpactPaise || 0), sourceType: leak.type || "profit_leak" });
    }
    for (const row of report.recipeVariance?.rows || []) {
      if (Number(row.variancePaise || 0) <= 0) continue;
      actions.push({ title: row.recommendation || "Audit recipe variance", impactPaise: Number(row.variancePaise || 0), sourceType: "recipe_variance" });
    }
    for (const risk of report.membershipRisk || []) {
      actions.push({ title: risk.recommendation || "Review membership liability", impactPaise: Math.abs(Math.min(0, Number(risk.riskImpactPaise || 0))), sourceType: "membership_liability_risk" });
    }
    for (const suggestion of report.enterpriseAnalytics?.suggestions || []) {
      actions.push({ title: suggestion, impactPaise: 0, sourceType: "enterprise_suggestion" });
    }
    return actions.sort((a, b) => Number(b.impactPaise || 0) - Number(a.impactPaise || 0)).slice(0, 5);
  }

  autoBoardReport({ metrics = {}, ceoKpis = {}, revenueBreakdown = [], expenseBreakdown = [], profitBreakdown = {}, recipeVariance = {}, pricingAutopilot = {}, profitLeaks = [], membershipRisk = [], enterpriseAnalytics = {} } = {}) {
    const topWins = [
      Number(metrics.netProfitPaise || 0) > 0 ? `Net profit positive at ${fromPaise(metrics.netProfitPaise)}` : "",
      ceoKpis.topService?.label && ceoKpis.topService.label !== "No data" ? `${ceoKpis.topService.label} top service profit contributor hai` : "",
      ceoKpis.topStaff?.label && ceoKpis.topStaff.label !== "No data" ? `${ceoKpis.topStaff.label} top staff profit contributor hai` : "",
      pricingAutopilot.recommendations?.[0]?.expectedProfitLiftPaise ? `Pricing Autopilot recovery ${fromPaise(pricingAutopilot.recommendations[0].expectedProfitLiftPaise)} identified` : "",
      enterpriseAnalytics.forecast?.nextMonthProfitPaise > 0 ? `Next month forecast positive at ${fromPaise(enterpriseAnalytics.forecast.nextMonthProfitPaise)}` : "",
      revenueBreakdown[0]?.label ? `${revenueBreakdown[0].label} strongest revenue source hai` : ""
    ].filter(Boolean).slice(0, 5);
    const topRisks = [
      ...profitLeaks.map((item) => item.message || item.recommendedAction),
      ...(recipeVariance.rows || []).filter((row) => ["red", "amber"].includes(String(row.severity || "").toLowerCase())).map((row) => row.recommendation),
      ...membershipRisk.filter((row) => ["high", "medium"].includes(String(row.severity || "").toLowerCase())).map((row) => row.recommendation),
      ...(enterpriseAnalytics.alerts || []).map((item) => item.message),
      expenseBreakdown[0]?.category ? `${expenseBreakdown[0].category} highest expense line hai` : ""
    ].filter(Boolean).slice(0, 5);
    const nextActions = this.copilotActions({ pricingAutopilot, profitLeaks, recipeVariance, membershipRisk, enterpriseAnalytics }).map((item) => item.title).slice(0, 5);
    const expectedRecoveryProfitPaise = this.copilotActions({ pricingAutopilot, profitLeaks, recipeVariance, membershipRisk, enterpriseAnalytics })
      .reduce((sum, item) => sum + Math.max(0, Number(item.impactPaise || 0)), 0);
    return {
      revenuePaise: Number(metrics.revenuePaise || 0),
      grossProfitPaise: Number(metrics.grossProfitPaise || 0),
      netProfitPaise: Number(metrics.netProfitPaise || 0),
      marginBps: Number(metrics.netMarginBps || 0),
      grossMarginBps: Number(metrics.grossMarginBps || 0),
      topWins: topWins.length ? topWins : ["No major wins detected yet."],
      topRisks: topRisks.length ? topRisks : ["No major risks detected yet."],
      nextActions: nextActions.length ? nextActions : ["Continue monitoring pricing, wastage and expense trend."],
      expectedRecoveryProfitPaise
    };
  }

  customerProfitScore(breakdown = {}) {
    return (breakdown.customerProfit || [])
      .map((customer) => this.customerScoreRow(customer))
      .sort((a, b) => b.profitScore - a.profitScore || b.profitPaise - a.profitPaise)
      .slice(0, BREAKDOWN_LIMIT);
  }

  customerScoreRow(customer = {}) {
    const revenuePaise = Number(customer.revenuePaise || 0);
    const profitPaise = Number(customer.netProfitPaise || customer.grossProfitPaise || 0);
    const discountPaise = Number(customer.discountPaise || 0);
    const productCostPaise = Number(customer.productCostPaise || 0);
    const visits = Number(customer.visits || 0);
    const avgBillPaise = Number(customer.avgBillPaise || (visits ? Math.round(revenuePaise / visits) : 0));
    const lifetimeRevenuePaise = Number(customer.lifetimeRevenuePaise || revenuePaise);
    const margin = marginBps(profitPaise, revenuePaise);
    const discountBps = marginBps(discountPaise, revenuePaise);
    const profitScore = Math.max(0, Math.min(100, Math.round(
      50 + (margin / 180) + Math.min(24, visits * 3) - (discountBps / 250) + (avgBillPaise >= 500000 ? 6 : 0)
    )));
    let tier = "Low Value";
    let recommendation = "Low-margin ya low-frequency customer hai; targeted bundle, reactivation offer aur discount control use karein.";
    if (discountBps >= 1500) {
      tier = "Discount Dependent";
      recommendation = "Discount cap tighten karein aur prepaid package ya value-add offer shift karein.";
    } else if (revenuePaise >= 100000 && margin < 2500) {
      tier = "High Revenue Low Margin";
      recommendation = "High spend ke bawajood margin low hai; recipe, add-ons aur price override review karein.";
    } else if (lifetimeRevenuePaise >= 200000 && visits <= 1) {
      tier = "Churn Risk High LTV";
      recommendation = "High LTV customer dormant ho raha hai; senior stylist callback aur retention task create karein.";
    } else if (profitPaise > 0 && (profitScore >= 65 || margin >= 3500)) {
      tier = "VIP Profitable";
      recommendation = "Premium slot access, membership renewal aur high-margin add-on upsell prioritize karein.";
    }
    return {
      clientId: customer.clientId || "",
      clientName: customer.clientName || "Walk-in",
      revenuePaise,
      profitPaise,
      discountPaise,
      productCostPaise,
      visits,
      avgBillPaise,
      profitScore,
      tier,
      recommendation
    };
  }

  membershipRisk(breakdown = {}) {
    return [
      ...(breakdown.membershipProfit || []).map((plan) => this.membershipRiskRow(plan, "membership")),
      ...(breakdown.packageProfit || []).map((plan) => this.membershipRiskRow(plan, "package"))
    ]
      .sort((a, b) => a.riskImpactPaise - b.riskImpactPaise || b.remainingLiabilityPaise - a.remainingLiabilityPaise)
      .slice(0, BREAKDOWN_LIMIT);
  }

  membershipRiskRow(plan = {}, kind = "membership") {
    const soldValuePaise = Number(plan.soldValuePaise || 0);
    const redeemedValuePaise = Number(plan.redeemedValuePaise || 0);
    const remainingLiabilityPaise = Number(plan.remainingLiabilityPaise || 0);
    const productCostPaise = Number(plan.productCostPaise || 0);
    const redemptionBasePaise = Math.max(1, redeemedValuePaise);
    const projectedCostPaise = Math.round(remainingLiabilityPaise * Math.min(9000, marginBps(productCostPaise, redemptionBasePaise)) / 10000);
    const riskImpactPaise = soldValuePaise - redeemedValuePaise - remainingLiabilityPaise - projectedCostPaise;
    const liabilityBps = marginBps(remainingLiabilityPaise, Math.max(1, soldValuePaise));
    const severity = riskImpactPaise < 0 ? "high" : liabilityBps >= 3500 ? "medium" : "low";
    const recommendation = severity === "high"
      ? "Future redemptions profit negative kar sakte hain; plan pricing, redemption cap aur recipe cost urgently review karein."
      : severity === "medium"
        ? "Liability high hai; redemption pacing aur add-on upsell monitor karein."
        : "Liability controlled hai; renewal aur upgrade offer continue rakhein.";
    return {
      kind,
      planName: plan.planName || (kind === "package" ? "Package" : "Membership"),
      soldValuePaise,
      redeemedValuePaise,
      remainingLiabilityPaise,
      projectedCostPaise,
      riskImpactPaise,
      severity,
      recommendation
    };
  }

  pricingAutopilot(query = {}, breakdown = {}) {
    const targetMarginBps = Math.max(1000, Math.min(8000, Math.round(numberParam(query, "targetMarginBps", 3500))));
    const recommendations = (breakdown.serviceProfit || [])
      .filter((service) => Number(service.revenuePaise || 0) > 0)
      .map((service) => this.pricingRecommendation(service, targetMarginBps))
      .sort((a, b) => b.expectedProfitLiftPaise - a.expectedProfitLiftPaise)
      .slice(0, BREAKDOWN_LIMIT);
    return {
      targetMarginBps,
      recommendations,
      source: "serviceProfit actual revenue, product COGS, staff cost and services.price"
    };
  }

  pricingRecommendation(service = {}, targetMarginBps = 3500) {
    const demandVolume = Math.max(1, Number(service.invoiceCount || 0));
    const currentPricePaise = Number(service.currentPricePaise || 0) || Math.round(Number(service.revenuePaise || 0) / demandVolume);
    const expectedCostPaise = Math.round((Number(service.productCostPaise || 0) + Number(service.staffCostPaise || 0)) / demandVolume);
    const targetPricePaise = targetMarginBps < 9900
      ? roundPricePaise(expectedCostPaise / (1 - targetMarginBps / 10000))
      : currentPricePaise;
    const currentMarginBps = Number(service.netMarginBps || 0);
    const demandRisk = demandVolume >= 8 ? "low" : demandVolume >= 3 ? "medium" : "high";
    const maxLiftBps = demandRisk === "low" ? 2000 : demandRisk === "medium" ? 1200 : 700;
    const cappedPricePaise = roundPricePaise(currentPricePaise * (1 + maxLiftBps / 10000));
    const shouldIncrease = currentMarginBps < targetMarginBps;
    const recommendedPricePaise = shouldIncrease ? Math.max(currentPricePaise, Math.min(targetPricePaise, cappedPricePaise)) : currentPricePaise;
    const projectedProfitPaise = recommendedPricePaise - expectedCostPaise;
    return {
      serviceId: service.serviceId || "",
      serviceName: service.serviceName || "Unmapped service",
      currentPricePaise,
      recommendedPricePaise,
      expectedProfitLiftPaise: Math.max(0, (recommendedPricePaise - currentPricePaise) * demandVolume),
      currentMarginBps,
      projectedMarginBps: marginBps(projectedProfitPaise, recommendedPricePaise),
      demandRisk,
      demandVolume,
      reason: this.pricingReason({ service, currentMarginBps, targetMarginBps, demandRisk, recommendedPricePaise, currentPricePaise })
    };
  }

  pricingReason({ service = {}, currentMarginBps = 0, targetMarginBps = 3500, demandRisk = "medium", recommendedPricePaise = 0, currentPricePaise = 0 }) {
    if (currentMarginBps >= targetMarginBps) return `${service.serviceName || "Service"} target margin ke andar hai; price hold karein aur add-on attach karein.`;
    if (demandRisk === "low") return `${service.serviceName || "Service"} demand strong hai aur margin target se kam hai; controlled price increase recommend hai.`;
    if (recommendedPricePaise > currentPricePaise) return `${service.serviceName || "Service"} margin low hai, lekin demand moderate/high risk hai; smaller increase ya bundle offer better rahega.`;
    return `${service.serviceName || "Service"} low demand hai; direct price increase ke bajay bundle, add-on ya recipe cost review karein.`;
  }

  recipeVariance(params = {}) {
    const drafts = this.productConsumeVarianceDrafts(params);
    const recipeExpectedCost = this.serviceRecipeExpectedCostMap(params);
    const rows = new Map();
    const productRows = new Map();
    const addVariance = (key, seed, expectedCostPaise, actualCostPaise) => {
      const row = rows.get(key) || { ...seed, expectedCostPaise: 0, actualCostPaise: 0, variancePaise: 0, draftCount: 0 };
      row.expectedCostPaise += expectedCostPaise;
      row.actualCostPaise += actualCostPaise;
      row.variancePaise += actualCostPaise - expectedCostPaise;
      row.draftCount += 1;
      rows.set(key, row);
    };
    for (const draft of drafts) {
      const expectedCostPaise = this.expectedCostForDraft(draft, recipeExpectedCost);
      const actualCostPaise = this.actualCostForDraft(draft);
      const branchId = draft.branchId || "";
      const serviceId = draft.serviceId || "";
      const serviceName = draft.serviceName || serviceId || "Service";
      const staffId = draft.staffId || "";
      const staffName = draft.staffName || staffId || "Unassigned";
      addVariance(`service|${branchId}|${serviceId || serviceName}`, { dimension: "service", serviceId, serviceName, branchId, staffId: "", staffName: "" }, expectedCostPaise, actualCostPaise);
      addVariance(`staff|${branchId}|${staffId || staffName}|${serviceId || serviceName}`, { dimension: "staff", serviceId, serviceName, branchId, staffId, staffName }, expectedCostPaise, actualCostPaise);
      addVariance(`branch|${branchId}`, { dimension: "branch", serviceId: "", serviceName: branchId || "All branches", branchId, staffId: "", staffName: "" }, expectedCostPaise, actualCostPaise);
      for (const line of parseJsonArray(draft.lineItemsJson)) {
        const expectedLinePaise = toPaise(line.expectedCost ?? line.expected_cost ?? 0);
        const actualLinePaise = toPaise(line.actualCost ?? line.actual_cost ?? 0);
        if (actualLinePaise <= expectedLinePaise) continue;
        const productId = String(line.productId || line.product_id || "").trim();
        const productName = line.productName || line.product_name || productId || "Product";
        const key = `product|${branchId}|${serviceId || serviceName}|${staffId || staffName}|${productId || productName}`;
        const row = productRows.get(key) || {
          dimension: "product",
          serviceId,
          serviceName,
          branchId,
          staffId,
          staffName,
          productId,
          productName,
          expectedCostPaise: 0,
          actualCostPaise: 0,
          variancePaise: 0,
          draftCount: 0
        };
        row.expectedCostPaise += expectedLinePaise;
        row.actualCostPaise += actualLinePaise;
        row.variancePaise += actualLinePaise - expectedLinePaise;
        row.draftCount += 1;
        productRows.set(key, row);
      }
    }
    return {
      rows: [...rows.values(), ...productRows.values()]
        .map((row) => this.recipeVarianceRow(row))
        .sort((a, b) => b.variancePaise - a.variancePaise)
        .slice(0, BREAKDOWN_LIMIT),
      sourceHealth: {
        drafts: drafts.length,
        recipes: recipeExpectedCost.size,
        source: "product_consume_drafts.expected_cost + actual_cost + line_items_json"
      }
    };
  }

  recipeVarianceRow(row = {}) {
    const varianceBps = marginBps(Number(row.variancePaise || 0), Number(row.expectedCostPaise || 0));
    const severity = row.variancePaise <= 0 ? "green" : Number(row.expectedCostPaise || 0) <= 0 ? "red" : varianceBps >= 2500 ? "red" : varianceBps >= 1000 ? "amber" : "green";
    const label = row.productName || row.staffName || row.serviceName || row.branchId || "Recipe";
    return {
      ...row,
      varianceBps,
      severity,
      recommendation: this.recipeVarianceRecommendation({ ...row, varianceBps, severity, label })
    };
  }

  recipeVarianceRecommendation(row = {}) {
    if (row.severity === "green") return `${row.label} recipe usage stable hai.`;
    if (row.dimension === "product") return `${row.productName || "Product"} overuse detect hua; actual quantity vs recipe max review karein.`;
    if (row.dimension === "staff") return `${row.staffName || "Staff"} ke service consume me variance high hai; coaching ya approval check karein.`;
    if (row.dimension === "branch") return `${row.branchId || "Branch"} me product cost recipe se zyada hai; branch wastage audit karein.`;
    return `${row.serviceName || "Service"} recipe variance high hai; recipe quantity, wastage percent aur product issue flow review karein.`;
  }

  profitLeaks(params = {}, metrics = {}, invoices = [], payments = [], recipeVariance = {}) {
    const serviceLookup = this.serviceLookup(params);
    const leaks = [];
    for (const invoice of invoices) {
      leaks.push(...this.invoiceProfitLeaks(invoice, serviceLookup));
    }
    const discountPaise = invoices.reduce((sum, row) => sum + Math.max(toPaise(row.discount), toPaise(row.discountTotal)), 0);
    if (metrics.revenuePaise > 0 && discountPaise > 0 && marginBps(discountPaise, metrics.revenuePaise) >= 1200) {
      leaks.push(this.leakRow({
        type: "discount_abuse",
        severity: marginBps(discountPaise, metrics.revenuePaise) >= 2000 ? "high" : "medium",
        branchId: params.branchId,
        sourceId: "period_discount",
        estimatedImpactPaise: discountPaise,
        message: `Discounts selected period revenue ka ${Math.round(marginBps(discountPaise, metrics.revenuePaise) / 100)}% hain.`,
        recommendedAction: "Manager approval threshold tighten karein aur discount reason audit karein."
      }));
    }
    if (metrics.revenuePaise > 0 && metrics.refundPaise > 0 && marginBps(metrics.refundPaise, metrics.revenuePaise) >= 500) {
      leaks.push(this.leakRow({
        type: "high_refunds",
        severity: marginBps(metrics.refundPaise, metrics.revenuePaise) >= 1000 ? "high" : "medium",
        branchId: params.branchId,
        sourceId: "period_refunds",
        estimatedImpactPaise: metrics.refundPaise,
        message: "Refund ratio normal threshold se upar hai.",
        recommendedAction: "Refund approval, service complaint reasons aur staff-wise refund trend review karein."
      }));
    }
    const collectionGapPaise = Math.max(0, Number(metrics.revenuePaise || 0) - Number(metrics.collectionsPaise || 0) - Number(metrics.refundPaise || 0));
    if (metrics.revenuePaise > 0 && marginBps(collectionGapPaise, metrics.revenuePaise) >= 1000) {
      leaks.push(this.leakRow({
        type: "low_collection",
        severity: marginBps(collectionGapPaise, metrics.revenuePaise) >= 2500 ? "high" : "medium",
        branchId: params.branchId,
        sourceId: "period_collection_gap",
        estimatedImpactPaise: collectionGapPaise,
        message: "Booked revenue aur collected payments me gap high hai.",
        recommendedAction: "Pending invoices par payment recovery workflow aur front-desk closeout audit run karein."
      }));
    }
    for (const row of recipeVariance.rows || []) {
      if (!row.variancePaise || row.severity === "green") continue;
      leaks.push(this.leakRow({
        type: "inventory_mismatch",
        severity: row.severity === "red" ? "high" : "medium",
        branchId: row.branchId || params.branchId,
        sourceId: `${row.dimension}:${row.serviceId || row.productId || row.branchId || "variance"}`,
        estimatedImpactPaise: row.variancePaise,
        message: row.productName ? `${row.productName} overuse recipe expectation se zyada hai.` : `${row.serviceName || row.branchId || "Recipe"} consume variance high hai.`,
        recommendedAction: row.recommendation || "Recipe, stock issue aur consume confirmation audit karein."
      }));
    }
    return leaks
      .filter((leak) => leak.estimatedImpactPaise > 0)
      .sort((a, b) => b.estimatedImpactPaise - a.estimatedImpactPaise)
      .slice(0, BREAKDOWN_LIMIT);
  }

  invoiceProfitLeaks(invoice = {}, serviceLookup = new Map()) {
    const leaks = [];
    const lines = parseJsonArray(invoice.lineItems);
    const invoiceBranchId = invoice.branchId || "";
    const invoiceId = invoice.id || invoice.invoiceNumber || "";
    for (const line of lines) {
      const serviceId = lineServiceId(line);
      const service = serviceId ? serviceLookup.get(serviceId) : serviceLookup.get(mapKey([lineName(line)]));
      const qty = Math.max(1, Number(line.quantity || line.qty || 1));
      const expectedPricePaise = toPaise(service?.price || line.originalPrice || line.basePrice || line.listPrice || 0) * qty;
      const actualPaise = lineAmountPaise(line);
      const type = revenueType(line);
      const name = lineName(line);
      if ((type === "addOn" || /add[-\s]?on|addon/i.test(name)) && actualPaise <= 0) {
        leaks.push(this.leakRow({
          type: "unbilled_add_on",
          severity: "medium",
          branchId: invoiceBranchId,
          sourceId: invoiceId,
          estimatedImpactPaise: expectedPricePaise || 50000,
          message: `${name} add-on invoice me billed nahi hua.`,
          recommendedAction: "POS add-on mandatory pricing aur checkout validation enable karein."
        }));
      }
      if (expectedPricePaise > 0 && actualPaise > 0 && expectedPricePaise - actualPaise >= Math.max(10000, Math.round(expectedPricePaise * 0.15))) {
        const explicitDiscount = Number(line.discount || line.discountAmount || line.discount_amount || 0) > 0;
        const overrideFlag = line.priceOverride || line.manualPriceOverride || line.overrideReason || line.price_override;
        if (overrideFlag || !explicitDiscount) {
          leaks.push(this.leakRow({
            type: "manual_price_override",
            severity: expectedPricePaise - actualPaise >= Math.round(expectedPricePaise * 0.3) ? "high" : "medium",
            branchId: invoiceBranchId,
            sourceId: invoiceId,
            estimatedImpactPaise: expectedPricePaise - actualPaise,
            message: `${name} expected price se kam bill hua.`,
            recommendedAction: "Manual price override approval aur reason audit karein."
          }));
        }
      }
      if ((type === "service" || type === "package" || type === "membership") && actualPaise <= 0 && expectedPricePaise > 0) {
        leaks.push(this.leakRow({
          type: "free_service_redemption",
          severity: expectedPricePaise >= 100000 ? "high" : "medium",
          branchId: invoiceBranchId,
          sourceId: invoiceId,
          estimatedImpactPaise: expectedPricePaise,
          message: `${name} zero-value service redemption detect hua.`,
          recommendedAction: "Membership/package entitlement, comp reason aur approval trail verify karein."
        }));
      }
    }
    const invoiceDiscountPaise = Math.max(toPaise(invoice.discount), toPaise(invoice.discountTotal));
    const invoiceRevenuePaise = toPaise(invoice.total);
    if (invoiceRevenuePaise > 0 && invoiceDiscountPaise > 0 && marginBps(invoiceDiscountPaise, invoiceRevenuePaise + invoiceDiscountPaise) >= 2500) {
      leaks.push(this.leakRow({
        type: "discount_abuse",
        severity: "high",
        branchId: invoiceBranchId,
        sourceId: invoiceId,
        estimatedImpactPaise: invoiceDiscountPaise,
        message: `${invoice.invoiceNumber || invoiceId} par high discount apply hua.`,
        recommendedAction: "Discount reason, approval aur staff-level pattern audit karein."
      }));
    }
    return leaks;
  }

  leakRow({ type, severity = "medium", branchId = "", sourceId = "", estimatedImpactPaise = 0, message = "", recommendedAction = "" }) {
    return {
      type,
      severity,
      branchId,
      sourceId,
      estimatedImpactPaise: Math.max(0, Math.round(Number(estimatedImpactPaise || 0))),
      message,
      recommendedAction
    };
  }

  profitDigitalTwin(query = {}, metrics = {}) {
    const assumptions = {
      servicePriceChangePct: clampPercent(numberParam(query, "scenarioPriceChangePct", 0), -50, 100),
      expectedRevenueChangePct: clampPercent(numberParam(query, "scenarioRevenueChangePct", 0), -75, 150),
      staffCommissionChangePct: clampPercent(numberParam(query, "scenarioCommissionChangePct", 0), -50, 100),
      productWastageReductionPct: clampPercent(numberParam(query, "scenarioWastageReductionPct", 0), 0, 80),
      operatingExpenseChangePct: clampPercent(numberParam(query, "scenarioExpenseChangePct", 0), -50, 100),
      rentChangePaise: toPaise(numberParam(query, "scenarioRentChangeRupees", 0))
    };
    const selectedScenario = this.simulateProfitScenario(metrics, assumptions);
    const scenarios = [
      this.simulateProfitScenario(metrics, { ...assumptions, servicePriceChangePct: assumptions.servicePriceChangePct + 5 }, "Price lift"),
      this.simulateProfitScenario(metrics, { ...assumptions, productWastageReductionPct: Math.min(80, assumptions.productWastageReductionPct + 10) }, "Wastage control"),
      this.simulateProfitScenario(metrics, { ...assumptions, operatingExpenseChangePct: assumptions.operatingExpenseChangePct - 5 }, "Expense control"),
      this.simulateProfitScenario(metrics, { ...assumptions, expectedRevenueChangePct: assumptions.expectedRevenueChangePct + 10 }, "Demand growth")
    ];
    const recommendedScenario = scenarios.sort((a, b) => b.profitDeltaPaise - a.profitDeltaPaise)[0] || selectedScenario;
    return {
      ...selectedScenario,
      scenarioAssumptions: assumptions,
      recommendedScenario: {
        name: recommendedScenario.name,
        simulatedNetProfitPaise: recommendedScenario.simulatedNetProfitPaise,
        profitDeltaPaise: recommendedScenario.profitDeltaPaise,
        scenarioAssumptions: recommendedScenario.scenarioAssumptions
      },
      scenarioOptions: scenarios.map((item) => ({
        name: item.name,
        simulatedNetProfitPaise: item.simulatedNetProfitPaise,
        profitDeltaPaise: item.profitDeltaPaise
      }))
    };
  }

  simulateProfitScenario(metrics = {}, assumptions = {}, name = "Selected scenario") {
    const priceMultiplier = 1 + Number(assumptions.servicePriceChangePct || 0) / 100;
    const demandMultiplier = 1 + Number(assumptions.expectedRevenueChangePct || 0) / 100;
    const commissionMultiplier = 1 + Number(assumptions.staffCommissionChangePct || 0) / 100;
    const wastageMultiplier = 1 - Number(assumptions.productWastageReductionPct || 0) / 100;
    const expenseMultiplier = 1 + Number(assumptions.operatingExpenseChangePct || 0) / 100;
    const simulatedRevenuePaise = Math.round(Number(metrics.revenuePaise || 0) * priceMultiplier * demandMultiplier);
    const simulatedProductCostPaise = Math.max(0, Math.round(Number(metrics.productCostPaise || 0) * demandMultiplier * wastageMultiplier));
    const simulatedStaffCostPaise = Math.max(0, Math.round(Number(metrics.staffCostPaise || 0) * demandMultiplier * commissionMultiplier));
    const simulatedOperatingExpensePaise = Math.max(0, Math.round(Number(metrics.operatingExpensePaise || 0) * expenseMultiplier + Number(assumptions.rentChangePaise || 0)));
    const simulatedGrossProfitPaise = simulatedRevenuePaise - simulatedProductCostPaise;
    const simulatedNetProfitPaise = simulatedGrossProfitPaise - simulatedStaffCostPaise - simulatedOperatingExpensePaise - Number(metrics.refundPaise || 0);
    return {
      name,
      baseRevenuePaise: Number(metrics.revenuePaise || 0),
      simulatedRevenuePaise,
      baseNetProfitPaise: Number(metrics.netProfitPaise || 0),
      simulatedNetProfitPaise,
      profitDeltaPaise: simulatedNetProfitPaise - Number(metrics.netProfitPaise || 0),
      simulatedProductCostPaise,
      simulatedStaffCostPaise,
      simulatedOperatingExpensePaise,
      grossMarginBps: marginBps(simulatedGrossProfitPaise, simulatedRevenuePaise),
      netMarginBps: marginBps(simulatedNetProfitPaise, simulatedRevenuePaise),
      scenarioAssumptions: assumptions
    };
  }

  enterpriseAnalytics(params, metrics, invoices = [], expenseRows = [], breakdown = {}) {
    const days = periodDays(params.from, params.to);
    const previousTo = addDaysText(params.from, -1);
    const previousFrom = addDaysText(previousTo, 1 - days);
    const previousMetrics = this.basicMetrics(periodWindow(previousFrom, previousTo, params));
    const previousYearMetrics = this.basicMetrics(periodWindow(addYearsText(params.from, -1), addYearsText(params.to, -1), params));
    const fixedCostPaise = Number(metrics.staffCostPaise || 0) + Number(metrics.operatingExpensePaise || 0);
    const avgDailyGrossProfitPaise = Math.round(Number(metrics.grossProfitPaise || 0) / Math.max(days, 1));
    const breakEvenDays = avgDailyGrossProfitPaise > 0 ? Math.ceil(fixedCostPaise / avgDailyGrossProfitPaise) : 0;
    const highExpense = this.highestExpense(this.classifiedExpenses(expenseRows).breakdown);
    return {
      periodGrain: days > 370 ? "yearly" : days > 93 ? "monthly" : days > 31 ? "weekly" : "daily",
      comparisons: {
        previousPeriod: this.metricComparison(metrics, previousMetrics, { from: previousFrom, to: previousTo }),
        previousYear: this.metricComparison(metrics, previousYearMetrics, { from: addYearsText(params.from, -1), to: addYearsText(params.to, -1) })
      },
      forecast: {
        nextMonthProfitPaise: this.forecastNextMonthProfit(metrics, params),
        basis: "Current period average daily net profit"
      },
      breakEven: {
        fixedCostPaise,
        avgDailyGrossProfitPaise,
        breakEvenDays,
        status: breakEvenDays && breakEvenDays <= days ? "covered" : breakEvenDays ? "at-risk" : "blocked"
      },
      profitTrend: this.profitTrendRows(params),
      expenseTrend: this.expenseTrendRows(expenseRows),
      revenueHeatmap: this.revenueHeatmap(invoices),
      alerts: this.analyticsAlerts(metrics, highExpense),
      suggestions: this.profitSuggestions(metrics, breakdown, highExpense)
    };
  }

  ceoKpis(params, metrics, breakdown = {}, expenseBreakdown = []) {
    const today = istDate();
    const todayMetrics = this.basicMetrics(periodWindow(today, today, params));
    const monthMetrics = this.basicMetrics(periodWindow(monthStart(today), today, params));
    const employeeCount = this.activeEmployeeCount(params);
    const chairCount = this.activeChairCount(params);
    const businessHours = this.businessHours(params);
    return {
      todayRevenuePaise: todayMetrics.revenuePaise,
      todayProfitPaise: todayMetrics.netProfitPaise,
      monthProfitPaise: monthMetrics.netProfitPaise,
      grossMarginBps: metrics.grossMarginBps,
      netMarginBps: metrics.netMarginBps,
      topService: this.topProfitItem(breakdown.serviceProfit, "serviceName", "netProfitPaise"),
      topStaff: this.topProfitItem(breakdown.staffProfit, "staffName", "netProfitPaise"),
      topBranch: this.topProfitItem(breakdown.branchProfit, "branchName", "netProfitPaise"),
      topCustomer: this.topProfitItem(breakdown.customerProfit, "clientName", "netProfitPaise"),
      highestExpense: this.highestExpense(expenseBreakdown),
      revenuePerEmployeePaise: employeeCount ? Math.round(metrics.revenuePaise / employeeCount) : 0,
      revenuePerChairPaise: chairCount ? Math.round(metrics.revenuePaise / chairCount) : 0,
      revenuePerHourPaise: businessHours ? Math.round(metrics.revenuePaise / businessHours) : metrics.revenuePaise,
      employeeCount,
      chairCount,
      businessHours
    };
  }

  basicMetrics(params) {
    const invoices = this.invoiceRows(params);
    const payments = this.paymentRows(params);
    const revenuePaise = invoices.reduce((sum, row) => sum + toPaise(row.total), 0);
    const refundPaise = payments.reduce((sum, row) => sum + Math.abs(Math.min(0, toPaise(row.amount))), 0);
    const expenseTotals = this.classifiedExpenses(this.operatingExpenseRows(params));
    const journalCogsPaise = this.journalCogsPaise(params);
    const consumeCogsPaise = this.productConsumeCogsPaise(params);
    const productCostPaise = journalCogsPaise > 0 ? journalCogsPaise : consumeCogsPaise + expenseTotals.productCostPaise;
    const payoutStaffPaise = this.staffPayoutPaise(params);
    const commissionPaise = this.salesCommissionPaise(params);
    const staffCostPaise = payoutStaffPaise > 0 ? payoutStaffPaise : expenseTotals.staffCostPaise + commissionPaise;
    const operatingExpensePaise = expenseTotals.operatingExpensePaise;
    const grossProfitPaise = revenuePaise - productCostPaise;
    const netProfitPaise = grossProfitPaise - staffCostPaise - operatingExpensePaise - refundPaise;
    return { revenuePaise, grossProfitPaise, netProfitPaise };
  }

  metricComparison(current = {}, previous = {}, period = {}) {
    return {
      period,
      revenuePaise: Number(previous.revenuePaise || 0),
      netProfitPaise: Number(previous.netProfitPaise || 0),
      revenueChangeBps: changeBps(current.revenuePaise, previous.revenuePaise),
      profitChangeBps: changeBps(current.netProfitPaise, previous.netProfitPaise),
      grossProfitChangeBps: changeBps(current.grossProfitPaise, previous.grossProfitPaise)
    };
  }

  forecastNextMonthProfit(metrics = {}, params = {}) {
    const days = periodDays(params.from, params.to);
    const to = dateValue(params.to);
    const nextMonth = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth() + 1, 1));
    const nextMonthDays = new Date(Date.UTC(nextMonth.getUTCFullYear(), nextMonth.getUTCMonth() + 1, 0)).getUTCDate();
    return Math.round((Number(metrics.netProfitPaise || 0) / Math.max(days, 1)) * nextMonthDays);
  }

  profitTrendRows(params) {
    const days = Math.min(periodDays(params.from, params.to), 31);
    const start = addDaysText(params.to, 1 - days);
    return Array.from({ length: days }, (_, index) => {
      const date = addDaysText(start, index);
      const metrics = this.basicMetrics(periodWindow(date, date, params));
      return {
        date,
        revenuePaise: metrics.revenuePaise,
        grossProfitPaise: metrics.grossProfitPaise,
        netProfitPaise: metrics.netProfitPaise
      };
    });
  }

  expenseTrendRows(expenseRows = []) {
    const rows = new Map();
    for (const expense of expenseRows) {
      const date = String(expense.paidAt || expense.createdAt || "").slice(0, 10) || "Unmapped";
      const row = rows.get(date) || { date, productCostPaise: 0, staffCostPaise: 0, operatingExpensePaise: 0, totalExpensePaise: 0 };
      const bucket = `${classifyExpense(expense.category)}Paise`;
      const amountPaise = toPaise(expense.amount);
      row[bucket] += amountPaise;
      row.totalExpensePaise += amountPaise;
      rows.set(date, row);
    }
    return [...rows.values()].sort((a, b) => a.date.localeCompare(b.date)).slice(-31);
  }

  revenueHeatmap(invoices = []) {
    const rows = new Map();
    const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    for (const invoice of invoices) {
      const raw = String(invoice.createdAt || "");
      const parsed = raw ? new Date(raw) : null;
      const weekday = parsed && !Number.isNaN(parsed.getTime()) ? weekdays[parsed.getDay()] : "Unmapped";
      const hour = parsed && !Number.isNaN(parsed.getTime()) ? parsed.getHours() : Number(raw.slice(11, 13) || 0);
      const key = `${weekday}|${hour}`;
      const row = rows.get(key) || { weekday, hour, invoiceCount: 0, revenuePaise: 0 };
      row.invoiceCount += 1;
      row.revenuePaise += toPaise(invoice.total);
      rows.set(key, row);
    }
    return [...rows.values()].sort((a, b) => b.revenuePaise - a.revenuePaise).slice(0, 12);
  }

  analyticsAlerts(metrics = {}, highExpense = {}) {
    const alerts = [];
    if (metrics.revenuePaise > 0 && metrics.netMarginBps < 1500) alerts.push({ type: "low-margin", severity: "high", message: "Net margin below 15%. Review pricing, COGS and staff cost." });
    if (metrics.revenuePaise > 0 && marginBps(metrics.operatingExpensePaise, metrics.revenuePaise) > 3500) alerts.push({ type: "high-expense", severity: "medium", message: "Operating expenses above 35% of revenue." });
    if (metrics.revenuePaise > 0 && marginBps(metrics.productCostPaise, metrics.revenuePaise) > 3000) alerts.push({ type: "high-cogs", severity: "medium", message: "Product cost above 30% of revenue. Check recipes and backbar usage." });
    if (highExpense.amountPaise > 0 && metrics.revenuePaise > 0 && marginBps(highExpense.amountPaise, metrics.revenuePaise) > 2000) alerts.push({ type: "expense-spike", severity: "medium", message: `${highExpense.label} is consuming more than 20% of revenue.` });
    return alerts;
  }

  profitSuggestions(metrics = {}, breakdown = {}, highExpense = {}) {
    const suggestions = [];
    const lowService = [...(breakdown.serviceProfit || [])].sort((a, b) => Number(a.netMarginBps || 0) - Number(b.netMarginBps || 0))[0];
    if (lowService && lowService.revenuePaise > 0 && lowService.netMarginBps < 2500) {
      suggestions.push(`${lowService.serviceName} margin low hai; service price, recipe quantity ya commission rule review karein.`);
    }
    if (metrics.revenuePaise > 0 && marginBps(metrics.staffCostPaise, metrics.revenuePaise) > 3000) suggestions.push("Staff cost 30% se upar hai; roster, incentive slab aur commission mix check karein.");
    if (metrics.revenuePaise > 0 && marginBps(metrics.productCostPaise, metrics.revenuePaise) > 2500) suggestions.push("COGS high dikh raha hai; product consume approval aur recipe wastage compare karein.");
    if (highExpense.amountPaise > 0) suggestions.push(`${highExpense.label} highest expense hai; vendor rate aur monthly cap review karein.`);
    if (!suggestions.length) suggestions.push("Profit signals stable hain; top services aur repeat customers par marketing focus rakhein.");
    return suggestions.slice(0, 5);
  }

  breakdown(query = {}, access = {}) {
    const params = periodParams(query, access);
    const invoices = this.invoiceRows(params);
    const expenseRows = this.operatingExpenseRows(params);
    const expenseTotals = this.classifiedExpenses(expenseRows);
    const consumeRows = this.productConsumeRows(params);
    const consumeCustomerRows = this.productConsumeCustomerRows(params);
    const serviceLookup = this.serviceLookup(params);
    const branchLookup = this.branchLookup(params);
    const clientLookup = this.clientLookup(params);
    const memberships = this.membershipRows(params);
    const membershipLedger = this.membershipLedgerRows(params);
    const membershipSnapshots = this.membershipSnapshotRows(params);
    const productCostByInvoice = this.productConsumeInvoiceCostMap(params);
    const salesCommission = this.salesCommissionRows(params);
    const payoutRows = this.staffPayoutRows(params);
    const journalCogsRows = this.journalCogsRows(params);
    const useJournalCogs = journalCogsRows.reduce((sum, row) => sum + Number(row.productCostPaise || 0), 0) > 0;

    return {
      period: { from: params.from, to: params.to, branchId: params.branchId },
      serviceProfit: this.serviceProfitRows({ invoices, consumeRows, serviceLookup }),
      staffProfit: this.staffProfitRows({ invoices, consumeRows }),
      branchProfit: this.branchProfitRows({ invoices, expenseRows, consumeRows, salesCommission, payoutRows, journalCogsRows, useJournalCogs, branchLookup }),
      categoryProfit: this.categoryProfitRows({ invoices, consumeRows, serviceLookup }),
      customerProfit: this.customerProfitRows({ invoices, consumeCustomerRows, clientLookup }),
      membershipProfit: this.entitlementProfitRows({ kind: "membership", invoices, memberships, membershipLedger, membershipSnapshots, productCostByInvoice }),
      packageProfit: this.entitlementProfitRows({ kind: "package", invoices, memberships, membershipLedger, membershipSnapshots, productCostByInvoice }),
      sourceHealth: {
        cogsSource: useJournalCogs ? "journalEntryLines" : consumeRows.length ? "productConsumeDrafts" : expenseTotals.productCostPaise > 0 ? "financeExpenses" : "missing",
        staffCostSource: payoutRows.length ? "financeStaffPayouts" : salesCommission.length ? "salesCommission" : expenseTotals.staffCostPaise > 0 ? "financeExpenses" : "missing"
      }
    };
  }

  invoiceRows(params) {
    if (!tableExists("invoices")) return [];
    return safeAll(`
      SELECT i.id, i.invoiceNumber, i.lineItems, i.total, i.subtotal, i.discount, i.discount_total AS discountTotal, i.status, i.createdAt,
        i.clientId,
        COALESCE(NULLIF(i.branchId, ''), s.branchId, '') AS branchId,
        COALESCE(s.staffId, '') AS staffId,
        COALESCE(s.commissionTotal, 0) AS commissionTotal
      FROM invoices i
      LEFT JOIN sales s ON s.id = i.saleId AND s.tenantId = i.tenantId
      WHERE i.tenantId = @tenantId
        AND i.createdAt BETWEEN @startAt AND @endAt
        AND lower(COALESCE(i.status, '')) NOT IN ('void', 'cancelled', 'canceled')
        AND (@branchId = '' OR COALESCE(NULLIF(i.branchId, ''), s.branchId, '') = @branchId)
      ORDER BY i.createdAt DESC
    `, params);
  }

  customerProfitRows({ invoices = [], consumeCustomerRows = [], clientLookup = new Map() }) {
    const rows = new Map();
    for (const invoice of invoices) {
      const clientId = invoice.clientId || "";
      const client = clientLookup.get(clientId) || {};
      const row = addAmount(rows, clientId || "walk-in", {
        clientId,
        clientName: client.name || clientId || "Walk-in",
        lifetimeRevenuePaise: toPaise(client.totalSpend || 0),
        revenuePaise: 0,
        productCostPaise: 0,
        staffCostPaise: 0,
        discountPaise: 0,
        visits: 0,
        avgBillPaise: 0
      }, "revenuePaise", toPaise(invoice.total));
      row.staffCostPaise += toPaise(invoice.commissionTotal);
      row.discountPaise += toPaise(invoice.discount);
      row.visits += 1;
    }
    for (const consume of consumeCustomerRows) {
      const clientId = consume.clientId || "";
      const row = addAmount(rows, clientId || "walk-in", {
        clientId,
        clientName: clientLookup.get(clientId)?.name || clientId || "Walk-in",
        lifetimeRevenuePaise: toPaise(clientLookup.get(clientId)?.totalSpend || 0),
        revenuePaise: 0,
        productCostPaise: 0,
        staffCostPaise: 0,
        discountPaise: 0,
        visits: 0,
        avgBillPaise: 0
      }, "productCostPaise", consume.productCostPaise);
    }
    return [...rows.values()]
      .map((row) => marginRow({ ...row, avgBillPaise: row.visits ? Math.round(row.revenuePaise / row.visits) : 0 }))
      .sort((a, b) => b.netProfitPaise - a.netProfitPaise)
      .slice(0, BREAKDOWN_LIMIT);
  }

  entitlementProfitRows({ kind = "membership", invoices = [], memberships = [], membershipLedger = [], membershipSnapshots = [], productCostByInvoice = new Map() }) {
    const rows = new Map();
    const ledgerRows = membershipLedger.filter((item) => this.ledgerKind(item, memberships) === kind);
    const hasLedgerSales = ledgerRows.some((item) => ["sold", "renew", "upgrade"].includes(item.action));
    const hasLedgerRedemptions = ledgerRows.some((item) => ["redeemed", "discount_applied"].includes(item.action));
    if (!hasLedgerSales) {
      for (const invoice of invoices) {
        for (const line of parseJsonArray(invoice.lineItems).filter((item) => entitlementType(item) === kind)) {
          const planId = line.id || line.planId || line.packageId || "";
          const planName = lineName(line);
          const key = planId || mapKey([planName]);
          const row = addAmount(rows, key, {
            planId,
            planName,
            soldValuePaise: 0,
            redeemedValuePaise: 0,
            productCostPaise: 0,
            remainingLiabilityPaise: 0,
            netProfitPaise: 0,
            soldCount: 0,
            redeemedCount: 0
          }, "soldValuePaise", lineAmountPaise(line));
          row.soldCount += 1;
        }
      }
    }
    for (const ledger of ledgerRows) {
      const key = ledger.planId || ledger.membershipId || mapKey([ledger.planName]);
      const row = addAmount(rows, key, {
        planId: ledger.planId,
        planName: ledger.planName || ledger.planId || ledger.membershipId || (kind === "package" ? "Package" : "Membership"),
        soldValuePaise: 0,
        redeemedValuePaise: 0,
        productCostPaise: 0,
        remainingLiabilityPaise: 0,
        netProfitPaise: 0,
        soldCount: 0,
        redeemedCount: 0
      }, ["sold", "renew", "upgrade"].includes(ledger.action) ? "soldValuePaise" : "redeemedValuePaise", this.ledgerAmountPaise(ledger));
      if (["sold", "renew", "upgrade"].includes(ledger.action)) row.soldCount += 1;
      if (["redeemed", "discount_applied"].includes(ledger.action)) row.redeemedCount += 1;
    }
    for (const snapshot of membershipSnapshots.filter((item) => this.snapshotKind(item, memberships) === kind)) {
      const key = snapshot.planId || snapshot.membershipId || mapKey([snapshot.planName]);
      const row = addAmount(rows, key, {
        planId: snapshot.planId,
        planName: snapshot.planName || snapshot.planId || snapshot.membershipId || (kind === "package" ? "Package" : "Membership"),
        soldValuePaise: 0,
        redeemedValuePaise: 0,
        productCostPaise: 0,
        remainingLiabilityPaise: 0,
        netProfitPaise: 0,
        soldCount: 0,
        redeemedCount: 0
      }, "productCostPaise", Number(productCostByInvoice.get(snapshot.invoiceId) || 0));
      if (!hasLedgerRedemptions) {
        row.redeemedValuePaise += toPaise(snapshot.invoiceTotal || snapshot.discountAmount || 0);
        row.redeemedCount += 1;
      }
    }
    for (const membership of memberships.filter((item) => membershipRecordType(item) === kind)) {
      const key = this.membershipPlanKey(membership);
      const planName = this.membershipPlanName(membership);
      const row = addAmount(rows, key, {
        planId: this.membershipPlanId(membership),
        planName,
        soldValuePaise: 0,
        redeemedValuePaise: 0,
        productCostPaise: 0,
        remainingLiabilityPaise: 0,
        netProfitPaise: 0,
        soldCount: 0,
        redeemedCount: 0
      }, "remainingLiabilityPaise", this.remainingLiabilityPaise(membership));
      if (!row.planName || row.planName === "Membership" || row.planName === "Package") row.planName = planName;
    }
    return [...rows.values()]
      .map((row) => ({
        ...row,
        netProfitPaise: Number(row.soldValuePaise || 0) - Number(row.redeemedValuePaise || 0) - Number(row.productCostPaise || 0) - Number(row.remainingLiabilityPaise || 0),
        marginBps: marginBps(Number(row.soldValuePaise || 0) - Number(row.redeemedValuePaise || 0) - Number(row.remainingLiabilityPaise || 0), Number(row.soldValuePaise || 0))
      }))
      .sort((a, b) => b.netProfitPaise - a.netProfitPaise)
      .slice(0, BREAKDOWN_LIMIT);
  }

  serviceProfitRows({ invoices = [], consumeRows = [], serviceLookup = new Map() }) {
    const rows = new Map();
    for (const invoice of invoices) {
      const lines = parseJsonArray(invoice.lineItems);
      const lineTotalPaise = lines.reduce((sum, line) => sum + lineAmountPaise(line), 0) || toPaise(invoice.total);
      for (const line of lines) {
        const serviceId = lineServiceId(line);
        const service = serviceId ? serviceLookup.get(serviceId) : null;
        const serviceName = service?.name || lineName(line);
        const amountPaise = lineAmountPaise(line);
        const staffCostPaise = lineTotalPaise ? Math.round(toPaise(invoice.commissionTotal) * amountPaise / lineTotalPaise) : 0;
        const key = serviceId || mapKey([serviceName]);
        const row = addAmount(rows, key, {
          serviceId,
          serviceName,
          category: lineCategory(line, serviceLookup),
          currentPricePaise: toPaise(service?.price || 0),
          revenuePaise: 0,
          productCostPaise: 0,
          staffCostPaise: 0,
          invoiceCount: 0
        }, "revenuePaise", amountPaise);
        row.staffCostPaise += staffCostPaise;
        row.invoiceCount += 1;
      }
    }
    for (const consume of consumeRows) {
      const key = consume.serviceId || mapKey([consume.serviceName]);
      const row = addAmount(rows, key, {
        serviceId: consume.serviceId,
        serviceName: consume.serviceName || "Unmapped service",
        category: serviceLookup.get(consume.serviceId)?.category || "Services",
        currentPricePaise: toPaise(serviceLookup.get(consume.serviceId)?.price || 0),
        revenuePaise: 0,
        productCostPaise: 0,
        staffCostPaise: 0,
        invoiceCount: 0
      }, "productCostPaise", consume.productCostPaise);
      if (!row.serviceName || row.serviceName === "Unmapped service") row.serviceName = consume.serviceName || row.serviceName;
    }
    return [...rows.values()].map(marginRow).sort((a, b) => b.netProfitPaise - a.netProfitPaise).slice(0, BREAKDOWN_LIMIT);
  }

  staffProfitRows({ invoices = [], consumeRows = [] }) {
    const rows = new Map();
    for (const invoice of invoices) {
      const lines = parseJsonArray(invoice.lineItems);
      const lineTotalPaise = lines.reduce((sum, line) => sum + lineAmountPaise(line), 0) || toPaise(invoice.total);
      for (const line of lines) {
        const amountPaise = lineAmountPaise(line);
        const staffCostPaise = lineTotalPaise ? Math.round(toPaise(invoice.commissionTotal) * amountPaise / lineTotalPaise) : 0;
        for (const split of this.staffSplits(line, invoice, amountPaise, staffCostPaise)) {
          const key = split.staffId || mapKey([split.staffName]) || "unassigned";
          const row = addAmount(rows, key, {
            staffId: split.staffId,
            staffName: split.staffName,
            revenuePaise: 0,
            productCostPaise: 0,
            staffCostPaise: 0,
            clientCount: 0,
            ticketCount: 0
          }, "revenuePaise", split.revenuePaise);
          row.staffCostPaise += split.staffCostPaise;
          row.ticketCount += 1;
        }
      }
    }
    for (const consume of consumeRows) {
      const key = consume.staffId || mapKey([consume.staffName]) || "unassigned";
      const row = addAmount(rows, key, {
        staffId: consume.staffId,
        staffName: consume.staffName || "Unassigned",
        revenuePaise: 0,
        productCostPaise: 0,
        staffCostPaise: 0,
        clientCount: 0,
        ticketCount: 0
      }, "productCostPaise", consume.productCostPaise);
      if (!row.staffName || row.staffName === "Unassigned") row.staffName = consume.staffName || row.staffName;
    }
    return [...rows.values()]
      .map((row) => marginRow({ ...row, avgTicketPaise: row.ticketCount ? Math.round(row.revenuePaise / row.ticketCount) : 0 }))
      .sort((a, b) => b.netProfitPaise - a.netProfitPaise)
      .slice(0, BREAKDOWN_LIMIT);
  }

  branchProfitRows({ invoices = [], expenseRows = [], consumeRows = [], salesCommission = [], payoutRows = [], journalCogsRows = [], useJournalCogs = false, branchLookup = new Map() }) {
    const rows = new Map();
    const hasConsumeCogs = consumeRows.some((row) => Number(row.productCostPaise || 0) > 0);
    const hasPayouts = payoutRows.some((row) => Number(row.staffCostPaise || 0) > 0);
    const hasSalesCommission = salesCommission.some((row) => Number(row.staffCostPaise || 0) > 0);
    const seed = (branchId) => ({
      branchId,
      branchName: branchLookup.get(branchId)?.name || branchId || "All branches",
      revenuePaise: 0,
      productCostPaise: 0,
      staffCostPaise: 0,
      operatingExpensePaise: 0,
      invoiceCount: 0
    });
    for (const invoice of invoices) {
      const branchId = invoice.branchId || "";
      const row = addAmount(rows, branchId, seed(branchId), "revenuePaise", toPaise(invoice.total));
      row.invoiceCount += 1;
    }
    for (const expense of expenseRows) {
      const branchId = expense.branchId || "";
      const bucket = classifyExpense(expense.category);
      if (bucket === "operatingExpense") {
        addAmount(rows, branchId, seed(branchId), "operatingExpensePaise", toPaise(expense.amount));
      } else if (bucket === "productCost" && !useJournalCogs && !hasConsumeCogs) {
        addAmount(rows, branchId, seed(branchId), "productCostPaise", toPaise(expense.amount));
      } else if (bucket === "staffCost" && !hasPayouts && !hasSalesCommission) {
        addAmount(rows, branchId, seed(branchId), "staffCostPaise", toPaise(expense.amount));
      }
    }
    if (useJournalCogs) {
      for (const cogs of journalCogsRows) addAmount(rows, cogs.branchId || "", seed(cogs.branchId || ""), "productCostPaise", cogs.productCostPaise);
    } else {
      for (const consume of consumeRows) addAmount(rows, consume.branchId || "", seed(consume.branchId || ""), "productCostPaise", consume.productCostPaise);
    }
    if (payoutRows.length) {
      for (const payout of payoutRows) addAmount(rows, payout.branchId || "", seed(payout.branchId || ""), "staffCostPaise", payout.staffCostPaise);
    } else {
      for (const commission of salesCommission) addAmount(rows, commission.branchId || "", seed(commission.branchId || ""), "staffCostPaise", commission.staffCostPaise);
    }
    return [...rows.values()].map(marginRow).sort((a, b) => b.netProfitPaise - a.netProfitPaise).slice(0, BREAKDOWN_LIMIT);
  }

  categoryProfitRows({ invoices = [], consumeRows = [], serviceLookup = new Map() }) {
    const rows = new Map();
    for (const invoice of invoices) {
      const lines = parseJsonArray(invoice.lineItems);
      const lineTotalPaise = lines.reduce((sum, line) => sum + lineAmountPaise(line), 0) || toPaise(invoice.total);
      for (const line of lines) {
        const category = lineCategory(line, serviceLookup);
        const amountPaise = lineAmountPaise(line);
        const staffCostPaise = lineTotalPaise ? Math.round(toPaise(invoice.commissionTotal) * amountPaise / lineTotalPaise) : 0;
        const row = addAmount(rows, category, {
          category,
          revenuePaise: 0,
          productCostPaise: 0,
          staffCostPaise: 0,
          itemCount: 0
        }, "revenuePaise", amountPaise);
        row.staffCostPaise += staffCostPaise;
        row.itemCount += 1;
      }
    }
    for (const consume of consumeRows) {
      const category = serviceLookup.get(consume.serviceId)?.category || "Services";
      addAmount(rows, category, {
        category,
        revenuePaise: 0,
        productCostPaise: 0,
        staffCostPaise: 0,
        itemCount: 0
      }, "productCostPaise", consume.productCostPaise);
    }
    return [...rows.values()].map(marginRow).sort((a, b) => b.netProfitPaise - a.netProfitPaise).slice(0, BREAKDOWN_LIMIT);
  }

  staffSplits(line = {}, invoice = {}, revenuePaise = 0, staffCostPaise = 0) {
    const rawSplits = Array.isArray(line.staffSplits) ? line.staffSplits.filter((split) => split?.staffId) : [];
    if (!rawSplits.length) {
      return [{
        staffId: line.staffId || invoice.staffId || "",
        staffName: line.staffName || line.assignedStaffName || line.staffId || invoice.staffId || "Unassigned",
        revenuePaise,
        staffCostPaise
      }];
    }
    const totalShare = rawSplits.reduce((sum, split) => sum + Number(split.share || Number(split.percent || 0) / 100 || 0), 0);
    let allocatedRevenue = 0;
    let allocatedStaff = 0;
    return rawSplits.map((split, index) => {
      const rawShare = Number(split.share || Number(split.percent || 0) / 100 || 0);
      const share = totalShare > 0 ? rawShare / totalShare : 1 / rawSplits.length;
      const splitRevenue = index === rawSplits.length - 1 ? revenuePaise - allocatedRevenue : Math.round(revenuePaise * share);
      const splitStaff = index === rawSplits.length - 1 ? staffCostPaise - allocatedStaff : Math.round(staffCostPaise * share);
      allocatedRevenue += splitRevenue;
      allocatedStaff += splitStaff;
      return {
        staffId: split.staffId || "",
        staffName: split.staffName || split.staffId || "Unassigned",
        revenuePaise: splitRevenue,
        staffCostPaise: splitStaff
      };
    });
  }

  paymentRows(params) {
    if (!tableExists("payments")) return [];
    return safeAll(`
      SELECT p.id, p.amount, p.mode, p.createdAt,
        COALESCE(NULLIF(i.branchId, ''), s.branchId, '') AS branchId
      FROM payments p
      JOIN invoices i ON i.id = p.invoiceId AND i.tenantId = p.tenantId
      LEFT JOIN sales s ON s.id = i.saleId AND s.tenantId = p.tenantId
      WHERE p.tenantId = @tenantId
        AND p.createdAt BETWEEN @startAt AND @endAt
        AND (@branchId = '' OR COALESCE(NULLIF(i.branchId, ''), s.branchId, '') = @branchId)
    `, params);
  }

  operatingExpenseRows(params) {
    if (!tableExists("finance_expenses")) return [];
    return safeAll(`
      SELECT id, branchId, category, vendor, amount, taxAmount, paymentMode, paidAt, createdAt, status
      FROM finance_expenses
      WHERE tenantId = @tenantId
        AND COALESCE(NULLIF(paidAt, ''), createdAt) BETWEEN @startAt AND @endAt
        AND lower(COALESCE(status, 'paid')) NOT IN ('void', 'cancelled', 'canceled')
        AND (@branchId = '' OR branchId = @branchId)
      ORDER BY COALESCE(NULLIF(paidAt, ''), createdAt) DESC
      LIMIT ${OPERATING_EXPENSE_LIMIT}
    `, params);
  }

  productConsumeVarianceDrafts(params) {
    if (!tableExists("product_consume_drafts")) return [];
    return safeAll(`
      SELECT id, branch_id AS branchId, service_id AS serviceId, service_name AS serviceName,
        staff_id AS staffId, staff_name AS staffName, service_quantity AS serviceQuantity,
        line_items_json AS lineItemsJson, expected_cost AS expectedCost, actual_cost AS actualCost,
        status, created_at AS createdAt, updated_at AS updatedAt
      FROM product_consume_drafts
      WHERE tenant_id = @tenantId
        AND created_at BETWEEN @startAt AND @endAt
        AND lower(status) IN ('confirmed', 'posted', 'consumed', 'approved')
        AND (@branchId = '' OR branch_id = @branchId)
      ORDER BY created_at DESC
      LIMIT ${OPERATING_EXPENSE_LIMIT}
    `, params);
  }

  serviceRecipeExpectedCostMap(params) {
    if (!tableExists("service_recipes")) return new Map();
    const rows = safeAll(`
      SELECT service_id AS serviceId, branch_id AS branchId, expected_cost AS expectedCost, updated_at AS updatedAt
      FROM service_recipes
      WHERE tenant_id = @tenantId
        AND COALESCE(active, 1) = 1
        AND lower(COALESCE(approval_status, 'approved')) = 'approved'
        AND (@branchId = '' OR branch_id = @branchId OR branch_id = '')
      ORDER BY updated_at DESC
      LIMIT 5000
    `, params);
    const map = new Map();
    for (const row of rows) {
      const serviceId = String(row.serviceId || "").trim();
      if (!serviceId) continue;
      const branchKey = `${row.branchId || ""}|${serviceId}`;
      const globalKey = `|${serviceId}`;
      if (!map.has(branchKey)) map.set(branchKey, toPaise(row.expectedCost));
      if (!row.branchId && !map.has(globalKey)) map.set(globalKey, toPaise(row.expectedCost));
    }
    return map;
  }

  expectedCostForDraft(draft = {}, recipeExpectedCost = new Map()) {
    const lineExpectedPaise = parseJsonArray(draft.lineItemsJson).reduce((sum, line) => sum + toPaise(line.expectedCost ?? line.expected_cost ?? 0), 0);
    const draftExpectedPaise = toPaise(draft.expectedCost);
    if (draftExpectedPaise > 0) return draftExpectedPaise;
    if (lineExpectedPaise > 0) return lineExpectedPaise;
    const serviceId = String(draft.serviceId || "").trim();
    const serviceQuantity = Math.max(1, Number(draft.serviceQuantity || 1));
    return Math.round((recipeExpectedCost.get(`${draft.branchId || ""}|${serviceId}`) || recipeExpectedCost.get(`|${serviceId}`) || 0) * serviceQuantity);
  }

  actualCostForDraft(draft = {}) {
    const draftActualPaise = toPaise(draft.actualCost);
    if (draftActualPaise > 0) return draftActualPaise;
    return parseJsonArray(draft.lineItemsJson).reduce((sum, line) => sum + toPaise(line.actualCost ?? line.actual_cost ?? 0), 0);
  }

  productConsumeRows(params) {
    if (!tableExists("product_consume_drafts")) return [];
    return safeAll(`
      SELECT branch_id AS branchId, service_id AS serviceId, service_name AS serviceName,
        staff_id AS staffId, staff_name AS staffName, COALESCE(SUM(actual_cost), 0) AS actualCost
      FROM product_consume_drafts
      WHERE tenant_id = @tenantId
        AND created_at BETWEEN @startAt AND @endAt
        AND lower(status) IN ('confirmed', 'posted', 'consumed', 'approved')
        AND (@branchId = '' OR branch_id = @branchId)
      GROUP BY branch_id, service_id, service_name, staff_id, staff_name
    `, params).map((row) => ({ ...row, productCostPaise: toPaise(row.actualCost) }));
  }

  productConsumeCustomerRows(params) {
    if (!tableExists("product_consume_drafts")) return [];
    return safeAll(`
      SELECT client_id AS clientId, COALESCE(SUM(actual_cost), 0) AS actualCost
      FROM product_consume_drafts
      WHERE tenant_id = @tenantId
        AND created_at BETWEEN @startAt AND @endAt
        AND lower(status) IN ('confirmed', 'posted', 'consumed', 'approved')
        AND (@branchId = '' OR branch_id = @branchId)
      GROUP BY client_id
    `, params).map((row) => ({ ...row, productCostPaise: toPaise(row.actualCost) }));
  }

  productConsumeInvoiceCostMap(params) {
    if (!tableExists("product_consume_drafts")) return new Map();
    const rows = safeAll(`
      SELECT invoice_id AS invoiceId, COALESCE(SUM(actual_cost), 0) AS actualCost
      FROM product_consume_drafts
      WHERE tenant_id = @tenantId
        AND created_at BETWEEN @startAt AND @endAt
        AND lower(status) IN ('confirmed', 'posted', 'consumed', 'approved')
        AND (@branchId = '' OR branch_id = @branchId)
      GROUP BY invoice_id
    `, params);
    return new Map(rows.map((row) => [row.invoiceId, toPaise(row.actualCost)]));
  }

  salesCommissionRows(params) {
    if (!tableExists("sales")) return [];
    return safeAll(`
      SELECT branchId, staffId, COALESCE(SUM(commissionTotal), 0) AS commissionTotal
      FROM sales
      WHERE tenantId = @tenantId
        AND createdAt BETWEEN @startAt AND @endAt
        AND lower(COALESCE(status, 'completed')) NOT IN ('void', 'cancelled', 'canceled')
        AND (@branchId = '' OR branchId = @branchId)
      GROUP BY branchId, staffId
    `, params).map((row) => ({ ...row, staffCostPaise: toPaise(row.commissionTotal) }));
  }

  staffPayoutRows(params) {
    if (!tableExists("finance_staff_payouts")) return [];
    return safeAll(`
      SELECT branchId, staffId, COALESCE(SUM(netAmount), 0) AS netAmount
      FROM finance_staff_payouts
      WHERE tenantId = @tenantId
        AND lower(COALESCE(status, 'pending')) NOT IN ('void', 'cancelled', 'canceled')
        AND @from <= periodEnd
        AND @to >= periodStart
        AND (@branchId = '' OR branchId = @branchId)
      GROUP BY branchId, staffId
    `, params).map((row) => ({ ...row, staffCostPaise: toPaise(row.netAmount) }));
  }

  journalCogsRows(params) {
    if (!tableExists("journalEntryLines") || !tableExists("journalEntries") || !tableExists("chartOfAccounts")) return [];
    return safeAll(`
      SELECT COALESCE(NULLIF(l.branchId, ''), e.branchId, '') AS branchId,
        COALESCE(SUM(l.debitPaise - l.creditPaise), 0) AS cogsPaise
      FROM journalEntryLines l
      JOIN journalEntries e ON e.id = l.journalEntryId AND e.tenantId = l.tenantId
      JOIN chartOfAccounts a ON a.id = l.accountId AND a.tenantId = l.tenantId
      WHERE l.tenantId = @tenantId
        AND e.status = 'posted'
        AND e.businessDate BETWEEN @from AND @to
        AND (a.accountSubType = 'cogs' OR a.code = '5000')
        AND (@branchId = '' OR l.branchId = @branchId OR e.branchId = @branchId)
      GROUP BY COALESCE(NULLIF(l.branchId, ''), e.branchId, '')
    `, params).map((row) => ({ ...row, productCostPaise: clampPaise(row.cogsPaise) }));
  }

  serviceLookup(params) {
    if (!tableExists("services")) return new Map();
    const rows = safeAll(`
      SELECT id, name, category, price, durationMinutes, branchId
      FROM services
      WHERE tenantId = @tenantId
        AND (@branchId = '' OR branchId = @branchId OR branchId = '')
      LIMIT 5000
    `, params);
    return new Map(rows.flatMap((row) => [
      [row.id, row],
      [mapKey([row.name]), row]
    ]));
  }

  branchLookup(params) {
    if (!tableExists("branches")) return new Map();
    const rows = safeAll(`
      SELECT id, name
      FROM branches
      WHERE tenantId = @tenantId
        AND (@branchId = '' OR id = @branchId)
    `, params);
    return new Map(rows.map((row) => [row.id, row]));
  }

  clientLookup(params) {
    if (!tableExists("clients")) return new Map();
    const rows = safeAll(`
      SELECT id, name, totalSpend, branchId
      FROM clients
      WHERE tenantId = @tenantId
        AND (@branchId = '' OR branchId = @branchId OR branchId = '')
      LIMIT 10000
    `, params);
    return new Map(rows.map((row) => [row.id, row]));
  }

  membershipRows(params) {
    if (!tableExists("memberships")) return [];
    return safeAll(`
      SELECT id, clientId, planName, price, planCredits, creditsRemaining, serviceCredits, redeemHistory, branchId, status, validityDate, createdAt
      FROM memberships
      WHERE tenantId = @tenantId
        AND (@branchId = '' OR branchId = @branchId OR branchId = '')
      LIMIT 10000
    `, params);
  }

  membershipLedgerRows(params) {
    if (!tableExists("client_membership_ledger")) return [];
    return safeAll(`
      SELECT l.membership_id AS membershipId, l.plan_id AS planId, l.action, l.amount, l.paid_amount AS paidAmount,
        l.discount_amount AS discountAmount, l.credits_before AS creditsBefore, l.credits_after AS creditsAfter,
        l.snapshot_json AS snapshotJson, l.created_at AS createdAt,
        COALESCE(p.name, '') AS planName
      FROM client_membership_ledger l
      LEFT JOIN membership_plans p ON p.id = l.plan_id AND p.tenant_id = l.tenant_id
      WHERE l.tenant_id = @tenantId
        AND l.created_at BETWEEN @startAt AND @endAt
        AND (@branchId = '' OR l.branch_id = @branchId)
      LIMIT 10000
    `, params);
  }

  membershipSnapshotRows(params) {
    if (!tableExists("membership_invoice_snapshots")) return [];
    return safeAll(`
      SELECT invoice_id AS invoiceId, membership_id AS membershipId, plan_id AS planId, plan_name AS planName,
        invoice_total AS invoiceTotal, discount_amount AS discountAmount, credits_used AS creditsUsed, created_at AS createdAt
      FROM membership_invoice_snapshots
      WHERE tenant_id = @tenantId
        AND created_at BETWEEN @startAt AND @endAt
        AND (@branchId = '' OR branch_id = @branchId)
      LIMIT 10000
    `, params);
  }

  ledgerKind(ledger = {}, memberships = []) {
    const membership = memberships.find((item) => item.id === ledger.membershipId);
    if (membership) return membershipRecordType(membership);
    const snapshot = this.safeJson(ledger.snapshotJson, {});
    return membershipRecordType(snapshot.membership || {});
  }

  snapshotKind(snapshot = {}, memberships = []) {
    const membership = memberships.find((item) => item.id === snapshot.membershipId);
    return membership ? membershipRecordType(membership) : "membership";
  }

  ledgerAmountPaise(ledger = {}) {
    if (["redeemed", "discount_applied"].includes(ledger.action)) return toPaise(ledger.discountAmount || ledger.amount || 0);
    return toPaise(ledger.paidAmount || ledger.amount || 0);
  }

  remainingLiabilityPaise(membership = {}) {
    const totalCredits = Math.max(Number(membership.planCredits || 0), Number(membership.creditsRemaining || 0), 0);
    if (!totalCredits) return 0;
    return Math.round(toPaise(membership.price) * Math.max(Number(membership.creditsRemaining || 0), 0) / totalCredits);
  }

  membershipPlanId(membership = {}) {
    const history = parseJsonArray(membership.redeemHistory);
    const credits = parseJsonArray(membership.serviceCredits);
    return history.find((item) => item?.planId || item?.packageId)?.planId || history.find((item) => item?.packageId)?.packageId || credits.find((item) => item?.planId || item?.packageId)?.planId || credits.find((item) => item?.packageId)?.packageId || "";
  }

  membershipPlanName(membership = {}) {
    const name = String(membership.planName || "").trim();
    if (name.toLowerCase().startsWith("package:")) return name.replace(/^package:\s*/i, "");
    return name || (membershipRecordType(membership) === "package" ? "Package" : "Membership");
  }

  membershipPlanKey(membership = {}) {
    return this.membershipPlanId(membership) || mapKey([this.membershipPlanName(membership)]);
  }

  safeJson(value, fallback = {}) {
    if (!value || typeof value !== "string") return fallback;
    try {
      return JSON.parse(value);
    } catch {
      return fallback;
    }
  }

  classifiedExpenses(rows = []) {
    const totals = {
      productCostPaise: 0,
      staffCostPaise: 0,
      operatingExpensePaise: 0,
      breakdown: []
    };
    const breakdown = new Map();
    for (const row of rows) {
      const amountPaise = toPaise(row.amount);
      const bucket = classifyExpense(row.category);
      totals[`${bucket}Paise`] += amountPaise;
      const key = row.category || "Uncategorized";
      const current = breakdown.get(key) || { category: key, amountPaise: 0, bucket };
      current.amountPaise += amountPaise;
      breakdown.set(key, current);
    }
    totals.breakdown = [...breakdown.values()].sort((a, b) => b.amountPaise - a.amountPaise).slice(0, 8);
    return totals;
  }

  journalCogsPaise(params) {
    if (!tableExists("journalEntryLines") || !tableExists("journalEntries") || !tableExists("chartOfAccounts")) return 0;
    const row = safeGet(`
      SELECT COALESCE(SUM(l.debitPaise - l.creditPaise), 0) AS cogsPaise
      FROM journalEntryLines l
      JOIN journalEntries e ON e.id = l.journalEntryId AND e.tenantId = l.tenantId
      JOIN chartOfAccounts a ON a.id = l.accountId AND a.tenantId = l.tenantId
      WHERE l.tenantId = @tenantId
        AND e.status = 'posted'
        AND e.businessDate BETWEEN @from AND @to
        AND (a.accountSubType = 'cogs' OR a.code = '5000')
        AND (@branchId = '' OR l.branchId = @branchId OR e.branchId = @branchId)
    `, params);
    return clampPaise(row.cogsPaise);
  }

  productConsumeCogsPaise(params) {
    if (!tableExists("product_consume_drafts")) return 0;
    const row = safeGet(`
      SELECT COALESCE(SUM(actual_cost), 0) AS actualCost
      FROM product_consume_drafts
      WHERE tenant_id = @tenantId
        AND created_at BETWEEN @startAt AND @endAt
        AND lower(status) IN ('confirmed', 'posted', 'consumed', 'approved')
        AND (@branchId = '' OR branch_id = @branchId)
    `, params);
    return toPaise(row.actualCost);
  }

  staffPayoutPaise(params) {
    if (!tableExists("finance_staff_payouts")) return 0;
    const row = safeGet(`
      SELECT COALESCE(SUM(netAmount), 0) AS netAmount
      FROM finance_staff_payouts
      WHERE tenantId = @tenantId
        AND lower(COALESCE(status, 'pending')) NOT IN ('void', 'cancelled', 'canceled')
        AND @from <= periodEnd
        AND @to >= periodStart
        AND (@branchId = '' OR branchId = @branchId)
    `, params);
    return toPaise(row.netAmount);
  }

  salesCommissionPaise(params) {
    if (!tableExists("sales")) return 0;
    const row = safeGet(`
      SELECT COALESCE(SUM(commissionTotal), 0) AS commissionTotal
      FROM sales
      WHERE tenantId = @tenantId
        AND createdAt BETWEEN @startAt AND @endAt
        AND lower(COALESCE(status, 'completed')) NOT IN ('void', 'cancelled', 'canceled')
        AND (@branchId = '' OR branchId = @branchId)
    `, params);
    return toPaise(row.commissionTotal);
  }

  topProfitItem(rows = [], labelField = "label", valueField = "netProfitPaise") {
    const row = [...(rows || [])].sort((a, b) => Number(b[valueField] || 0) - Number(a[valueField] || 0))[0] || {};
    return {
      label: row[labelField] || "No data",
      amountPaise: Number(row[valueField] || 0),
      revenuePaise: Number(row.revenuePaise || row.soldValuePaise || 0)
    };
  }

  highestExpense(expenseBreakdown = []) {
    const row = [...(expenseBreakdown || [])].sort((a, b) => Number(b.amountPaise || 0) - Number(a.amountPaise || 0))[0] || {};
    return {
      label: row.category || "No data",
      amountPaise: Number(row.amountPaise || 0)
    };
  }

  activeEmployeeCount(params) {
    if (!tableExists("staff")) return 0;
    const row = safeGet(`
      SELECT COUNT(*) AS count
      FROM staff
      WHERE tenantId = @tenantId
        AND lower(COALESCE(status, 'active')) NOT IN ('inactive', 'terminated', 'left')
        AND (@branchId = '' OR branchId = @branchId OR branchId = '')
    `, params);
    return Number(row.count || 0);
  }

  activeChairCount(params) {
    if (!tableExists("appointments")) return 0;
    const rows = safeAll(`
      SELECT DISTINCT COALESCE(NULLIF(chair, ''), NULLIF(room, ''), '') AS station
      FROM appointments
      WHERE tenantId = @tenantId
        AND startAt BETWEEN @startAt AND @endAt
        AND lower(COALESCE(status, '')) NOT IN ('cancelled', 'canceled', 'void')
        AND (@branchId = '' OR branchId = @branchId)
    `, params).filter((row) => String(row.station || "").trim());
    return rows.length || 0;
  }

  businessHours(params) {
    const from = new Date(`${params.from}T00:00:00`);
    const to = new Date(`${params.to}T00:00:00`);
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to < from) return BUSINESS_HOURS_PER_DAY;
    const days = Math.floor((to.getTime() - from.getTime()) / 86400000) + 1;
    return Math.max(1, days * BUSINESS_HOURS_PER_DAY);
  }

  diagnostics({ revenuePaise, productCostPaise, staffCostPaise, operatingExpensePaise, invoices }) {
    const warnings = [];
    if (revenuePaise > 0 && productCostPaise === 0) warnings.push("COGS source missing: approve product consume drafts or post inventory COGS journals.");
    if (revenuePaise > 0 && staffCostPaise === 0) warnings.push("Staff cost source missing: run staff payout or commission calculation for this period.");
    if (revenuePaise > 0 && operatingExpensePaise === 0) warnings.push("Operating expenses missing for this period.");
    if (!invoices.length) warnings.push("No invoices found for this period and branch.");
    return { warnings };
  }
}

export const profitIntelligenceService = new ProfitIntelligenceService();
