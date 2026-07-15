export type PurchaseOrderStage = '' | 'draft' | 'approved' | 'partially_received' | 'closed';

export type PurchaseOrderRegisterRow = {
  orderNumber: string;
  supplierId: string;
  supplierName: string;
  status: string;
  totalPaise: number;
};

export function isOpenPurchaseOrder(status: string) {
  return !['received', 'rejected', 'cancelled'].includes(status.toLowerCase());
}

export function matchesPurchaseOrderStage(status: string, stage: PurchaseOrderStage) {
  if (!stage) return true;
  if (stage === 'closed') return !isOpenPurchaseOrder(status);
  return status.toLowerCase() === stage;
}

export function filterPurchaseOrders<T extends PurchaseOrderRegisterRow>(
  orders: T[],
  filters: { query: string; status: string; supplierId: string; stage: PurchaseOrderStage },
) {
  const query = filters.query.trim().toLowerCase();
  return orders.filter((order) =>
    (!query || `${order.orderNumber} ${order.supplierName}`.toLowerCase().includes(query))
    && (!filters.status || order.status === filters.status)
    && (!filters.supplierId || order.supplierId === filters.supplierId)
    && matchesPurchaseOrderStage(order.status, filters.stage));
}

export function openPurchaseOrderValue(orders: PurchaseOrderRegisterRow[]) {
  return orders.filter((order) => isOpenPurchaseOrder(order.status)).reduce((sum, order) => sum + order.totalPaise, 0);
}
