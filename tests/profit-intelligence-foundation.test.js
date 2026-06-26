import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const serverApp = readFileSync("server/app.js", "utf8");
const route = readFileSync("server/routes/profit-intelligence.routes.js", "utf8");
const service = readFileSync("server/services/profit-intelligence.service.js", "utf8");
const bookingService = readFileSync("server/services/profit-aware-booking.service.js", "utf8");
const actionService = readFileSync("server/services/profit-action-queue.service.js", "utf8");
const actionSchema = readFileSync("server/services/profit-action-queue-schema.service.js", "utf8");
const appRoutes = readFileSync("src/app/app.routes.ts", "utf8");
const appComponent = readFileSync("src/app/app.component.ts", "utf8");
const page = readFileSync("src/app/pages/profit-intelligence.component.ts", "utf8");

test("Profit Intelligence API is mounted for v1 and legacy finance clients", () => {
  assert.match(serverApp, /import \{ profitIntelligenceRouter \}/, "router should be imported");
  assert.match(serverApp, /app\.use\("\/api\/v1", authenticateJwt\(\), profitIntelligenceRouter\)/, "v1 API should be authenticated");
  assert.match(serverApp, /app\.use\("\/api", profitIntelligenceRouter\)/, "legacy API should stay compatible");
});

test("Profit Intelligence summary is finance-protected and paise-based", () => {
  assert.match(route, /\/profit-intelligence\/summary[\s\S]*requirePermission\("read",\s*\(\) => "finance"\)/, "summary should require read finance");
  assert.match(route, /\/profit-intelligence\/breakdown[\s\S]*requirePermission\("read",\s*\(\) => "finance"\)/, "breakdown should require read finance");
  assert.match(route, /\/profit-intelligence\/booking-recommendations[\s\S]*requirePermission\("read",\s*\(\) => "finance"\)/, "booking recommendations should require read finance");
  for (const field of [
    "revenuePaise",
    "productCostPaise",
    "staffCostPaise",
    "operatingExpensePaise",
    "grossProfitPaise",
    "netProfitPaise"
  ]) {
    assert.ok(service.includes(field), `${field} should be part of the P&L contract`);
  }
  assert.match(service, /journalEntryLines[\s\S]*chartOfAccounts/, "COGS should prefer posted journal lines when available");
  assert.match(service, /product_consume_drafts/, "COGS should fall back to product consume drafts");
  assert.match(service, /finance_staff_payouts/, "staff cost should use payout data");
  assert.match(service, /finance_expenses/, "operating expenses should use finance expenses");
});

test("Profit Intelligence exposes service, staff, branch and category profit breakdowns", () => {
  for (const field of [
    "serviceProfit",
    "staffProfit",
    "branchProfit",
    "categoryProfit",
    "grossMarginBps",
    "netMarginBps"
  ]) {
    assert.ok(service.includes(field), `${field} should be part of the Stage 2 contract`);
  }
  assert.match(service, /staffSplits/, "staff profit should respect line-level staff splits");
  assert.match(service, /serviceProfitRows/, "service profit should be calculated from invoice lines and product consume rows");
  assert.match(service, /branchProfitRows/, "branch P&L should aggregate revenue, COGS, staff cost and expenses");
  assert.match(service, /categoryProfitRows/, "category profit should aggregate category revenue and costs");
});

test("Profit Intelligence exposes customer, membership and package profitability", () => {
  for (const field of [
    "customerProfit",
    "membershipProfit",
    "packageProfit",
    "remainingLiabilityPaise",
    "lifetimeRevenuePaise",
    "discountPaise"
  ]) {
    assert.ok(service.includes(field), `${field} should be part of the Stage 3 contract`);
  }
  assert.match(service, /membership_invoice_snapshots/, "membership/package redemption should read invoice snapshots");
  assert.match(service, /client_membership_ledger/, "membership/package sales and redemptions should read membership ledger");
  assert.match(service, /productConsumeInvoiceCostMap/, "membership/package redeemed service costs should attach product consume COGS");
  assert.match(service, /membershipRecordType/, "package entitlements should be separated from memberships");
  assert.ok(page.includes("Customer profitability"), "customer profitability table should be visible");
  assert.ok(page.includes("Membership value"), "membership profitability table should be visible");
  assert.ok(page.includes("Package value"), "package profitability table should be visible");
  assert.ok(page.includes("Product Cost"), "membership/package tables should expose redeemed product cost");
});

