import assert from 'node:assert/strict';
import test from 'node:test';
import { isOpenOrderStatus, supplierCompleteness, supplierPurchaseMetrics } from '../src/app/pages/suppliers/supplier-metrics.ts';

test('supplier metrics use real master and purchase values', () => {
  assert.equal(supplierCompleteness({ gstin: 'GST', contactName: 'A', phone: '', email: 'a@b.test', address: '' }), 75);
  assert.equal(isOpenOrderStatus('approved'), true);
  assert.equal(isOpenOrderStatus('received'), false);
  assert.deepEqual(
    supplierPurchaseMetrics('s1', [{ supplierId: 's1', status: 'approved' }], [{ supplierId: 's1', totalPaise: 1000, returnedPaise: 200, balancePaise: 300 }]),
    { openOrders: 1, receipts: 1, spendPaise: 800, outstandingPaise: 300 },
  );
});
