import { PosCartStore } from './pos-cart.store';

describe('PosCartStore', () => {
  it('adds and totals POS cart items in paise', () => {
    const store = new PosCartStore();

    store.add({ item_type: 'service', item_name: 'Hair spa', quantity: 2, unit_price: 50000, tax_rate: 18 });

    expect(store.subtotal()).toBe(100000);
    expect(store.tax()).toBe(18000);
    expect(store.total()).toBe(118000);
  });

  it('removes cart items', () => {
    const store = new PosCartStore();
    store.add({ item_type: 'product', item_name: 'Serum', quantity: 1, unit_price: 30000, tax_rate: 18 });

    store.remove(0);

    expect(store.items().length).toBe(0);
    expect(store.total()).toBe(0);
  });

  it('clears all cart totals', () => {
    const store = new PosCartStore();
    store.add({ item_type: 'service', item_name: 'Hair cut', quantity: 1, unit_price: 25000, tax_rate: 18 });
    store.add({ item_type: 'product', item_name: 'Shampoo', quantity: 2, unit_price: 12000, tax_rate: 12 });

    store.clear();

    expect(store.items().length).toBe(0);
    expect(store.subtotal()).toBe(0);
    expect(store.tax()).toBe(0);
    expect(store.total()).toBe(0);
  });
});