test("Profit Intelligence exposes CEO dashboard KPIs", () => {
  for (const field of [
    "ceoKpis",
    "todayRevenuePaise",
    "todayProfitPaise",
    "monthProfitPaise",
    "topService",
    "topStaff",
    "topBranch",
    "topCustomer",
    "highestExpense",
    "revenuePerEmployeePaise",
    "revenuePerChairPaise",
    "revenuePerHourPaise"
  ]) {
    assert.ok(service.includes(field), `${field} should be part of the Stage 4 CEO KPI contract`);
  }
  assert.match(service, /activeEmployeeCount/, "CEO KPIs should calculate revenue per employee from staff");
  assert.match(service, /activeChairCount/, "CEO KPIs should calculate revenue per chair from appointments");
  assert.match(service, /BUSINESS_HOURS_PER_DAY/, "CEO KPIs should calculate revenue per business hour");
  for (const label of ["Today's Revenue", "This Month Profit", "Top Service", "Top Staff", "Top Branch", "Top Customer", "Highest Expense", "Revenue / Employee", "Revenue / Chair", "Revenue / Hour"]) {
    assert.ok(page.includes(label), `${label} KPI should be visible`);
  }
});

test("Profit Intelligence exposes enterprise analytics", () => {
  for (const field of [
    "enterpriseAnalytics",
    "comparisons",
    "previousPeriod",
    "previousYear",
    "forecast",
    "nextMonthProfitPaise",
    "breakEven",
    "profitTrend",
    "expenseTrend",
    "revenueHeatmap",
    "alerts",
    "suggestions"
  ]) {
    assert.ok(service.includes(field), `${field} should be part of the Stage 5 enterprise analytics contract`);
  }
  assert.match(service, /forecastNextMonthProfit/, "analytics should forecast next month profit");
  assert.match(service, /revenueHeatmap/, "analytics should expose revenue heatmap");
  assert.match(service, /profitSuggestions/, "analytics should expose AI-style profit suggestions");
  for (const label of ["Enterprise analytics", "Trend & forecast", "Profit trend", "Revenue heatmap", "AI profit signals", "Next month forecast", "Break-even"]) {
    assert.ok(page.includes(label), `${label} analytics panel should be visible`);
  }
});

test("Profit Intelligence exposes Profit Digital Twin simulation", () => {
  for (const field of [
    "profitDigitalTwin",
    "baseRevenuePaise",
    "simulatedRevenuePaise",
    "baseNetProfitPaise",
    "simulatedNetProfitPaise",
    "profitDeltaPaise",
    "scenarioAssumptions",
    "recommendedScenario",
    "simulateProfitScenario"
  ]) {
    assert.ok(service.includes(field), `${field} should be part of the Profit Digital Twin contract`);
  }
  for (const label of ["Profit Digital Twin", "What-if simulation", "Run Simulation", "Before vs after", "Profit impact", "Recommended scenario"]) {
    assert.ok(page.includes(label), `${label} should be visible for Profit Digital Twin`);
  }
  for (const control of ["scenarioPriceChangePct", "scenarioRevenueChangePct", "scenarioCommissionChangePct", "scenarioWastageReductionPct", "scenarioExpenseChangePct", "scenarioRentChangeRupees"]) {
    assert.ok(page.includes(control), `${control} should be wired to the scenario form`);
  }
});

test("Profit Intelligence exposes margin-aware booking recommendations", () => {
  assert.ok(route.includes("profitAwareBookingService"), "route should use the profit-aware booking wrapper");
  assert.ok(bookingService.includes("profitIntelligenceService.breakdown"), "booking wrapper should reuse Profit Intelligence breakdowns");
  assert.ok(bookingService.includes("appointments"), "booking wrapper should read appointment history");
  for (const field of [
    "booking-recommendations",
    "expectedRevenuePaise",
    "expectedCostPaise",
    "expectedProfitPaise",
    "marginBps",
    "peakScore",
    "suggestedPriceUpliftBps",
    "recommendation",
    "restrictionReason"
  ]) {
    assert.ok(route.includes(field) || bookingService.includes(field) || page.includes(field), `${field} should be part of margin-aware booking`);
  }
  for (const label of ["Margin-Aware Booking", "Profit ranked slots", "Best Slot", "Peak", "Prime slot candidate"]) {
    assert.ok(page.includes(label), `${label} should be visible for booking intelligence`);
  }
});

