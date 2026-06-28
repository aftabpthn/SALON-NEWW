import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const financeRoutes = readFileSync("server/routes/finance-engine.routes.js", "utf8");
const financeService = readFileSync("server/services/finance-engine.service.js", "utf8");
const financialSummary = readFileSync("src/app/pages/financial-summary-report.component.ts", "utf8");

test("wallet ledger report exposes finance wrapper APIs", () => {
  for (const route of [
    "/reports/financial-summary/wallet-ledger",
    "/reports/financial-summary/wallet-abuse-alerts",
    "/reports/financial-summary/wallet-ledger/export.csv",
    "/reports/financial-summary/wallet-audit/export.pdf"
  ]) {
    assert.match(financeRoutes, new RegExp(route.replace(/[/.]/g, "\\$&")), `missing route: ${route}`);
  }

  assert.match(financeRoutes, /walletLedgerReport\(req\.query, req\.access\)/);
  assert.match(financeRoutes, /walletLedgerCsv\(req\.query, req\.access\)/);
  assert.match(financeRoutes, /walletAuditPdf\(req\.query, req\.access\)/);
});

test("wallet ledger service builds summary, rows and abuse alerts", () => {
  for (const symbol of [
    "walletLedgerReport(query = {}, access)",
    "walletLedgerRows(filters, access)",
    "walletLedgerSummary(rows, alerts, filters, access)",
    "walletAbuseAlertsFromRows(rows = [], filters = {}, access = {})",
    "walletLiability(filters, access)",
    "wallet_transactions"
  ]) {
    assert.match(financeService, new RegExp(symbol.replace(/[(){}[\].?+*^$|\\]/g, "\\$&")), `missing service symbol: ${symbol}`);
  }

  for (const alert of [
    "Manual high credit",
    "Debit without invoice",
    "Negative wallet balance",
    "Repeated manual adjustment",
    "Old inactive wallet balance"
  ]) {
    assert.match(financeService, new RegExp(alert), `missing alert: ${alert}`);
  }
});

test("financial summary includes wallet ledger tab and exports", () => {
  for (const label of [
    "Wallet / Ewallet Ledger",
    "Total wallet liability",
    "Wallet transaction count",
    "Ledger CSV",
    "Owner PDF",
    "Audit PDF",
    "Abuse / audit alerts",
    "walletLedgerRows()",
    "exportWalletLedgerCsv()",
    "reports/financial-summary/wallet-ledger"
  ]) {
    assert.match(financialSummary, new RegExp(label.replace(/[()]/g, "\\$&")), `missing UI label: ${label}`);
  }
});
