import fs from 'fs';
import path from 'path';

const TARGET_PATH = path.resolve(
  process.argv[2] || path.resolve(process.cwd(), 'frontend-angular/src/app'),
);
const INCLUDE_ATTR_TRANS = /\|\s*translate(\b|\()/;
const IGNORE_EXACT = new Set([
  'ng-container',
  'ng-template',
  'i18n',
]);
const IGNORE_PATTERNS = [
  /^\s*(@if|@for|@else|@empty)\b/,
  /\b(let|as)\b/,
  /<[^>]*>/,
  /\{\{.*\}\}/,
  /\bclass=|id=|href=|src=|aria-|type=|\$event\b/,
  /^\s*\/\/.*/,
  /^\s*[\d.,%/-]+\s*$/,
  /^\s*[@{(<]/,
];

function readFiles(directory, suffix) {
  const entries = fs.readdirSync(directory, { withFileTypes: true });
  const out = [];

  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      out.push(...readFiles(fullPath, suffix));
      continue;
    }
    if (path.extname(entry.name).toLowerCase() === suffix) out.push(fullPath);
  }

  return out;
}

function normalizeLine(line) {
  return line
    .replace(/<[^>]*>/g, ' ')
    .replace(/\{\{[^}]*\}\}/g, ' ')
    .replace(/\[@\w+[^\]]*\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function hasObviousValue(line) {
  const hasLetters = /[A-Za-z\p{L}]/u.test(line);
  if (!hasLetters) return false;

  if (/(^|\s)@if|@for|@empty|@else/.test(line)) return false;
  if (INCLUDE_ATTR_TRANS.test(line) || /\btranslate\b/.test(line)) return false;
  if (/\([^)]+\)|=>|\[[^\]]*\]|\{\{\{|\}\}\}/.test(line)) return false;
  if (/\/\/.*/.test(line)) return false;
  if (IGNORE_PATTERNS.some((pattern) => pattern.test(line))) return false;
  if (IGNORE_EXACT.has(line)) return false;

  return true;
}

function collect(line, index, file, findings) {
  const text = normalizeLine(line);
  if (!text || !hasObviousValue(text)) return;
  findings.push({ file, line: index + 1, text });
}

function scanTemplate(file) {
  const findings = [];
  const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) collect(lines[i], i, file, findings);
  return findings;
}

function main() {
  const htmlFiles = readFiles(TARGET_PATH, '.html');
  const findings = [];
  for (const file of htmlFiles) findings.push(...scanTemplate(file));

  if (!findings.length) {
    console.log('[i18n-gap-scan] no obvious hardcoded strings detected in HTML templates');
    return;
  }

  const byFile = new Map();
  for (const item of findings) {
    const list = byFile.get(item.file) ?? [];
    list.push(item);
    byFile.set(item.file, list);
  }

  const entries = [...byFile.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
  console.log(`[i18n-gap-scan] potential gaps: ${findings.length} in ${entries.length} files`);
  console.log('[i18n-gap-scan] per-file summary:');
  for (const [file, rows] of entries) {
    console.log(`- ${path.relative(process.cwd(), file)}: ${rows.length}`);
  }

  console.log('[i18n-gap-scan] first issues:');
  for (const item of findings.slice(0, 250)) {
    console.log(`${path.relative(process.cwd(), item.file)}:${item.line}: ${item.text}`);
  }
  if (findings.length > 250) {
    console.log(`[i18n-gap-scan] ... truncated, ${findings.length - 250} more lines`);
  }
}

main();