test("Profit Intelligence exposes AI Pricing Autopilot", () => {
  for (const field of [
    "pricingAutopilot",
    "pricingRecommendation",
    "currentPricePaise",
    "recommendedPricePaise",
    "expectedProfitLiftPaise",
    "currentMarginBps",
    "projectedMarginBps",
    "demandRisk",
    "reason"
  ]) {
    assert.ok(service.includes(field) || page.includes(field), `${field} should be part of AI Pricing Autopilot`);
  }
  assert.match(service, /services\.price/, "pricing autopilot should use service master price when available");
  assert.match(service, /targetMarginBps/, "pricing autopilot should support target margin");
  for (const label of ["AI Pricing Autopilot", "Service price recommendations", "Current Price", "Recommended", "Profit Lift", "Demand Risk"]) {
    assert.ok(page.includes(label), `${label} should be visible for AI Pricing Autopilot`);
  }
});

test("Profit Intelligence exposes Recipe Variance and Wastage Radar", () => {
  for (const field of [
    "recipeVariance",
    "productConsumeVarianceDrafts",
    "serviceRecipeExpectedCostMap",
    "expectedCostPaise",
    "actualCostPaise",
    "variancePaise",
    "varianceBps",
    "severity",
    "recommendation"
  ]) {
    assert.ok(service.includes(field) || page.includes(field), `${field} should be part of Recipe Variance`);
  }
  assert.match(service, /product_consume_drafts[\s\S]*expected_cost[\s\S]*actual_cost/, "recipe variance should compare product consume expected and actual cost");
  assert.match(service, /service_recipes/, "recipe variance should use approved service recipe fallback");
  assert.match(service, /line_items_json/, "recipe variance should detect product-level overuse from line items");
  for (const label of ["Wastage Radar", "Recipe variance & product overuse", "Expected", "Actual", "Variance", "No recipe variance signals yet."]) {
    assert.ok(page.includes(label), `${label} should be visible for Wastage Radar`);
  }
  for (const klass of ["severity-green", "severity-amber", "severity-red"]) {
    assert.ok(page.includes(klass), `${klass} status should be styled`);
  }
});

test("Profit Intelligence exposes Profit Leak Detection", () => {
  for (const field of [
    "profitLeaks",
    "invoiceProfitLeaks",
    "leakRow",
    "unbilled_add_on",
    "discount_abuse",
    "manual_price_override",
    "high_refunds",
    "low_collection",
    "free_service_redemption",
    "inventory_mismatch",
    "estimatedImpactPaise",
    "recommendedAction"
  ]) {
    assert.ok(service.includes(field) || page.includes(field), `${field} should be part of Profit Leak Detection`);
  }
  assert.match(service, /collectionsPaise[\s\S]*refundPaise/, "profit leaks should compare collection and refund signals");
  assert.match(service, /recipeVariance\.rows/, "profit leaks should include inventory/product consume mismatch signals");
  for (const label of ["Profit Leak Detection", "Daily leakage alert center", "Leak Type", "Impact", "No profit leaks detected."]) {
    assert.ok(page.includes(label), `${label} should be visible for Profit Leak Detection`);
  }
});

test("Profit Intelligence exposes Customer Profit Score and Membership Liability Risk", () => {
  for (const field of [
    "customerProfitScore",
    "customerScoreRow",
    "clientId",
    "clientName",
    "revenuePaise",
    "profitPaise",
    "discountPaise",
    "productCostPaise",
    "visits",
    "avgBillPaise",
    "profitScore",
    "tier",
    "membershipRisk",
    "membershipRiskRow",
    "soldValuePaise",
    "redeemedValuePaise",
    "remainingLiabilityPaise",
    "projectedCostPaise",
    "riskImpactPaise"
  ]) {
    assert.ok(service.includes(field) || page.includes(field), `${field} should be part of customer score or membership risk`);
  }
  for (const tier of ["VIP Profitable", "High Revenue Low Margin", "Discount Dependent", "Churn Risk High LTV", "Low Value"]) {
    assert.ok(service.includes(tier), `${tier} tier should be classified`);
  }
  for (const label of ["Customer Profit Score", "Profit tier intelligence", "Profit Tier", "Membership Liability Risk", "Future redemption exposure", "Future Cost", "Risk Impact"]) {
    assert.ok(page.includes(label), `${label} should be visible for customer score or membership risk`);
  }
});

