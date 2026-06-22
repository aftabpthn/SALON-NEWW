import { PaymentStore } from './payment.store';

describe('PaymentStore', () => {
  it('starts with cash and UPI split payment lines', () => {
    const store = new PaymentStore();

    expect(store.splitPayments()).toEqual([
      { mode: 'cash', amount: 0 },
      { mode: 'upi', amount: 0 }
    ]);
  });

  it('tracks payment busy state', () => {
    const store = new PaymentStore();

    store.paymentBusy.set(true);

    expect(store.paymentBusy()).toBe(true);
  });
});
