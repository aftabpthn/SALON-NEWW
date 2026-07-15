export type StockWorkflow = 'receive' | 'count' | 'waste';

export function adjustedStock(current: number, workflow: StockWorkflow, quantity: number) {
  if (!Number.isSafeInteger(current) || current < 0 || !Number.isSafeInteger(quantity) || quantity < 0 || (workflow !== 'count' && quantity === 0)) {
    throw new Error('Valid whole quantity is required');
  }
  const next = workflow === 'receive' ? current + quantity : workflow === 'waste' ? current - quantity : quantity;
  if (!Number.isSafeInteger(next) || next < 0) throw new Error('Quantity exceeds available stock');
  return next;
}
