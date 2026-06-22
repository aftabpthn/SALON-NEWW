import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const service = readFileSync("server/services/customer-360.service.js", "utf8");
const routes = readFileSync("server/routes/customer-360.routes.js", "utf8");
const page = readFileSync("src/app/pages/customer-360.component.ts", "utf8");

test("Customer 360 backend returns linked CRM profile surfaces", async () => {
  const module = await import("../server/services/customer-360.service.js");
  assert.ok(module.customer360Service, "customer360Service should import cleanly");
  assert.match(routes, /\/customer-360\/clients\/:id/, "customer profile endpoint should stay mounted");
  assert.match(service, /walletTransactions\(clientId,\s*access\)/, "profile should load wallet transactions");
  assert.match(service, /loyaltyTransactions\(clientId,\s*access\)/, "profile should load loyalty transactions");
  assert.match(service, /reviewLinkage\(clientId,\s*access\)/, "profile should load review linkage");
  assert.match(service, /visitHistory\(\{ sales,\s*invoices,\s*appointments \}\)/, "profile should expose visit history");
  assert.match(service, /membershipSummary\(memberships\)/, "profile should expose membership summary");
  assert.match(service, /aiInsightSummary\(\{ client,\s*riskScore,\s*nextBestAction,\s*wallet,\s*membershipSummary,\s*reviews \}\)/, "profile should expose AI insight summary");
});

test("Customer 360 UI shows wallet, membership, review and visit linkage", () => {
  for (const phrase of [
    "Wallet, membership and loyalty",
    "Visit history",
    "Review linkage",
    "AI next-best-action",
    "Notes timeline"
  ]) {
    assert.ok(page.includes(phrase), `${phrase} should be visible on Customer 360`);
  }
  assert.match(page, /profileData\.wallet\?\.balance/, "wallet balance should render");
  assert.match(page, /profileData\.membershipSummary\?\.status/, "membership status should render");
  assert.match(page, /profileData\.reviewLinkage\?\.reviews/, "linked reviews should render");
  assert.match(page, /profileData\.visitHistory/, "visit history should render");
  assert.match(page, /customer-360\/clients\/\$\{clientId\}\/timeline/, "notes should post to customer timeline endpoint");
  assert.match(page, /customer-360\/clients\/\$\{clientId\}\/snapshot/, "snapshots should post to snapshot endpoint");
});
