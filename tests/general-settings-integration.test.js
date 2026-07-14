import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(path, "utf8");

test("general settings are tenant and branch scoped with realtime propagation", () => {
  const route = read("server/routes/general-settings.routes.js");
  const service = read("server/services/general-settings.service.js");
  const invoiceNotifications = read("server/services/invoice-notification.service.js");

  assert.match(route, /requirePermission\("read",\s*\(\) => "settings"\)/);
  assert.match(route, /requirePermission\("write",\s*\(\) => "settings"\)/);
  assert.match(service, /readSavedSettings\(tenantId, ""\)/, "tenant policy should be the fallback");
  assert.match(service, /readSavedSettings\(tenantId, branchId\)/, "branch policy should be read independently");
  assert.match(service, /mergeSettings\(tenantSettings, branchSettings\)/, "branch policy should inherit tenant policy");
  assert.match(service, /tenantService\.assertBranchAccess/, "branch access must remain enforced");
  assert.match(service, /settings\.general\.updated/, "saving should publish a realtime update");
  assert.match(service, /ownerNotificationsEnabled/, "owner notification policy should be reusable");
  assert.match(invoiceNotifications, /generalSettingsService\.ownerNotificationsEnabled/, "owner invoice delivery should honor general policy");
  assert.match(service, /numberValue\(dateTime\.businessDayStartHour[^\n]+0, 23\)/, "business hour must be clamped");
  assert.doesNotMatch(service, /CREATE TABLE|ALTER TABLE/, "integration must use the existing settings table");
});

test("general settings drive active frontend consumers", () => {
  const store = read("src/app/core/general-settings.service.ts");
  const shell = read("src/app/app.component.ts");
  const switcher = read("src/app/shared/ui/workspace-switcher/workspace-switcher.component.ts");
  const command = read("src/app/shared/ui/command-palette/command-palette.component.ts");
  const notifications = read("src/app/shared/ui/header-actions/header-actions.component.ts");
  const api = read("src/app/core/api.service.ts");
  const i18n = read("src/app/core/i18n.service.ts");
  const dateRanges = read("src/app/shared/date-range-presets.ts");
  const realtime = read("src/app/core/websocket.service.ts");
  const notificationCenter = read("src/app/core/notification-center.service.ts");

  for (const setting of ["fastPosEnabled", "compactMode", "showModuleBadges", "commandSearchEnabled", "allowBranchSwitch", "ownerNotificationsEnabled", "staffHintsEnabled"]) {
    assert.match(store, new RegExp(setting), `missing reactive policy ${setting}`);
  }
  assert.match(shell, /applyDefaultLandingPage\(\)/, "shell should apply root landing policy");
  assert.match(shell, /generalSettings\.fastPosEnabled\(\)/, "shell should apply Fast POS policy");
  assert.match(shell, /generalSettings\.showModuleBadges\(\)/, "shell should apply badge policy");
  assert.match(switcher, /generalSettings\.allowBranchSwitch\(\)/, "branch switch should honor policy");
  assert.match(command, /generalSettings\.commandSearchEnabled\(\)/, "command search should honor policy");
  assert.match(notifications, /generalSettings\.ownerNotificationsEnabled\(\)/, "notifications should honor policy");
  assert.match(api, /refreshReportsOnOpen \? \{ \.\.\.params, noCache: true \}/, "reports should honor refresh policy");
  assert.match(api, /isReportResource/, "irregular report endpoints should use the same refresh policy");
  assert.match(store, /settings\.general\.updated/, "frontend should consume realtime policy updates");
  assert.match(i18n, /configureDateTime/, "date and time presentation should be centrally configurable");
  assert.match(i18n, /businessDateKey/, "business-day boundaries should be centrally available");
  assert.match(dateRanges, /configureBusinessCalendar/, "date presets should honor business calendar policy");
  assert.match(shell, /branchSelectionRequired/, "mandatory branch policy should block the shell");
  assert.match(realtime, /scheduleReconnect/, "realtime should reconnect automatically");
  assert.match(realtime, /currentConnectionKey/, "realtime should reconnect when scope changes");
  assert.match(notificationCenter, /notification\.instant|notifications/, "header notifications should use live data");
});
