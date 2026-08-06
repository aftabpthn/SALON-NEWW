import assert from 'node:assert/strict';
import test from 'node:test';

import { linkedTextHash } from '../../scripts/verify-zenoti-master-parity.mjs';

test('linked register hashes are independent of platform line endings', () => {
  const lf = '# Register\n\n| ID | Status |\n';
  assert.equal(linkedTextHash(lf.replaceAll('\n', '\r\n')), linkedTextHash(lf));
  assert.equal(linkedTextHash(lf.replaceAll('\n', '\r')), linkedTextHash(lf));
});
