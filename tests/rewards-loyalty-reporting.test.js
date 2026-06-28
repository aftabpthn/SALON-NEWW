import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("rewards loyalty reporting exposes ledger roi expiry and abuse APIs", () => {
  const routes = read("server/routes/membership-enterprise.routes.js");
  for (const path of [
    "/membership-enterprise/rewards/ledger",
    "/membership-enterprise/rewards/roi",
    "/membership-enterprise/rewards/expiring",
    "/membership-enterprise/rewards/abuse-alerts",
    "/membership-enterprise/rewards/:clientId/send-expiry-reminder"
  ]) {
    assert.ok(routes.includes(path), `missing ${path}`);
  }
  assert.match(routes, /requirePermission\("read", \(\) => "memberships"\)/);
  assert.match(routes, /requirePermission\("write", \(\) => "memberships"\)/);
});

test("rewards loyalty service keeps reporting additive and reminder backed", () => {
  const service = read("server/services/membership-enterprise.service.js");
  for (const token of [
    "rewardsLedger",
    "rewardRoiReport",
    "expiringRewards",
    "rewardAbuseAlerts",
    "sendRewardExpiryReminder",
    "loyalty_transactions",
    "membership_whatsapp_reminders",
    "Cancelled bill reward not reversed",
    "Reward redemption without matching invoice",
    "Negative reward balance",
    "High redemption client",
    "Same client repeated reward adjustment"
  ]) {
    assert.match(service, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});

test("memberships page contains rewards ledger roi expiry and abuse tabs", () => {
  const memberships = read("src/app/pages/memberships.component.ts");
  for (const token of [
    "Rewards Ledger",
    "Reward ROI",
    "Expiring Rewards",
    "Abuse Alerts",
    "rewardFilters",
    "loadRewards",
    "sendRewardExpiryReminder",
    "exportRewardsLedgerCsv",
    "exportRewardsRoiPdf",
    "exportRewardAbusePdf",
    "membership-enterprise/rewards/ledger",
    "membership-enterprise/rewards/roi",
    "membership-enterprise/rewards/expiring",
    "membership-enterprise/rewards/abuse-alerts"
  ]) {
    assert.match(memberships, new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});
