export type SupplierMetricInput = { gstin: string; contactName: string; phone: string; email: string; address: string };
export type SupplierOrderMetricInput = { supplierId: string; status: string };
export type SupplierPayableMetricInput = { supplierId: string; totalPaise: number; returnedPaise: number; balancePaise: number };
export type SupplierPaymentMetricInput = { paidPaise: number; unpaidPaise: number; extraPaidPaise: number; pendingBillsPaise?: number };

export function supplierCompleteness(supplier: SupplierMetricInput) {
  return [supplier.gstin, supplier.contactName, supplier.phone || supplier.email, supplier.address]
    .filter((value) => value.trim()).length * 25;
}

export function isOpenOrderStatus(status: string) {
  return !['received', 'rejected', 'cancelled'].includes(status.toLowerCase());
}

export function supplierPurchaseMetrics(
  supplierId: string,
  orders: SupplierOrderMetricInput[],
  payables: SupplierPayableMetricInput[],
) {
  const supplierPayables = payables.filter((row) => row.supplierId === supplierId);
  return {
    openOrders: orders.filter((row) => row.supplierId === supplierId && isOpenOrderStatus(row.status)).length,
    receipts: supplierPayables.length,
    spendPaise: supplierPayables.reduce((sum, row) => sum + Math.max(row.totalPaise - row.returnedPaise, 0), 0),
    outstandingPaise: supplierPayables.reduce((sum, row) => sum + row.balancePaise, 0),
  };
}

export function supplierPaymentStatus(metric: SupplierPaymentMetricInput) {
  if (metric.unpaidPaise > 0 && metric.paidPaise > 0) return 'Part paid';
  if (metric.unpaidPaise > 0) return 'Unpaid';
  if (metric.extraPaidPaise > 0) return 'Credit';
  if (metric.paidPaise > 0) return 'Paid';
  if ((metric.pendingBillsPaise || 0) > 0) return 'Pending bill';
  return 'No payments';
}
