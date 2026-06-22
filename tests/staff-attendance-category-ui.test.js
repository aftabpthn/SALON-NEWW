import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const page = readFileSync("src/app/features/staff-os/pages/attendance-category.page.ts", "utf8");
const routes = readFileSync("src/app/features/staff-os/staff-os.routes.ts", "utf8");
const employeeMasters = readFileSync("src/app/features/staff-os/pages/employee-masters.page.ts", "utf8");
const salaryGenerate = readFileSync("src/app/features/staff-os/pages/salary-generate.page.ts", "utf8");
const facePunch = readFileSync("src/app/features/staff-os/pages/face-punch.page.ts", "utf8");

test("attendance category status dropdowns use clean user-facing labels", () => {
  const statusOptionUses = page.match(/\*ngFor="let status of statusOptions\(\)"/g) || [];
  const statusLabelUses = page.match(/{{ statusLabel\(status\) }}/g) || [];

  assert.equal(statusOptionUses.length, 3, "Mark, Mark later than and slab status dropdowns should use filtered status options");
  assert.equal(statusLabelUses.length, 3, "All attendance status dropdowns should render the cleaned status label");
  assert.match(page, /statusOptions\(\): StaffOsAttendanceMaster\[\]/, "statusOptions should keep archived and hidden statuses out of rule dropdowns");
  assert.match(page, /status\.status !== 'archived' && !status\.hide/, "hidden or archived attendance statuses should not be selectable");
  assert.match(page, /statusLabel\(status: StaffOsAttendanceMaster\): string/, "statusLabel helper should normalize status names");
  assert.match(page, /QA\\s\*\\d\+/, "QA test suffixes should be stripped from labels");
  assert.match(page, /\\d\{6,\}/, "long generated numeric codes should be stripped from labels");
});

test("staff os attendance and payroll routes are connected", () => {
  for (const path of ["attendance-category", "face-punch", "payroll-rules", "salary-generate", "salary-workspace"]) {
    assert.match(routes, new RegExp(`path: '${path}'`), `${path} should be available under Staff OS routes`);
  }

  assert.match(routes, /path: 'staff-salary-workspace'.*redirectTo: 'salary-workspace'/, "staff salary workspace alias should redirect to the live workspace");
  assert.match(routes, /path: 'generate-salary'.*redirectTo: 'salary-generate'/, "generate salary alias should redirect to salary generate");
});

test("employee masters exposes direct attendance and payroll actions", () => {
  for (const link of ["/staff-os/attendance-category", "/staff-os/face-punch", "/staff-os/payroll-rules", "/staff-os/salary-generate", "/staff-os/salary-workspace"]) {
    assert.match(employeeMasters, new RegExp(link.replace(/\//g, "\\/")), `${link} should be reachable from Employee Masters`);
  }
});

test("salary generate uses genuine preview data instead of synthetic salary fallbacks", () => {
  assert.match(salaryGenerate, /baseSalary'\], 0\)/, "base salary should default to zero when preview data is missing");
  assert.match(salaryGenerate, /serviceAmount'\], 0\)/, "service sales should default to zero when preview data is missing");
  assert.match(salaryGenerate, /advanceTotal'\], 0\)/, "advance total should default to zero when preview data is missing");
  assert.doesNotMatch(salaryGenerate, /22000 \+ index \* 1500/, "salary preview should not invent sample base salary");
  assert.doesNotMatch(salaryGenerate, /present \* 5200 \+ index \* 2600/, "salary preview should not invent sample service sales");
});

test("face punch has camera fallback without pretending failed API calls are saved", () => {
  assert.match(facePunch, /Manual punch fallback use kar sakte ho/, "camera unavailable state should show a clean manual fallback message");
  assert.match(facePunch, /captureMode: image \? 'face_camera' : 'manual_fallback'/, "punch payload should label camera vs manual fallback");
  assert.doesNotMatch(facePunch, /Backend punch API ne reject kiya[\s\S]*this\.addLocalRow/, "failed backend punch should not add a saved local row");
});
