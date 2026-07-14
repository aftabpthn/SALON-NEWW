import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const page = readFileSync("staff-app/src/app/features/staff/staff-appointments.page.ts", "utf8");
const styles = readFileSync("staff-app/src/app/features/staff/staff-app.styles.css", "utf8");

test("staff appointments expose accessible KPI and smart queue filters", () => {
  for (const view of ["today", "upcoming", "live", "completed", "cancelled"]) {
    assert.match(page, new RegExp("setView\\('" + view + "'\\)"), view + " should be clickable");
    assert.ok(page.includes('case "' + view + '"') || page.includes(view + ":"), view + " should have filtering or copy");
  }
  for (const status of ["booked", "confirmed", "checked-in", "arrived", "in-service", "started", "completed", "checked-out", "cancelled", "no-show"]) {
    assert.ok(page.includes('"' + status + '"'), status + " should stay mapped");
  }
  assert.match(page, /aria-pressed/);
  assert.match(page, /timeZone: "Asia\/Kolkata"/);
  assert.match(page, /routerLink="\/staff\/queue"/);
  assert.doesNotMatch(page, /setView\('past'\)/);
  assert.match(page, />Completed<\/button>/);
  assert.match(page, /!CANCELLED_STATUSES\.has\(status\).*COMPLETED_STATUSES\.has\(status\).*!date.*date < today/);
  assert.match(styles, /\.kpi-button:focus-visible/);
  assert.match(styles, /\.queue-tabs/);
});
