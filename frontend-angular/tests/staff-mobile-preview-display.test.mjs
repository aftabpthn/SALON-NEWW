import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('mobile preview dashboard displays API summaries without raw JSON', () => {
  const models = read('../src/app/features/staff-os/domain/staff-os.models.ts');
  const workspace = read('../src/app/pages/staff/staff-os-workspace/staff-os-workspace-page.component.ts');

  assert.match(models, /'mobile-preview': \{[\s\S]+path: '\/staff\/self\/dashboard\?date=\{today\}'/);
  assert.match(models, /'mobile-preview': \{[\s\S]+path: '\/staff\/mobile\/conflicts\?status=open'/);

  assert.match(workspace, /if \(Array\.isArray\(value\)\) return `\$\{value\.length\} \$\{value\.length === 1 \? 'item' : 'items'\}`/);
  assert.match(workspace, /private objectLabel\(value: Record<string, unknown>\)/);
  assert.match(workspace, /\['displayName', 'staffName', 'appointmentDisplayName', 'name', 'title', 'status'\]/);
  assert.doesNotMatch(workspace, /JSON\.stringify\(value\)/);
});
