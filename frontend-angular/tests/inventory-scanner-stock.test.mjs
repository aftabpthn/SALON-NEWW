import assert from 'node:assert/strict';
import test from 'node:test';
import { adjustedStock } from '../src/app/pages/inventory/scanner/scanner-stock.ts';

test('scanner stock workflows preserve valid stock', () => {
  assert.equal(adjustedStock(10, 'receive', 3), 13);
  assert.equal(adjustedStock(10, 'count', 0), 0);
  assert.equal(adjustedStock(10, 'waste', 3), 7);
  assert.throws(() => adjustedStock(2, 'waste', 3), /available stock/);
});
