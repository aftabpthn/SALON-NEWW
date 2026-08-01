import assert from 'node:assert/strict';
import test from 'node:test';
import { isOpenOrderStatus, supplierCompleteness, supplierPaymentStatus, supplierPurchaseMetrics } from '../src/app/pages/suppliers/supplier-metrics.ts';

test('supplier metrics use real master and purchase values', () => {
  assert.equal(supplierCompleteness({ gstin: 'GST', contactName: 'A', phone: '', email: 'a@b.test', address: '' }), 75);
  assert.equal(isOpenOrderStatus('approved'), true);
  assert.equal(isOpenOrderStatus('received'), false);
  assert.deepEqual(
    supplierPurchaseMetrics('s1', [{ supplierId: 's1', status: 'approved' }], [{ supplierId: 's1', totalPaise: 1000, returnedPaise: 200, balancePaise: 300 }]),
    { openOrders: 1, receipts: 1, spendPaise: 800, outstandingPaise: 300 },
  );
});

test('supplier payment status distinguishes payable and credit states', () => {
  assert.equal(supplierPaymentStatus({ paidPaise: 500, unpaidPaise: 300, extraPaidPaise: 0 }), 'Part paid');
  assert.equal(supplierPaymentStatus({ paidPaise: 0, unpaidPaise: 300, extraPaidPaise: 0 }), 'Unpaid');
  assert.equal(supplierPaymentStatus({ paidPaise: 500, unpaidPaise: 0, extraPaidPaise: 100 }), 'Credit');
  assert.equal(supplierPaymentStatus({ paidPaise: 500, unpaidPaise: 0, extraPaidPaise: 0 }), 'Paid');
  assert.equal(supplierPaymentStatus({ paidPaise: 0, unpaidPaise: 0, extraPaidPaise: 0, pendingBillsPaise: 1_000 }), 'Pending bill');
});
