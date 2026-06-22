import { BillingStore } from './billing.store';

describe('BillingStore', () => {
  it('starts with empty POS selection state and enabled money actions', () => {
    const store = new BillingStore();

    expect(store.selectedCustomerId()).toBe('');
    expect(store.selectedBranchId()).toBe('');
    expect(store.draftAutosaveState()).toBe('idle');
    expect(store.permission()).toEqual({ canRefund: true, canVoid: true });
  });

  it('tracks selected customer, branch, and draft autosave state', () => {
    const store = new BillingStore();

    store.selectedCustomerId.set('customer-101');
    store.selectedBranchId.set('branch-main');
    store.draftAutosaveState.set('saving');

    expect(store.selectedCustomerId()).toBe('customer-101');
    expect(store.selectedBranchId()).toBe('branch-main');
    expect(store.draftAutosaveState()).toBe('saving');
  });
});
