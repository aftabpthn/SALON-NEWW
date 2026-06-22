import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const app = readFileSync("server/app.js", "utf8");
const routes = readFileSync("src/app/app.routes.ts", "utf8");
const shell = readFileSync("src/app/app.component.ts", "utf8");
const service = readFileSync("src/app/pages/discount-rules/discount-rules.service.ts", "utf8");

test("Happy Hours discount routes have production /api/v1 parity", () => {
  for (const mount of [
    "/api/v1/discount-rules",
    "/api/v1/discount-audit",
    "/api/v1/discount-budget",
    "/api/v1/discount-webhooks",
    "/api/v1/discount-simulations",
    "/api/v1/discount-anomalies",
    "/api/v1/cross-branch-analytics",
    "/api/v1/demand-signals",
    "/api/v1/org-hierarchy",
    "/api/v1/policy-inheritance",
    "/api/v1/white-label-rules"
  ]) {
    assert.match(app, new RegExp(`app\\.use\\("${mount.replace(/\//g, "\\/")}"`), `${mount} should be mounted for production apiBaseUrl`);
  }
});

test("Happy Hours workspace is reachable from routes and shell navigation", () => {
  for (const route of [
    "discount-rules",
    "discount-rules/control-tower",
    "discount-rules/coupon-engine",
    "discount-rules/approvals",
    "pricing/level6-readiness",
    "pricing/market-intelligence"
  ]) {
    assert.match(routes, new RegExp(`path: '${route.replace(/\//g, "\\/")}'`), `${route} route should exist`);
  }

  assert.match(shell, /id: 'happy-hours'/);
  assert.match(shell, /primaryPath: '\/discount-rules'/);
  assert.match(shell, /path: '\/discount-rules\/control-tower'/);
  assert.match(shell, /path: '\/pricing\/level6-readiness'/);
});

test("Discount Rules service uses the shared API resource expected by prod and dev", () => {
  assert.match(service, /private readonly resource = 'discount-rules'/);
  assert.match(service, /this\.api\.list<DiscountRulesListResult>\(this\.resource/);
  assert.match(service, /this\.api\.post<DiscountRuleEvaluation>\(`\$\{this\.resource\}\/evaluate`/);
});
