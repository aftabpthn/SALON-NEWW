import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const registerPath = resolve(root, 'docs/STAFF_APP_ZENOTI_PARITY_REGISTER.md');
const ledgerPath = resolve(root, 'docs/evidence/staff-app-phase14-ledger.json');
const reportPath = resolve(root, 'docs/evidence/staff-app-phase14-matrix.md');
const dimensions = ['source', 'api', 'database', 'permission', 'browser', 'android', 'ios', 'offline', 'errorRetry', 'audit'];
const terminal = new Set(['PASS', 'NA']);
const allowed = new Set(['REGISTERED', 'PASS', 'FAIL', 'PENDING', 'BLOCKED', 'NA']);

function registerRows() {
  return readFileSync(registerPath, 'utf8').split(/\r?\n/).flatMap((line) => {
    const cells = line.split('|').slice(1, -1).map((cell) => cell.trim());
    return /^[A-F]\d{2}$/.test(cells[0] || '')
      ? [{ id: cells[0], workflow: cells[1], evidence: cells[2], registerStatus: cells[3], phase: cells[4] }]
      : [];
  });
}

function initialLedger(rows) {
  const blockedDevice = { status: 'BLOCKED', evidence: 'Signed real-device evidence is not available.', verifiedAt: '', verifier: '' };
  const pending = { status: 'PENDING', evidence: '', verifiedAt: '', verifier: '' };
  return {
    schemaVersion: 1,
    release: { commit: '', backendImage: '', staffAppVersion: '', environment: '', deployedAt: '' },
    personas: {
      restrictedProvider: { status: 'PENDING', evidence: '' },
      seniorProviderFrontDesk: { status: 'PENDING', evidence: '' },
      manager: { status: 'PENDING', evidence: '' }
    },
    defaults: {
      api: pending, database: pending, permission: pending, browser: pending,
      android: blockedDevice, ios: blockedDevice, offline: pending, errorRetry: pending, audit: pending
    },
    rows: Object.fromEntries(rows.map((row) => [row.id, {
      workflow: row.workflow,
      registerStatus: row.registerStatus,
      businessReason: /PARTIAL|MISSING|EXTERNAL BLOCKED|NOT APPLICABLE/.test(row.registerStatus) ? row.evidence : '',
      regionDecision: /NOT APPLICABLE/.test(row.registerStatus)
        ? { status: 'PENDING', reason: row.evidence, approvedBy: '', approvedAt: '' }
        : null,
      evidence: {
        source: {
          status: row.registerStatus.includes('MISSING') ? 'FAIL' : 'REGISTERED',
          evidence: `docs/STAFF_APP_ZENOTI_PARITY_REGISTER.md row ${row.id}: ${row.evidence}`,
          verifiedAt: '', verifier: ''
        }
      }
    }]))
  };
}

function effective(ledger, row, dimension) {
  return row.evidence?.[dimension] || ledger.defaults?.[dimension] || { status: 'PENDING', evidence: '', verifiedAt: '', verifier: '' };
}

function validate(ledger, rows) {
  const errors = [];
  const ids = new Set(rows.map((row) => row.id));
  for (const id of ids) if (!ledger.rows?.[id]) errors.push(`Missing ledger row ${id}`);
  for (const id of Object.keys(ledger.rows || {})) if (!ids.has(id)) errors.push(`Unknown ledger row ${id}`);
  for (const row of rows) {
    const item = ledger.rows?.[row.id];
    if (!item) continue;
    if (item.registerStatus !== row.registerStatus) errors.push(`${row.id} register status drift: ledger=${item.registerStatus}, register=${row.registerStatus}`);
    if (/PARTIAL|MISSING|EXTERNAL BLOCKED/.test(row.registerStatus) && !item.businessReason?.trim()) errors.push(`${row.id} needs a documented business reason`);
    if (/NOT APPLICABLE/.test(row.registerStatus)) {
      const decision = item.regionDecision;
      if (!decision?.reason?.trim()) errors.push(`${row.id} needs a region-specific reason`);
      if (decision?.status === 'APPROVED' && (!decision.approvedBy?.trim() || !decision.approvedAt?.trim())) errors.push(`${row.id} N/A approval needs approver and date`);
    }
    for (const dimension of dimensions) {
      const check = effective(ledger, item, dimension);
      if (!allowed.has(check.status)) errors.push(`${row.id}.${dimension} has invalid status ${check.status}`);
      if (terminal.has(check.status) && (!check.evidence?.trim() || !check.verifiedAt?.trim() || !check.verifier?.trim())) {
        errors.push(`${row.id}.${dimension} ${check.status} needs evidence, date and verifier`);
      }
    }
  }
  return errors;
}

