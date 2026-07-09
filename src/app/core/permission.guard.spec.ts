// Tests the GRANTS permission matrix logic without Angular DI.
// The allows() function is internal, so we replicate its logic here to validate the matrix.

const GRANTS: Record<string, string[]> = {
  superAdmin: ['*'],
  owner: ['*'],
  admin: ['*'],
  manager: [
    'read:dashboard', 'read:appointments', 'read:clients', 'read:services', 'read:products', 'read:inventory', 'read:sales', 'use:pos', 'read:invoices', 'read:payments', 'read:staff', 'read:reports', 'write:clients', 'write:appointments', 'write:services',
    'write:products', 'write:inventory', 'write:sales', 'write:invoices',
    'write:payments', 'write:appointment_deposits', 'write:staff'
  ],
  receptionist: [
    'read:dashboard', 'read:appointments', 'read:clients', 'read:services', 'read:products', 'read:sales', 'use:pos', 'read:invoices', 'read:payments', 'write:clients', 'write:appointments', 'write:sales',
    'write:invoices', 'write:payments', 'write:appointment_deposits', 'read:smart-booking', 'write:smart-booking', 'read:booking-portal', 'write:booking-portal'
  ],
  cashier: ['read:dashboard', 'read:clients', 'read:services', 'read:products', 'read:sales', 'use:pos', 'read:invoices', 'read:payments', 'write:clients', 'write:sales', 'write:invoices', 'write:payments', 'read:appointment_deposits', 'write:appointment_deposits'],
  accountant: ['read:dashboard', 'read:finance', 'read:invoices', 'read:payments', 'write:finance', 'write:invoices', 'write:payments', 'read:appointment_deposits', 'read:reports', 'read:analytics'],
  inventoryManager: ['read:dashboard', 'read:products', 'read:inventory', 'read:suppliers', 'read:inventory-intelligence', 'write:products', 'write:inventory', 'write:suppliers', 'write:inventory-intelligence'],
  staff: ['read:appointments', 'read:clients', 'read:services', 'read:products', 'write:appointments'],
  analyst: ['read:*', 'write:analytics']
};

function allows(role: string, perm: string): boolean {
  const grants = GRANTS[role] || [];
  if (grants.includes('*')) return true;
  if (grants.includes(perm)) return true;
  const [action] = perm.split(':');
  return grants.includes(`${action}:*`);
}

describe('Permission GRANTS matrix', () => {
  // Superuser roles
  it('owner can do everything', () => {
    expect(allows('owner', 'write:finance')).toBe(true);
    expect(allows('owner', 'write:super_admin')).toBe(true);
    expect(allows('owner', 'read:audit')).toBe(true);
  });

  it('superAdmin can do everything', () => {
    expect(allows('superAdmin', 'write:invoices')).toBe(true);
  });

  // Manager
  it('manager can write invoices and read operational modules', () => {
    expect(allows('manager', 'write:invoices')).toBe(true);
    expect(allows('manager', 'read:clients')).toBe(true);
    expect(allows('manager', 'use:pos')).toBe(true);
    expect(allows('manager', 'read:analytics')).toBe(false);
  });

  it('manager cannot write finance', () => {
    expect(allows('manager', 'write:finance')).toBe(false);
  });

  // Receptionist
  it('receptionist can write appointments', () => {
    expect(allows('receptionist', 'write:appointments')).toBe(true);
    expect(allows('receptionist', 'use:pos')).toBe(true);
  });

  it('receptionist cannot write finance', () => {
    expect(allows('receptionist', 'write:finance')).toBe(false);
  });

  it('receptionist cannot write inventory', () => {
    expect(allows('receptionist', 'write:inventory')).toBe(false);
  });

  // Cashier
  it('cashier can handle invoice/payment flow without finance access', () => {
    expect(allows('cashier', 'write:payments')).toBe(true);
    expect(allows('cashier', 'use:pos')).toBe(true);
    expect(allows('cashier', 'read:finance')).toBe(false);
    expect(allows('cashier', 'write:finance')).toBe(false);
  });

  it('cashier cannot write appointments', () => {
    expect(allows('cashier', 'write:appointments')).toBe(false);
  });

  // Accountant
  it('accountant can write finance and invoices', () => {
    expect(allows('accountant', 'write:finance')).toBe(true);
    expect(allows('accountant', 'write:invoices')).toBe(true);
  });

  it('accountant cannot write clients', () => {
    expect(allows('accountant', 'write:clients')).toBe(false);
  });

  it('accountant cannot use POS checkout', () => {
    expect(allows('accountant', 'use:pos')).toBe(false);
  });

  // Inventory manager
  it('inventoryManager can write inventory and suppliers', () => {
    expect(allows('inventoryManager', 'write:inventory')).toBe(true);
    expect(allows('inventoryManager', 'write:suppliers')).toBe(true);
  });

  it('inventoryManager cannot write invoices', () => {
    expect(allows('inventoryManager', 'write:invoices')).toBe(false);
  });

  // Staff
  it('staff can write appointments', () => {
    expect(allows('staff', 'write:appointments')).toBe(true);
  });

  it('staff cannot read finance', () => {
    expect(allows('staff', 'read:finance')).toBe(false);
  });

  it('staff cannot read analytics', () => {
    expect(allows('staff', 'read:analytics')).toBe(false);
  });

  it('analyst read wildcard does not allow POS checkout', () => {
    expect(allows('analyst', 'read:reports')).toBe(true);
    expect(allows('analyst', 'use:pos')).toBe(false);
  });

  // Unknown role
  it('unknown role has no permissions', () => {
    expect(allows('guest', 'read:clients')).toBe(false);
    expect(allows('', 'write:invoices')).toBe(false);
  });
});
