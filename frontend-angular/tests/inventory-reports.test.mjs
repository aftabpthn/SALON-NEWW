import assert from 'node:assert/strict';
import test from 'node:test';
import { ageingRows, nearExpiryRows, supplierPerformanceRows, traceabilityRows, varianceRows } from '../src/app/pages/inventory/inventory-report-model.ts';

test('inventory reports derive ageing, expiry, traceability, variance and supplier performance', () => {
  const batches = [
    { inventoryItemId:'p1', productName:'Serum', batchNumber:'B1', receivedDate:'2026-04-01', expiryDate:'2026-07-20', quantity:2, unitCostPaise:500 },
    { inventoryItemId:'p2', productName:'Oil', batchNumber:'B2', receivedDate:'2026-07-15', expiryDate:'2026-08-10', quantity:3, unitCostPaise:200 },
    { inventoryItemId:'p3', productName:'Mask', batchNumber:'B3', receivedDate:'2026-08-01', expiryDate:'2026-08-05', quantity:1, unitCostPaise:100 },
  ];
  assert.deepEqual([ageingRows(batches, '2026-07-27')[0].ageBucket, ageingRows(batches, '2026-07-27').length], ['90+ days', 2]);
  assert.deepEqual(nearExpiryRows(batches, '2026-07-27', 30).map((row) => row.daysRemaining), [-7, 14]);
  assert.deepEqual(traceabilityRows([{ inventoryItemId:'p1', itemName:'Serum', movementType:'sale', quantityDelta:-1, sourceType:'pos_sale', sourceId:'sale-1', createdAt:'2026-07-27T10:00:00Z', batchAllocations:[{ batchId:'b1', batchNumber:'B1', quantityDelta:-1 }] }]).map((row) => row.batchNumber), ['B1']);
  assert.deepEqual(varianceRows({ session:{ id:'a1', name:'July Audit', status:'posted', createdAt:'2026-07-27' }, items:[{ inventoryItemId:'p1', itemName:'Serum', sku:'S1', unit:'pcs', expectedQuantity:4, approvedQuantity:3, varianceQuantity:-1, varianceReason:'Damage' }, { inventoryItemId:'p2', itemName:'Oil', sku:'O1', unit:'pcs', varianceQuantity:0, varianceReason:'' }] }).map((row) => row.inventoryItemId), ['p1']);
  const suppliers = supplierPerformanceRows([{ id:'s1', name:'Supplier One' }], { scorecards:[{ supplierId:'s1', purchaseOrders:4, receivedOrders:3, fillRateBps:7500 }], qualityEvents:[{ supplierId:'s1', returnCount:1, returnedQuantity:2, returnedValuePaise:900, reasons:['Damaged'] }], expiryRisk:[] });
  assert.deepEqual([suppliers[0].supplierName, suppliers[0].returnedValuePaise], ['Supplier One', 900]);
});