function summarize(ledger, rows) {
  const counts = Object.fromEntries([...allowed].map((status) => [status, 0]));
  let certifiedRows = 0;
  for (const registerRow of rows) {
    const row = ledger.rows[registerRow.id];
    const checks = dimensions.map((dimension) => effective(ledger, row, dimension).status);
    checks.forEach((status) => { counts[status] += 1; });
    if (checks.every((status) => terminal.has(status))) certifiedRows += 1;
  }
  const missing = rows.filter((row) => row.registerStatus.includes('MISSING')).map((row) => row.id);
  const partial = rows.filter((row) => row.registerStatus.includes('PARTIAL')).map((row) => row.id);
  const naPending = rows.filter((row) => /NOT APPLICABLE/.test(row.registerStatus) && ledger.rows[row.id].regionDecision?.status !== 'APPROVED').map((row) => row.id);
  const personasPass = Object.values(ledger.personas || {}).every((persona) => persona.status === 'PASS' && persona.evidence?.trim());
  const releasePinned = Object.values(ledger.release || {}).every((value) => String(value).trim());
  return {
    totalRows: rows.length, certifiedRows, counts, missing, partial, naPending,
    advanced: certifiedRows === rows.length && missing.length === 0 && partial.length === 0 && naPending.length === 0 && personasPass && releasePinned
  };
}

function markdown(ledger, rows, summary) {
  const short = (value) => String(value || '').replaceAll('|', '\\|').replace(/\s+/g, ' ').trim();
  const header = [
    '# Staff App Phase 14 Row Certification Matrix', '',
    `Generated: ${new Date().toISOString()}`,
    `Release commit: ${ledger.release.commit || 'UNSET'}`,
    `Certified rows: ${summary.certifiedRows}/${summary.totalRows}`,
    `Zenoti advanced: ${summary.advanced ? 'YES' : 'NO'}`, '',
    '| ID | Register | Source | API | DB | Permission | Browser | Android | iOS | Offline | Error/retry | Audit |',
    '|---|---|---|---|---|---|---|---|---|---|---|---|'
  ];
  const body = rows.map((registerRow) => {
    const row = ledger.rows[registerRow.id];
    return `| ${registerRow.id} | ${short(registerRow.registerStatus)} | ${dimensions.map((dimension) => effective(ledger, row, dimension).status).join(' | ')} |`;
  });
  return [...header, ...body, '', '## Blocking summary', '',
    `- Missing rows: ${summary.missing.join(', ') || 'none'}`,
    `- Partial rows: ${summary.partial.join(', ') || 'none'}`,
    `- Unapproved N/A rows: ${summary.naPending.join(', ') || 'none'}`,
    '- A row is certified only when every applicable dimension is `PASS` or approved `NA`.', ''].join('\n');
}

const rows = registerRows();
if (process.argv.includes('--init')) {
  if (existsSync(ledgerPath)) throw new Error(`Refusing to overwrite ${ledgerPath}`);
  mkdirSync(dirname(ledgerPath), { recursive: true });
  writeFileSync(ledgerPath, `${JSON.stringify(initialLedger(rows), null, 2)}\n`);
}
if (!existsSync(ledgerPath)) throw new Error(`Missing ${ledgerPath}; run with --init once.`);
const ledger = JSON.parse(readFileSync(ledgerPath, 'utf8'));
if (process.argv.includes('--sync-register')) {
  for (const row of rows) {
    const item = ledger.rows[row.id] ||= {};
    item.workflow = row.workflow;
    item.registerStatus = row.registerStatus;
    item.businessReason = /PARTIAL|MISSING|EXTERNAL BLOCKED|NOT APPLICABLE/.test(row.registerStatus) ? row.evidence : '';
    if (/NOT APPLICABLE/.test(row.registerStatus)) item.regionDecision ||= { status: 'PENDING', reason: row.evidence, approvedBy: '', approvedAt: '' };
    else item.regionDecision = null;
    item.evidence ||= {};
    item.evidence.source = {
      status: row.registerStatus.includes('MISSING') ? 'FAIL' : 'REGISTERED',
      evidence: `docs/STAFF_APP_ZENOTI_PARITY_REGISTER.md row ${row.id}: ${row.evidence}`,
      verifiedAt: item.evidence.source?.verifiedAt || '', verifier: item.evidence.source?.verifier || ''
    };
  }
  writeFileSync(ledgerPath, `${JSON.stringify(ledger, null, 2)}\n`);
}
const errors = validate(ledger, rows);
if (errors.length) {
  console.error(errors.join('\n'));
  process.exit(1);
}
const summary = summarize(ledger, rows);
if (process.argv.includes('--write')) {
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, markdown(ledger, rows, summary));
}
console.log(JSON.stringify(summary, null, 2));
if (process.argv.includes('--strict') && !summary.advanced) process.exit(2);
