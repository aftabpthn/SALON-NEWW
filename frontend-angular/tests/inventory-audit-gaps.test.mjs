import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

const root = path.resolve(import.meta.dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('inventory audit gaps stay closed', () => {
  const page = read('src/app/pages/inventory/inventory-page.component.ts');
  const template = read('src/app/pages/inventory/inventory-page.component.html');
  const audit = read('src/app/pages/inventory/stock-audit/stock-audit-page.component.ts');
  const drafts = read('src/app/pages/inventory/purchase-bill-drafts/purchase-bill-drafts-page.component.ts');
  const route = read('../backend-rust/src/routes/inventory.rs');
  const repository = read('../backend-rust/src/repositories/inventory_repository.rs');
  const inventorySources = fs.readdirSync(path.join(root, 'src/app/pages/inventory'), { recursive: true })
    .filter((file) => file.endsWith('.ts'))
    .map((file) => read(`src/app/pages/inventory/${file}`))
    .join('\n');

  assert.match(page, /getAllPages<Item>/);
  assert.match(page, /getAllLedger\(\)/);
  assert.match(page, /validateGrnSupplierTerms/);
  assert.match(template, /Configure supplier products/);
  assert.match(audit, /getAllInventoryItems/);
  assert.match(drafts, /getAllPages<Order>/);
  assert.match(route, /role_is_one_of\(&claims\.role/);
  assert.match(route, /query\.offset\.unwrap_or\(0\)\.max\(0\)/);
  assert.match(repository, /OFFSET \$\{offset_param\}/);
  assert.doesNotMatch(template, /Â|Ã|â/);
  assert.doesNotMatch(inventorySources, /window\.(?:prompt|confirm)\s*\(/);
});
