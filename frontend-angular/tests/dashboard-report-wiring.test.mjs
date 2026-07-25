import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const dashboard = readFileSync('src/app/pages/dashboard/dashboard.component.ts', 'utf8');
const reports = readFileSync('../backend-rust/src/routes/reports.rs', 'utf8');

test('dashboard uses report responses as its live-data signal and full daily trend', () => {
  assert.doesNotMatch(dashboard, /this\.api\.health\(\)/);
  assert.match(dashboard, /this\.status = 'ok'/);
  assert.match(dashboard, /this\.revenueForecast\?\.history/);
  assert.doesNotMatch(dashboard, /groupSalesByDate/);
});

test('dashboard today values use the India business date and valid records', () => {
  assert.match(reports, /let today = current_business_date\(\)/);
  assert.match(reports, /start_at AT TIME ZONE 'Asia\/Kolkata'/);
  assert.match(reports, /pp\.created_at AT TIME ZONE 'Asia\/Kolkata'/);
  assert.match(reports, /active=TRUE AND merged_into_client_id IS NULL/);
  assert.match(reports, /status NOT IN \('draft','voided','cancelled','refunded'\)/);
});

test('sales totals are aggregated independently of the 200 invoice preview limit', () => {
  const handler = reports.slice(reports.indexOf('async fn report_sales('), reports.indexOf('async fn report_invoice_activity('));
  assert.match(handler, /SELECT COALESCE\(SUM\(total_paise\),0\)::BIGINT/);
  assert.match(handler, /let \(total_sales_paise, paid_sales_paise\) = totals/);
  assert.doesNotMatch(handler, /rows\.iter\(\)\.map\(\|row\| row\.total_paise\)/);
});
