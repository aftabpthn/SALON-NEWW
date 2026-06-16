import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const appComponent = readFileSync("src/app/app.component.ts", "utf8");
const appRoutes = readFileSync("src/app/app.routes.ts", "utf8");
const serverApp = readFileSync("server/app.js", "utf8");
const financeRoutes = readFileSync("server/routes/finance-engine.routes.js", "utf8");
const accountRoutes = readFileSync("server/routes/account-master.routes.js", "utf8");
const transactionsRoutes = readFileSync("server/routes/transactions.routes.js", "utf8");
const balanceRoutes = readFileSync("server/routes/balance-sheet.routes.js", "utf8");
const hardeningRoutes = readFileSync("server/routes/balance-sheet-hardening.routes.js", "utf8");
const financeService = readFileSync("server/services/finance-engine.service.js", "utf8");
const transactionsService = readFileSync("server/services/transactions.service.js", "utf8");
const balanceSheetService = readFileSync("server/services/balance-sheet.service.js", "utf8");
const hardeningService = readFileSync("server/services/balance-sheet-hardening.service.js", "utf8");
const financePage = readFileSync("src/app/pages/finance-engine.component.ts", "utf8");
const accountLedgerPage = readFileSync("src/app/pages/account-ledger.component.ts", "utf8");
const outgoingFundsPage = readFileSync("src/app/pages/outgoing-funds-entry.component.ts", "utf8");
const outgoingFundsReportPage = readFileSync("src/app/pages/outgoing-funds-report.component.ts", "utf8");
const accountMasterPage = readFileSync("src/app/pages/account-master.component.ts", "utf8");
const balanceSheetPage = readFileSync("src/app/pages/balance-sheet.component.ts", "utf8");

const financeSidebarPaths = [
  "/finance",
  "/account-master",
  "/reports/account-ledger",
  "/balance-sheet",
  "/transactions/outgoing-funds",
  "/compliance"
];

test("Finance sidebar exposes the sale-ready finance control surface", () => {
  assert.match(appComponent, /id:\s*'finance'/, "Finance sidebar group should exist");
  assert.match(appComponent, /primaryPath:\s*'\/finance'/, "Finance group should open the finance engine");
  for (const path of financeSidebarPaths) {
    assert.ok(appComponent.includes(`path: '${path}'`), `${path} should be in Finance sidebar`);
  }
});

test("Finance Angular routes stay wired to core finance pages", () => {
  for (const path of ["finance", "account-master", "reports/account-ledger", "balance-sheet", "transactions/outgoing-funds", "transactions/outgoing-funds-report", "compliance"]) {
    assert.ok(appRoutes.includes(`path: '${path}'`), `${path} route should exist`);
  }
  assert.match(appRoutes, /finance[\s\S]*FinanceEngineComponent/, "Finance route should load FinanceEngineComponent");
  assert.match(appRoutes, /reports\/account-ledger[\s\S]*AccountLedgerComponent/, "Account Ledger route should load AccountLedgerComponent");
  assert.match(appRoutes, /balance-sheet[\s\S]*BalanceSheetComponent/, "Balance Sheet route should load BalanceSheetComponent");
  assert.match(appRoutes, /transactions\/outgoing-funds[\s\S]*OutgoingFundsEntryComponent/, "Outgoing Funds route should load OutgoingFundsEntryComponent");
  assert.match(appRoutes, /transactions\/outgoing-funds-report[\s\S]*OutgoingFundsReportComponent/, "Outgoing Funds report route should load OutgoingFundsReportComponent");
});

test("Finance backend routers are mounted for v1 and legacy clients", () => {
  for (const routerName of [
    "accountMasterRouter",
    "transactionsRouter",
    "balanceSheetRouter",
    "balanceSheetHardeningRouter",
    "balanceSheetAdvancedRouter",
    "financeEngineRouter"
  ]) {
    assert.match(serverApp, new RegExp(`import \\{ ${routerName} \\}`), `${routerName} should be imported`);
    assert.match(serverApp, new RegExp(`app\\.use\\("/api(?:/v1)?",(?:\\s*authenticateJwt\\(\\),)?\\s*${routerName}\\)`), `${routerName} should be mounted`);
  }
  assert.match(serverApp, /app\.use\("\/api\/v1", authenticateJwt\(\), financeEngineRouter\)/, "Finance Engine v1 API should be authenticated");
});