test("Profit Intelligence exposes Autonomous Profit Action Queue", () => {
  assert.ok(serverApp.includes("ensureProfitActionQueueSchema"), "app should ensure profit action queue schema");
  assert.ok(actionSchema.includes("CREATE TABLE IF NOT EXISTS profit_action_queue"), "profit action queue table should be add-only");
  for (const field of [
    "id",
    "tenantId",
    "branchId",
    "type",
    "title",
    "message",
    "impactPaise",
    "priority",
    "status",
    "sourceType",
    "sourceId",
    "payloadJson",
    "approvedAt",
    "completedAt"
  ]) {
    assert.ok(actionSchema.includes(field) || actionService.includes(field) || page.includes(field), `${field} should be part of profit action queue`);
  }
  for (const endpoint of [
    "/profit-intelligence/actions",
    "/profit-intelligence/actions/:id/approve",
    "/profit-intelligence/actions/:id/complete",
    "/profit-intelligence/actions/:id/dismiss"
  ]) {
    assert.ok(route.includes(endpoint), `${endpoint} should be exposed`);
  }
  assert.match(route, /\/profit-intelligence\/actions[\s\S]*requirePermission\("read",\s*\(\) => "finance"\)/, "action list should require read finance");
  assert.match(route, /\/profit-intelligence\/actions[\s\S]*requirePermission\("write",\s*\(\) => "finance"\)/, "action mutations should require write finance");
  for (const source of ["low_margin_service", "high_wastage", "high_expense", "pricing_recommendation", "discount_abuse", "membership_liability_risk"]) {
    assert.ok(actionService.includes(source), `${source} should feed action queue`);
  }
  for (const label of ["Autonomous Profit Action Queue", "AI suggestions ready for execution", "Expected Impact", "Approve", "Complete", "Dismiss"]) {
    assert.ok(page.includes(label), `${label} should be visible for action queue`);
  }
});

test("Profit Intelligence exposes Profit Copilot and Auto Board Report", () => {
  assert.ok(route.includes("/profit-intelligence/copilot"), "Profit Copilot route should be exposed");
  assert.match(route, /\/profit-intelligence\/copilot[\s\S]*requirePermission\("read",\s*\(\) => "finance"\)/, "Profit Copilot should require read finance");
  for (const field of [
    "copilot",
    "copilotAnswer",
    "copilotReasons",
    "copilotMetrics",
    "copilotActions",
    "answer",
    "reasons",
    "metrics",
    "recommendedActions",
    "autoBoardReport",
    "topWins",
    "topRisks",
    "nextActions",
    "expectedRecoveryProfitPaise"
  ]) {
    assert.ok(service.includes(field) || route.includes(field) || page.includes(field), `${field} should be part of Profit Copilot or Auto Board Report`);
  }
  assert.ok(service.includes("rule-based"), "Profit Copilot should use rule-based engine without external AI dependency");
  for (const source of ["enterpriseAnalytics", "profitLeaks", "recipeVariance", "pricingAutopilot", "membershipRisk"]) {
    assert.ok(service.includes(source), `${source} should feed copilot and board report`);
  }
  for (const label of ["Profit Copilot", "Owner Q&amp;A", "Auto Board Report", "Monthly owner preview", "Top 5 wins", "Top 5 risks", "Next 5 actions", "Expected Recovery"]) {
    assert.ok(page.includes(label), `${label} should be visible for Profit Copilot or Board Report`);
  }
  assert.ok(page.includes("profit-intelligence/copilot"), "page should call Profit Copilot endpoint");
});

test("Profit Intelligence page is routed and visible in Finance navigation", () => {
  assert.match(appRoutes, /profit-intelligence[\s\S]*ProfitIntelligenceComponent/, "Angular route should load ProfitIntelligenceComponent");
  assert.ok(appComponent.includes("path: '/profit-intelligence'"), "Finance navigation should include the page");
  assert.ok(page.includes("profit-intelligence/summary"), "page should call the summary endpoint");
  assert.ok(page.includes("profit-intelligence/breakdown"), "page should call the breakdown endpoint");
  assert.ok(page.includes("profit-intelligence/booking-recommendations"), "page should call booking recommendations endpoint");
  assert.ok(page.includes("profit-intelligence/actions"), "page should call profit action queue endpoint");
  assert.ok(page.includes("grossMarginBps"), "page should expose gross margin");
  assert.ok(page.includes("netMarginBps"), "page should expose net margin");
  for (const label of ["Service wise margin", "Staff wise profitability", "Branch wise profit", "Category wise margin"]) {
    assert.ok(page.includes(label), `${label} table should be visible`);
  }
});
