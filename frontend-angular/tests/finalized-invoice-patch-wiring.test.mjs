import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

const pos = read('../../backend-rust/src/routes/pos.rs');

const handler = pos.slice(
  pos.indexOf('async fn update_pos_sale('),
  pos.indexOf('fn has_pos_permission('),
);

test('the guard runs only for a finalized invoice', () => {
  // Before finalize this is ordinary editing and nothing has been reported or
  // paid yet, so the freeze must not reach a draft. The pure function has no
  // way to know which it is — the handler is where that is decided.
  assert.match(handler, /if existing\.finalized_at\.is_some\(\) \{/);
  const frozenBranch = handler.slice(handler.indexOf('if existing.finalized_at.is_some() {'));
  assert.match(frozenBranch, /refuse_frozen_finalized_fields\(&payload\)\?;/);
  // And the call appears nowhere else in the handler, so it cannot leak onto
  // the draft path through a second call site.
  assert.equal(handler.split('refuse_frozen_finalized_fields(').length - 1, 1);
});

test('the sale is read before it is written', () => {
  // The old code was a bare UPDATE: it never looked at finalized_at, so it
  // could not have refused anything even if it wanted to.
  const readIndex = handler.indexOf('load_pos_sale(');
  const writeIndex = handler.indexOf('UPDATE pos_sales');
  assert.ok(readIndex > 0 && writeIndex > readIndex, 'the row must be loaded first');
});

test('re-attribution costs a permission, a reason and an audit row', () => {
  // staff_id is what tip payout attributes against, so this moves money.
  assert.match(handler, /require_pos_permission\(&claims, "pos\.manage"\)\?;/);
  assert.match(handler, /require_lifecycle_reason\(&reason, "staff re-attribution"\)\?;/);
  assert.match(handler, /"pos\.sale\.staff_reattributed"/);
  // The audit has to carry both ends, or it cannot be reconciled against
  // payroll later.
  assert.match(handler, /"fromStaffId": existing\.staff_id/);
  assert.match(handler, /"toStaffId": sale\.staff_id/);
  assert.match(handler, /"reason": reason/);
});

test('a paid-out tip cannot be re-attributed by an UPDATE', () => {
  // Money that has already left has to be corrected where it left from.
  assert.match(handler, /FROM staff_tip_payout_items WHERE tenant_id=\$1/);
  assert.match(handler, /already been paid out/);
  assert.match(handler, /AppError::conflict\(/);
});

test('re-attribution is only triggered by an actual change', () => {
  // Re-sending the same staff_id must not demand a reason or write an audit
  // row; a no-op PATCH is not a correction.
  assert.match(handler, /let reattributing = !requested_staff_id\.is_empty\(\)\s*&& requested_staff_id != existing\.staff_id;/);
});

test('the refusals name the path that does the work', () => {
  // "Not allowed" with no alternative is how people end up editing the
  // database by hand.
  assert.match(pos, /use void, refund or credit note/);
  assert.match(pos, /correct it through payroll rather than re-attributing the sale/);
});
