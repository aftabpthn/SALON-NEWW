import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("Engagement WhatsApp manager view exposes the live action queue", () => {
  const service = read("server/services/engagement.service.js");
  const routes = read("server/routes/engagement.routes.js");

  assert.match(routes, /\/engagement\/manager-view/);
  assert.match(routes, /engagementService\.managerView/);
  assert.match(service, /engagementActionQueue/);
  assert.match(service, /pending_approval/);
  assert.match(service, /quiet_hours/);
  assert.match(service, /delivery_attention/);
  assert.match(service, /conversion_tracking/);
  assert.match(service, /campaign_approval/);
  assert.match(service, /provider_readiness/);
  assert.match(service, /listProviderReadiness\(\{ branchId, channel: "whatsapp" \}/);
  assert.match(service, /actionQueue/);
});

test("Engagement command center surfaces WhatsApp approvals, delivery and conversion actions", () => {
  const page = read("src/app/pages/engagement-command-center.component.ts");

  assert.match(page, /Engagement action queue/);
  assert.match(page, /WhatsApp operations/);
  assert.match(page, /engagementActionQueue/);
  assert.match(page, /loadManagerActions/);
  assert.match(page, /engagement\/manager-view/);
  assert.match(page, /actionQueueTypeLabel/);
  assert.match(page, /openActionQueueTarget/);
  assert.match(page, /openRecoveryDrawer/);
  assert.match(page, /openReportsDrawer/);
  assert.match(page, /openProviderDrawer/);
});

test("WhatsApp engagement flow keeps approval, quiet hours and no-fake-send controls wired", () => {
  const service = read("server/services/engagement.service.js");
  const routes = read("server/routes/engagement.routes.js");
  const page = read("src/app/pages/engagement-command-center.component.ts");
  const worker = read("server/workers/handlers/whatsapp-send.handler.js");

  assert.match(routes, /\/engagement\/messages\/draft/);
  assert.match(routes, /\/engagement\/messages\/:id\/approve/);
  assert.match(routes, /\/engagement\/messages\/:id\/send/);
  assert.match(routes, /\/engagement\/recovery-opportunities/);
  assert.match(routes, /\/engagement\/reports/);
  assert.match(routes, /\/engagement\/providers\/readiness/);
  assert.match(page, /respectQuietHours/);
  assert.match(service, /sendPolicyBlock/);
  assert.match(service, /pending_send_only/);
  assert.doesNotMatch(worker, /queued-placeholder/);
});
