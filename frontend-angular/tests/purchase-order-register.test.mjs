import assert from 'node:assert/strict';
import test from 'node:test';
import { filterPurchaseOrders, matchesPurchaseOrderStage, openPurchaseOrderValue } from '../src/app/pages/inventory/purchase-order-register.ts';

const orders = [
  { orderNumber: 'PO-1', supplierId: 's1', supplierName: 'Alpha', status: 'draft', totalPaise: 1000 },
  { orderNumber: 'PO-2', supplierId: 's2', supplierName: 'Beta', status: 'approved', totalPaise: 2000 },
  { orderNumber: 'PO-3', supplierId: 's2', supplierName: 'Beta', status: 'received', totalPaise: 3000 },
];

test('purchase order register filters real rows and totals only open value', () => {
  assert.equal(filterPurchaseOrders(orders, { query: 'beta', status: '', supplierId: 's2', stage: 'approved' }).length, 1);
  assert.equal(matchesPurchaseOrderStage('received', 'closed'), true);
  assert.equal(openPurchaseOrderValue(orders), 3000);
});
