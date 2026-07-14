import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("staff mobile appointments stay compact and notifications update live", () => {
  const business = read("staff-app/src/app/features/staff/staff-business.page.ts");
  const styles = read("staff-app/src/app/features/staff/staff-app.styles.css");
  const layout = read("staff-app/src/app/features/staff/staff-layout.page.ts");
  const notifications = read("server/services/staff-enterprise.service.js");

  assert.match(business, /<details class="business-appointment-row">[\s\S]*?<summary>[\s\S]*?item\.startAt[\s\S]*?item\.serviceNames/);
  assert.match(styles, /\.business-appointment-row summary \{[^}]*min-height: 44px/);
  assert.match(layout, /\.notification-drawer \{ inset: 0; width: 100vw;[^}]*height: 100dvh/);
  assert.match(layout, /frame\.type\.startsWith\("staff-self\."\)[\s\S]*?loadShellData/);
  assert.match(notifications, /realtimeService\.broadcast\("staff-self\.notification"/);
});
