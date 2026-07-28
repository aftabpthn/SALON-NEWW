import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('salary rules uses payroll APIs and permission-aware backend guards', () => {
  const models = read('../src/app/features/staff-os/domain/staff-os.models.ts');
  const advanced = read('../../backend-rust/src/routes/staff_advanced.rs');
  const enterprise = read('../../backend-rust/src/routes/staff_enterprise.rs');
  const middleware = read('../../backend-rust/src/middleware/tenant.rs');

  assert.match(models, /'salary-rules': \{[\s\S]+path: '\/staff\/payroll-adjustment-rules'/);
  assert.match(models, /'salary-rules': \{[\s\S]+path: '\/staff\/payroll-compliance\/rules'/);
  assert.match(models, /Add adjustment rule[\s\S]+section=adjustments&create=1/);
  assert.match(models, /Add statutory rule[\s\S]+section=statutory/);
  assert.match(models, /'salary-history': \{[\s\S]+path: '\/staff-payroll\/runs'/);
  assert.match(models, /'salary-history': \{[\s\S]+path: '\/staff\/salary-revisions'/);
  assert.match(models, /'fines-deductions': \{[\s\S]+title: 'Fine rules'[\s\S]+path: '\/staff\/payroll-adjustment-rules\?kind=fine'/);
  assert.match(models, /'fines-deductions': \{[\s\S]+title: 'Deduction rules'[\s\S]+path: '\/staff\/payroll-adjustment-rules\?kind=deduction'/);
  assert.match(models, /Add fine rule[\s\S]+kind=fine&create=1/);
  assert.match(models, /Add deduction rule[\s\S]+kind=deduction&create=1/);
  assert.match(models, /Apply staff fine[\s\S]+route: '\/staff\/attendance-summary'/);

  assert.match(middleware, /path_starts_with\(path, "\/staff\/payroll-compliance"\)[\s\S]+staff\.payroll\.read/);
  assert.match(advanced, /async fn list_adjustment_rules[\s\S]+ensure_payroll_read_access\(&claims\)\?/);
  assert.match(advanced, /async fn create_adjustment_rule[\s\S]+ensure_payroll_manage_access\(&claims\)\?/);
  assert.match(advanced, /async fn update_adjustment_rule[\s\S]+ensure_payroll_manage_access\(&claims\)\?/);
  assert.match(advanced, /fn ensure_payroll_read_access[\s\S]+"staff\.payroll\.read", "staff\.payroll\.manage"/);
  assert.match(advanced, /fn ensure_payroll_manage_access[\s\S]+"staff\.payroll\.manage"/);

  assert.match(enterprise, /async fn list_rules[\s\S]+payroll_read\(&c\)\?/);
  assert.match(enterprise, /async fn create_rule[\s\S]+payroll\(&c\)\?/);
  assert.match(enterprise, /async fn list_all_salary_revisions[\s\S]+payroll_read\(&c\)\?/);
  assert.match(enterprise, /async fn create_salary_revision[\s\S]+payroll\(&c\)\?/);
  assert.match(enterprise, /fn payroll_read\(c: &AuthClaims\)[\s\S]+"staff\.payroll\.read", "staff\.payroll\.manage"/);
  assert.match(enterprise, /fn payroll\(c: &AuthClaims\)[\s\S]+staff\.payroll\.manage/);
});
