export type ReportBatch = { inventoryItemId:string; productName:string; batchNumber:string; expiryDate?:string; receivedDate:string; quantity:number; unitCostPaise:number };
export type ReportLedger = { inventoryItemId:string; itemName:string; movementType:string; quantityDelta:number; sourceType:string; sourceId:string; createdAt:string; batchAllocations:Array<{ batchId:string; batchNumber:string; expiryDate?:string; quantityDelta:number }> };
export type AuditDetails = { session:{ id:string; name:string; status:string; createdAt:string }; items:Array<{ inventoryItemId:string; itemName:string; sku:string; unit:string; expectedQuantity?:number; approvedQuantity?:number; varianceQuantity?:number; varianceReason:string; postedAt?:string }> };

export const csvContent = (headers:string[], rows:(string|number)[][]) => [headers, ...rows]
  .map((row) => row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(',')).join('\r\n');

const day = (value:string) => Math.floor(Date.parse(`${value.slice(0,10)}T00:00:00Z`) / 86_400_000);

export function ageingRows(batches:ReportBatch[], asOf:string) {
  const end = day(asOf);
  return batches.filter((row) => row.quantity > 0 && row.receivedDate && day(row.receivedDate) <= end).map((row) => {
    const ageDays = Math.max(end - day(row.receivedDate), 0);
    return { ...row, ageDays, ageBucket: ageDays <= 30 ? '0-30 days' : ageDays <= 60 ? '31-60 days' : ageDays <= 90 ? '61-90 days' : '90+ days', stockValuePaise: row.quantity * row.unitCostPaise };
  }).sort((a,b) => b.ageDays - a.ageDays);
}

export function nearExpiryRows(batches:ReportBatch[], asOf:string, windowDays:number) {
  const start = day(asOf);
  return batches.filter((row) => row.quantity > 0 && row.expiryDate && day(row.receivedDate) <= start).map((row) => ({ ...row, daysRemaining: day(row.expiryDate!) - start, riskValuePaise: row.quantity * row.unitCostPaise }))
    .filter((row) => row.daysRemaining <= windowDays).sort((a,b) => a.daysRemaining - b.daysRemaining);
}

export function traceabilityRows(ledger:ReportLedger[]) {
  return ledger.flatMap((row) => row.batchAllocations.map((batch) => ({ inventoryItemId:row.inventoryItemId, productName:row.itemName, batchNumber:batch.batchNumber, batchId:batch.batchId, expiryDate:batch.expiryDate, movementType:row.movementType, quantityDelta:batch.quantityDelta, sourceType:row.sourceType, sourceId:row.sourceId, createdAt:row.createdAt })))
    .sort((a,b) => b.createdAt.localeCompare(a.createdAt));
}

export function varianceRows(details:AuditDetails|null) {
  return (details?.items ?? []).filter((row) => Number(row.varianceQuantity || 0) !== 0)
    .sort((a,b) => Math.abs(Number(b.varianceQuantity)) - Math.abs(Number(a.varianceQuantity)));
}

export function supplierPerformanceRows(
  suppliers:Array<{id:string;name:string}>,
  governance:{ scorecards:Array<{supplierId:string;purchaseOrders:number;receivedOrders:number;onTimeRateBps?:number;fillRateBps?:number;lastReceiptDate?:string}>; qualityEvents:Array<{supplierId:string;returnCount:number;returnedQuantity:number;returnedValuePaise:number;lastReturnAt?:string;reasons:string[]}>; expiryRisk:Array<{supplierId:string;expiredQuantity:number;expiring30Quantity:number;riskValuePaise:number}> },
) {
  const scorecards = new Map(governance.scorecards.map((row) => [row.supplierId,row]));
  const quality = new Map(governance.qualityEvents.map((row) => [row.supplierId,row]));
  const expiry = new Map(governance.expiryRisk.map((row) => [row.supplierId,row]));
  return suppliers.map((supplier) => {
    const row = scorecards.get(supplier.id);
    return { supplierId:supplier.id, supplierName:supplier.name, purchaseOrders:row?.purchaseOrders ?? 0, receivedOrders:row?.receivedOrders ?? 0, onTimeRateBps:row?.onTimeRateBps, fillRateBps:row?.fillRateBps, lastReceiptDate:row?.lastReceiptDate, returnCount:quality.get(supplier.id)?.returnCount ?? 0, returnedQuantity:quality.get(supplier.id)?.returnedQuantity ?? 0, returnedValuePaise:quality.get(supplier.id)?.returnedValuePaise ?? 0, returnReasons:quality.get(supplier.id)?.reasons ?? [], expiryRiskValuePaise:expiry.get(supplier.id)?.riskValuePaise ?? 0 };
  })
    .sort((a,b) => b.purchaseOrders - a.purchaseOrders);
}