test("Finance APIs require finance permissions and audit sensitive mutations", () => {
  assert.match(financeRoutes, /\/finance\/summary[\s\S]*requirePermission\("read",\s*\(\) => "finance"\)/, "finance summary should require read finance");
  for (const action of [
    "cash_drawer.opened",
    "cash_drawer.closed",
    "expense.created",
    "daily_closing.created",
    "payment.partial",
    "refund.processed",
    "credit_note.issued",
    "staff_payout.calculated"
  ]) {
    assert.ok(financeRoutes.includes(action), `${action} should be audited`);
  }
  assert.match(financeRoutes, /\/finance\/refunds[\s\S]*requirePermission\("write",\s*\(\) => "finance"\)/, "refunds should require write finance");
  assert.match(accountRoutes, /\/account-master\/ledger[\s\S]*requirePermission\("read",\s*\(\) => "finance"\)/, "ledger should require read finance");
  assert.match(accountRoutes, /validateBody\(\{ required: \["accountName"\] \}\)/, "account creation should validate accountName");
  assert.match(transactionsRoutes, /\/transactions\/outgoing-funds[\s\S]*requirePermission\("write",\s*\(\) => "finance"\)[\s\S]*validateBody\(\{ required: \["entryDate", "amount"\] \}\)/, "outgoing funds should require finance write and amount/date");
  assert.match(balanceRoutes, /\/balance-sheet\/journals[\s\S]*requirePermission\("write",\s*\(\) => "finance"\)/, "manual journals should require write finance");
  assert.match(hardeningRoutes, /\/balance-sheet\/outbox\/process[\s\S]*requirePermission\("write",\s*\(\) => "finance"\)/, "GL outbox processing should require write finance");
});

test("Finance pages call their backend APIs with branch-aware surfaces", () => {
  for (const endpoint of [
    "finance/summary",
    "finance/cash-drawers/open",
    "finance/cash-drawers/close",
    "finance/expenses",
    "finance/daily-closing",
    "finance/refunds",
    "finance/staff-payouts"
  ]) {
    assert.ok(financePage.includes(endpoint), `${endpoint} should be used by Finance page`);
  }
  assert.match(accountLedgerPage, /account-master\/ledger[\s\S]*branchId:\s*this\.api\.selectedBranchId\(\)/, "Account Ledger should load branch-scoped ledger rows");
  assert.match(outgoingFundsPage, /transactions\/outgoing-funds[\s\S]*branchId:\s*this\.api\.selectedBranchId\(\)/, "Outgoing Funds should load branch-scoped entries");
  assert.match(outgoingFundsPage, /routerLink="\/transactions\/outgoing-funds-report"/, "Outgoing Funds entry should link to saved report");
  assert.match(outgoingFundsReportPage, /transactions\/outgoing-funds[\s\S]*branchId:\s*this\.api\.selectedBranchId\(\)/, "Outgoing Funds report should load branch-scoped saved entries");
  assert.match(accountMasterPage, /account-master\/accounts[\s\S]*branchId:\s*this\.api\.selectedBranchId\(\)/, "Account Master should use branch-scoped account lists");
  assert.match(balanceSheetPage, /balance-sheet\/live[\s\S]*balance-sheet\/trial-balance[\s\S]*balance-sheet\/hardening/, "Balance Sheet should load live, trial, and hardening data");
});

test("Finance services keep tenant, branch and integer-paise accounting invariants", () => {
  assert.match(financeService, /tenantService\.assertBranchAccess\(access,\s*branchId\)/, "Finance mutations should assert branch access");
  assert.match(financeService, /money\(/, "Finance service should normalize money values");
  assert.match(transactionsService, /balanceSheetHardeningService\.enqueue\(\{[\s\S]*eventType: "expense\.recorded"/, "Outgoing funds should enqueue GL expense events");
  assert.match(transactionsService, /eventKey: `outgoing-fund:\$\{access\.tenantId\}:\$\{entry\.id\}`/, "Outgoing funds should use idempotent event keys");
  assert.match(balanceSheetService, /Journal entry must balance: total debit must equal total credit/, "Journal service should enforce debit equals credit");
  assert.match(balanceSheetService, /INSERT INTO journalEntryLines/, "Journal lines should remain the posting source");
  assert.match(balanceSheetService, /INSERT OR REPLACE INTO balanceSheetSnapshots/, "Balance Sheet snapshots should stay archival");
  assert.match(balanceSheetService, /SELECT \* FROM periodLocks WHERE tenantId = \? AND branchId = \? AND period = \?/, "period locks should be tenant and branch scoped");
  assert.match(balanceSheetService, /productionReady/, "Balance Sheet should expose production readiness");
  assert.match(hardeningService, /INSERT OR IGNORE INTO glOutbox/, "GL outbox should be idempotent");
  assert.match(hardeningService, /idempotencyKey: `outbox:\$\{row\.eventKey\}`/, "Outbox journal posting should keep idempotency keys");
});
