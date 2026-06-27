import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const app = readFileSync("server/app.js", "utf8");
const route = readFileSync("server/routes/due-recovery-report.routes.js", "utf8");
const service = readFileSync("server/services/due-recovery-report.service.js", "utf8");
const page = readFileSync("src/app/pages/invoice-reports.component.ts", "utf8");

test("due recovery report API is mounted and permissioned", () => {
  assert.match(app, /dueRecoveryReportRouter/, "app should import and mount due recovery router");
  assert.match(app, /app\.use\("\/api\/v1",\s*dueRecoveryReportRouter\)/, "v1 API should expose due recovery report");
  assert.match(app, /app\.use\("\/api",\s*dueRecoveryReportRouter\)/, "legacy API should expose due recovery report");
  assert.match(route, /GET|\.get\("\/reports\/invoices\/due-recovery"/, "route should expose due recovery GET endpoint");
  assert.match(route, /requirePermission\("read",\s*\(\) => "reports"\)/, "report read should require reports permission");
  assert.match(route, /send-reminder/, "route should expose manual reminder endpoint");
  assert.match(route, /requirePermission\("write",\s*\(\) => "payments"\)/, "reminder should require payment write permission");
});

test("due recovery service computes dashboard rows and reuses payment reminders", () => {
  assert.match(service, /invoicePaymentCollectionService\.reminder/, "manual reminders should reuse existing payment reminder flow");
  assert.match(service, /agingBucket\(age\)/, "rows should expose 0-10, 11-20 and 21+ aging buckets");
  assert.match(service, /totalPendingDue/, "summary should include pending due totals");
  assert.match(service, /Client phone missing/, "service should block reminders when client phone is missing");
  assert.match(service, /Closed invoices cannot receive reminders/, "service should block closed invoices");
  assert.match(service, /payment_link_due_reminder/, "service should pass the due reminder message type");
});

test("invoice reports page exposes due recovery UI and reminder action", () => {
  assert.match(page, /id:\s*'due-recovery'/, "invoice reports should include Due Recovery tab");
  assert.match(page, /dueRecoverySummary/, "UI should render due recovery summary cards");
  assert.match(page, /Send payment reminder/, "UI should expose manual reminder action");
  assert.match(page, /Client phone missing/, "UI should explain disabled reminder when phone is missing");
  assert.match(page, /reports\/invoices\/due-recovery\/\$\{invoiceId\}\/send-reminder/, "UI should call the report reminder endpoint");
  assert.match(page, /routerLink\]="\['\/pos\/invoices'\]"/, "UI should keep open invoice/receive due actions on POS invoices");
});
