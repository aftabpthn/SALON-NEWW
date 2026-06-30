import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("message template studio backend is mounted additively", () => {
  const app = read("server/app.js");
  const routes = read("server/routes/message-template-studio.routes.js");
  const service = read("server/services/message-template-studio.service.js");
  const schema = read("server/services/message-template-studio-schema.service.js");

  assert.match(app, /messageTemplateStudioRouter/);
  assert.match(app, /app\.use\("\/api\/v1", authenticateJwt\(\), messageTemplateStudioRouter\)/);
  assert.match(app, /app\.use\("\/api", messageTemplateStudioRouter\)/);

  for (const route of [
    "/message-templates/preferences",
    "/message-templates/preview",
    "/message-templates",
    "/message-templates/:id/test-send"
  ]) {
    assert.match(routes, new RegExp(route.replace(/[/:]/g, (match) => (match === "/" ? "\\/" : match))));
  }

  assert.match(schema, /CREATE TABLE IF NOT EXISTS notification_preferences/);
  assert.match(schema, /tenantId TEXT NOT NULL/);
  assert.match(schema, /branchId TEXT DEFAULT ''/);
  assert.match(schema, /audience TEXT NOT NULL/);
  assert.match(schema, /eventKey TEXT NOT NULL/);
  assert.match(schema, /channel TEXT NOT NULL/);

  assert.match(service, /engagement_templates/);
  assert.match(service, /message_logs/);
  assert.match(service, /template_test_send/);
  assert.match(service, /provider_unavailable/);
});

test("message template studio frontend route and quick links exist", () => {
  const routes = read("src/app/app.routes.ts");
  const shell = read("src/app/app.component.ts");
  const component = read("src/app/pages/message-template-studio.component.ts");

  assert.match(routes, /path: 'message-templates'/);
  assert.match(shell, /\/message-templates/);
  assert.match(shell, /Message Templates/);

  for (const label of [
    "Notification Settings",
    "SMS Templates",
    "WhatsApp Templates",
    "Email Templates",
    "Message History"
  ]) {
    assert.match(component, new RegExp(label));
  }

  assert.match(component, /routerLink="\/message-logs"/);
  assert.match(component, /500 characters/);
  assert.match(component, /provider template name/);
  assert.match(component, /Client Notifications/);
  assert.match(component, /Admin Notifications/);
  assert.match(component, /Staff Notifications/);
});
