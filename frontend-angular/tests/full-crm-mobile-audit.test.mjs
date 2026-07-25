import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const routes = readFileSync('src/app/app.routes.ts', 'utf8');
const routedPages = [...new Set(
  [...routes.matchAll(/(?:from\s+|import\()'\.\/pages\/(?<path>[^']+\.component)'/g)]
    .map((match) => match.groups.path)
)];

assert.ok(routedPages.length >= 50, 'Route inventory is unexpectedly incomplete');

for (const page of routedPages) {
  const cssPath = resolve('src/app/pages', page + '.css');
  assert.ok(existsSync(cssPath), `Missing routed page CSS: ${page}`);

  const css = readFileSync(cssPath, 'utf8');
  const importedCss = [...css.matchAll(/@import\s+['"](?<path>[^'"]+\.css)['"]/g)]
    .map((match) => resolve(dirname(cssPath), match.groups.path))
    .filter(existsSync)
    .map((path) => readFileSync(path, 'utf8'))
    .join('\n');
  const responsiveCss = css + '\n' + importedCss;

  assert.match(responsiveCss, /@media\s*\(\s*max-width\s*:/, `Missing mobile breakpoint: ${page}`);

  if (/min-width:\s*(?:[6-9]\d{2}|\d{4,})px/.test(responsiveCss)) {
    assert.match(responsiveCss, /overflow(?:-x)?:\s*(?:auto|scroll)/, `Wide content lacks scroll containment: ${page}`);
  }

  const lastViewportGap = css.lastIndexOf('calc(100vw');
  if (lastViewportGap >= 0) {
    const fullWidthRules = [...css.matchAll(/width:\s*100vw/g)];
    const lastFullWidth = fullWidthRules.at(-1)?.index ?? -1;
    assert.ok(lastFullWidth > lastViewportGap, `Mobile drawer keeps a viewport gap: ${page}`);
  }
}

console.log(`Full CRM mobile audit checks passed for ${routedPages.length} routed pages`);
