import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const appComponent = readFileSync("src/app/app.component.ts", "utf8");
const accessRules = readFileSync("src/app/core/access-rules.ts", "utf8");

test("authenticated frontend routes default to admin-only when unmapped", () => {
  assert.match(
    accessRules,
    /ACCESS_PERMISSION_RULES\.find\(\(rule\) => rule\.pattern\.test\(cleanPath\)\)\?\.permission \|\| 'admin:system'/,
    "unmapped authenticated routes should require admin:system"
  );
  assert.match(appComponent, /routePermissionForPath\(path\)/, "app shell should enforce the shared access rules");
});

test("public route exceptions stay explicit and narrow", () => {
  assert.match(accessRules, /function isPublicRoutePath\(path: string\): boolean/);
  assert.match(accessRules, /path === '\/salon'/);
  assert.match(accessRules, /path === '\/salon-3d'/);
  assert.match(accessRules, /path\.startsWith\('\/book'\)/);
  assert.match(accessRules, /path\.startsWith\('\/memberships\/self-service\/'\)/);
  assert.match(accessRules, /path\.startsWith\('\/cash-drawer-approval\/'\)/);
  assert.doesNotMatch(accessRules, /path\.startsWith\('\/settings'\)/, "settings must not be public");
  assert.doesNotMatch(accessRules, /path\.startsWith\('\/permissions'\)/, "permissions must not be public");
});

test("sensitive frontend route groups have explicit permission mappings", () => {
  assert.match(accessRules, /security\|enterprise-security-shield[\s\S]*permission: \['read:security', 'write:security', 'admin:security'\]/);
  assert.match(accessRules, /business-details\|settings\|setting\|branches[\s\S]*permission: \['read:settings', 'write:settings', 'read:branches', 'write:branches'\]/);
  assert.match(accessRules, /finance\|profit-intelligence\|account-master\|balance-sheet\|transactions[\s\S]*permission: 'read:finance'/);
  assert.match(accessRules, /marketing\|growth-rank-bot[\s\S]*permission: 'read:marketing'/);
  assert.match(accessRules, /pos\|checkout[\s\S]*permission: 'use:pos'/);
});

test("restricted shell actions are hidden behind shared access checks", () => {
  assert.match(appComponent, /routerLink="\/pos" \*ngIf="canAccessPath\('\/pos'\)"/, "Fast POS header action must require POS access");
  assert.match(appComponent, /if \(!this\.canAccessPath\('\/branches'\)\)/, "branch admin calls must be skipped for non-admin roles");
  assert.match(appComponent, /if \(!this\.canAccessPath\('\/settings'\)\)/, "tenant admin calls must be skipped for non-admin roles");
});
