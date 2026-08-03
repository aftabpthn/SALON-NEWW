import { appendFileSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const register = JSON.parse(readFileSync(resolve(import.meta.dirname, '..', 'docs/evidence/zenoti-master-parity-register.json'), 'utf8'));
const cutoff = register.sourceLocks?.releaseNotes?.cutoff;
if (!/^\d{4}-\d{2}-\d{2}$/.test(cutoff || '')) throw new Error('Zenoti release cutoff is missing from the master parity register.');
const url = 'https://help.zenoti.com/en/release-notes.html';
const response = await fetch(url, { headers: { 'User-Agent': 'AuraShine-Parity-Monitor/1.0' } });
if (!response.ok) throw new Error(`Zenoti release index returned HTTP ${response.status}`);
const html = await response.text();
const months = { january: 0, february: 1, march: 2, april: 3, may: 4, june: 5, july: 6, august: 7, september: 8, october: 9, november: 10, december: 11 };
const releases = [...html.matchAll(/(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2}),\s+(20\d{2})/gi)]
  .map((match) => new Date(Date.UTC(Number(match[3]), months[match[1].toLowerCase()], Number(match[2]))))
  .filter((date) => !Number.isNaN(date.valueOf()))
  .sort((left, right) => right.valueOf() - left.valueOf());
if (!releases.length) throw new Error('No dated Zenoti release was found; inspect the source manually.');
const latest = releases[0].toISOString().slice(0, 10);
const changed = latest > cutoff;
console.log(JSON.stringify({ changed, cutoff, latest, url }, null, 2));
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `changed=${changed}\ncutoff=${cutoff}\nlatest=${latest}\nurl=${url}\n`);
