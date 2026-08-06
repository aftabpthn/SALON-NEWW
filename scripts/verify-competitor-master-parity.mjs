import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const evidenceDir = resolve(root, 'docs/evidence');
const salonistHelp = 'https://help.salonist.io/en/';
const salonistFeatures = 'https://salonist.io/industries/pricing/';
const dinggHelp = 'https://api.dingg.app/api/v1/help/menu?app_type=web';
const dinggFeatures = 'https://dingg.app/us';
const mode = process.argv[2] ?? '--verify';

const vendors = {
  salonist: {
    json: resolve(evidenceDir, 'salonist-master-parity-register.json'),
    csv: resolve(evidenceDir, 'salonist-master-parity-register.csv'),
    report: resolve(root, 'docs/SALONIST_MASTER_PARITY_REGISTER.md'),
  },
  dingg: {
    json: resolve(evidenceDir, 'dingg-master-parity-register.json'),
    csv: resolve(evidenceDir, 'dingg-master-parity-register.csv'),
    report: resolve(root, 'docs/DINGG_MASTER_PARITY_REGISTER.md'),
  },
};

const clean = (html) => html
  .replace(/<[^>]+>/g, ' ')
  .replace(/&#x27;|&#39;|&apos;/g, "'")
  .replace(/&amp;/g, '&')
  .replace(/&quot;/g, '"')
  .replace(/\s+/g, ' ')
  .trim();
const hash = (value) => createHash('sha256').update(value).digest('hex');
const csvCell = (value) => `"${String(value ?? '').replaceAll('"', '""')}"`;
const stableHash = (register) => hash(JSON.stringify({ vendor: register.vendor, sources: register.sources, rows: register.rows }));

function links(html, base, pathnamePrefix) {
  const rows = [];
  for (const match of html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    let url;
    try { url = new URL(match[1], base); } catch { continue; }
    if (url.pathname.startsWith(pathnamePrefix)) rows.push({ url: url.href, inner: match[2], text: clean(match[2]) });
  }
  return [...new Map(rows.map((row) => [row.url, row])).values()];
}

function row(vendor, number, category, subcategory, feature, officialUrl, sourceType, sourceKey) {
  return {
    id: `${vendor === 'salonist' ? 'SAL' : 'DIN'}-${String(number).padStart(4, '0')}`,
    vendor, category, subcategory, feature, officialUrl, sourceType, sourceKey,
    auraShine: {
      ui: 'NOT_EVIDENCED_IN_ATOMIC_REGISTER',
      api: 'NOT_EVIDENCED_IN_ATOMIC_REGISTER',
      data: 'NOT_EVIDENCED_IN_ATOMIC_REGISTER',
      testOrUat: 'NOT_EVIDENCED_IN_ATOMIC_REGISTER',
    },
    status: 'Unmapped',
    blocker: 'AuraShine source and UAT evidence has not been reviewed for this atomic capability.',
  };
}

async function fetchText(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`);
  return response.text();
}

async function salonistRegister(generatedAt) {
  const [indexHtml, featureHtml] = await Promise.all([fetchText(salonistHelp), fetchText(salonistFeatures)]);
  const collections = links(indexHtml, salonistHelp, '/en/collections/');
  const collectionHtml = await Promise.all(collections.map(({ url }) => fetchText(url)));
  const atomic = [];
  for (let i = 0; i < collections.length; i += 1) {
    const category = collections[i].text.replace(/\s+By\s.+$/i, '').trim();
    for (const article of links(collectionHtml[i], collections[i].url, '/en/articles/')) {
      const firstSpan = article.inner.match(/<span\b[^>]*>([\s\S]*?)<\/span>/i);
      atomic.push({ category, subcategory: 'Help Center', feature: clean(firstSpan?.[1] ?? article.text), officialUrl: article.url, sourceType: 'help_article', sourceKey: article.url });
    }
  }
  for (const feature of links(featureHtml, salonistFeatures, '/features/')) {
    atomic.push({ category: 'Public feature', subcategory: 'Feature page', feature: feature.text, officialUrl: feature.url, sourceType: 'feature_page', sourceKey: feature.url });
  }
  const unique = [...new Map(atomic.map((item) => [`${item.officialUrl}|${item.feature.toLowerCase()}`, item])).values()]
    .sort((a, b) => a.officialUrl.localeCompare(b.officialUrl));
  const register = {
    vendor: 'Salonist', generatedAt,
    sources: [
      { url: salonistHelp, sha256: hash(indexHtml), collections: collections.length },
      { url: salonistFeatures, sha256: hash(featureHtml) },
      { url: 'SALONIST_HELP_COLLECTION_PAGES', sha256: hash(collectionHtml.join('\n')), pages: collectionHtml.length },
    ],
    rows: unique.map((item, index) => row('salonist', index + 1, item.category, item.subcategory, item.feature, item.officialUrl, item.sourceType, item.sourceKey)),
  };
  register.registerHash = stableHash(register);
  return register;
}

async function dinggRegister(generatedAt) {
  const [menuText, featureHtml] = await Promise.all([fetchText(dinggHelp), fetchText(dinggFeatures)]);
  const menu = JSON.parse(menuText);
  if (menu.status !== 'success' || !Array.isArray(menu.data)) throw new Error('DINGG Help returned an invalid menu payload');
  const atomic = [];
  for (const category of menu.data) for (const subcategory of category.help_sub_category ?? []) for (const topic of subcategory.help_topic ?? []) {
    atomic.push({ category: category.category, subcategory: subcategory.subcategory, feature: topic.title, officialUrl: `https://docs.dingg.app/${encodeURI(topic.path)}`, sourceType: 'help_topic', sourceKey: String(topic.key) });
  }
  for (const feature of links(featureHtml, dinggFeatures, '/features/')) {
    atomic.push({ category: 'Public feature', subcategory: 'Feature page', feature: feature.text, officialUrl: feature.url, sourceType: 'feature_page', sourceKey: feature.url });
  }
  const unique = [...new Map(atomic.map((item) => [`${item.sourceType}|${item.sourceKey}`, item])).values()]
    .sort((a, b) => a.officialUrl.localeCompare(b.officialUrl));
  const register = {
    vendor: 'DINGG', generatedAt,
    sources: [
      { url: dinggHelp, sha256: hash(menuText), categories: menu.data.length },
      { url: dinggFeatures, sha256: hash(featureHtml) },
    ],
    rows: unique.map((item, index) => row('dingg', index + 1, item.category, item.subcategory, item.feature, item.officialUrl, item.sourceType, item.sourceKey)),
  };
  register.registerHash = stableHash(register);
  return register;
}

function validate(register) {
  const errors = [];
  const ids = new Set();
  const signatures = new Set();
  for (const item of register.rows) {
    const signature = `${item.sourceType}|${item.sourceKey}`;
    if (ids.has(item.id)) errors.push(`duplicate id ${item.id}`);
    if (signatures.has(signature)) errors.push(`duplicate source ${signature}`);
    if (!item.feature || !item.officialUrl.startsWith('https://')) errors.push(`invalid row ${item.id}`);
    ids.add(item.id); signatures.add(signature);
  }
  if (register.registerHash !== stableHash(register)) errors.push('register hash mismatch');
  return errors;
}

function write(register, paths) {
  const sourceCounts = Object.fromEntries([...new Set(register.rows.map((item) => item.sourceType))].map((type) => [type, register.rows.filter((item) => item.sourceType === type).length]));
  const columns = ['id', 'vendor', 'category', 'subcategory', 'feature', 'officialUrl', 'sourceType', 'sourceKey', 'status', 'blocker'];
  const csv = [columns.map(csvCell).join(','), ...register.rows.map((item) => columns.map((column) => csvCell(item[column])).join(','))].join('\n');
  const label = register.vendor.toUpperCase();
  const markdown = `# ${label} Master Parity Register\n\nOfficial-source baseline synced: **${register.generatedAt}**  \nAtomic rows: **${register.rows.length}**  \nStatus: **all Unmapped pending AuraShine evidence review**  \nMachine-readable: [JSON](./evidence/${register.vendor.toLowerCase()}-master-parity-register.json) · [CSV](./evidence/${register.vendor.toLowerCase()}-master-parity-register.csv)  \nCandidate triage: [${label} parity triage](./${label}_PARITY_TRIAGE.md)\n\n## Source counts\n\n${Object.entries(sourceCounts).map(([type, count]) => `- ${type}: ${count}`).join('\n')}\n\n## Rules\n\n- An official help topic or public feature page is one atomic source row.\n- Search candidates are not evidence and cannot mark a row Complete.\n- Complete requires reviewed UI, API/data, permissions and test/UAT evidence.\n- Provider, hardware and production activation remain separate certification gates.\n\nRegister hash: \`${register.registerHash}\`\n`;
  writeFileSync(paths.json, `${JSON.stringify(register, null, 2)}\n`);
  writeFileSync(paths.csv, `${csv}\n`);
  writeFileSync(paths.report, markdown);
}

if (mode === '--sync') {
  mkdirSync(evidenceDir, { recursive: true });
  const generatedAt = new Date().toISOString();
  const registers = await Promise.all([salonistRegister(generatedAt), dinggRegister(generatedAt)]);
  for (const register of registers) write(register, vendors[register.vendor.toLowerCase()]);
  console.log(JSON.stringify(Object.fromEntries(registers.map((register) => [register.vendor, { rows: register.rows.length, hash: register.registerHash }])), null, 2));
} else {
  const results = {};
  for (const [vendor, paths] of Object.entries(vendors)) {
    const register = JSON.parse(readFileSync(paths.json, 'utf8'));
    const errors = validate(register);
    results[vendor] = { rows: register.rows.length, errors };
    if (errors.length) process.exitCode = 1;
  }
  console.log(JSON.stringify(results, null, 2));
}
