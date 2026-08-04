import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const src = readFileSync(new URL('../src/app/features/home/home.page.ts', import.meta.url), 'utf8');
const css = src.slice(src.indexOf('styles: [`') + 10, src.lastIndexOf('`]'));

/** Media block bodies, keyed by breakpoint. The stylesheet declares the phone
 *  breakpoint twice, so each key holds every matching block joined together. */
const breakpoints = () => {
  const blocks = new Map();
  const re = /@media \((min|max)-width: (\d+)px\) \{/g;
  let match;
  while ((match = re.exec(css))) {
    let depth = 1;
    let index = match.index + match[0].length;
    const start = index;
    while (depth > 0 && index < css.length) {
      if (css[index] === '{') depth += 1;
      else if (css[index] === '}') depth -= 1;
      index += 1;
    }
    const key = `${match[1]}-${match[2]}`;
    const body = css.slice(start, index - 1);
    blocks.set(key, blocks.has(key) ? `${blocks.get(key)}\n${body}` : body);
  }
  return blocks;
};

const GRIDS = ['.business-grid', '.nearby-grid', '.skeleton-grid'];

test('every card grid changes column count together', () => {
  // Card sections stack directly on top of each other. When one reached four
  // columns and its neighbour stayed at three, the same card rendered at two
  // different widths on one screen, which reads as a broken page.
  const blocks = breakpoints();
  for (const key of ['min-768', 'min-1024', 'min-1440']) {
    const block = blocks.get(key);
    assert.ok(block, `expected a ${key} breakpoint`);
    const rule = block.match(/([^{}]*)\{[^}]*grid-template-columns:\s*repeat\(\d+/);
    assert.ok(rule, `${key} should size the card grids`);
    for (const grid of GRIDS) {
      assert.ok(rule[1].includes(grid), `${key} must include ${grid}, got: ${rule[1].trim()}`);
    }
  }
});

test('the skeleton occupies the space its results will take', () => {
  // It stood at three columns while the results arrived at four, so the page
  // jumped sideways the moment loading finished.
  const blocks = breakpoints();
  const wide = blocks.get('min-1440');
  const rule = wide.match(/([^{}]*)\{[^}]*grid-template-columns:\s*repeat\(4/);
  assert.ok(rule, 'the widest breakpoint should reach four columns');
  assert.ok(rule[1].includes('.skeleton-grid'));
  assert.ok(rule[1].includes('.business-grid'));
});

test('the tight mobile card treatment stays on mobile', () => {
  // These two rules sat one line below the closing brace of the phone
  // breakpoint. Their indentation said mobile-only; their position made them
  // global, so recommended cards carried a portrait image ratio and a 10px gap
  // on desktop while every neighbouring section used 18px.
  const mobile = breakpoints().get('max-599');
  assert.ok(mobile, 'expected a max-width: 599px breakpoint');
  assert.match(mobile, /--card-image-ratio: 1\.65;/);
  assert.match(mobile, /\.home-page \.business-grid\.recommended \{\s*gap: 10px;/);

  // And nowhere else. A second copy at top level would restore the bug.
  assert.equal(css.split('--card-image-ratio: 1.65').length - 1, 1);
  assert.equal(css.split('.home-page .business-grid.recommended {').length - 1, 1);
});

test('the gap override no longer needs !important', () => {
  // It only needed it to beat the desktop rule it was never meant to meet.
  assert.doesNotMatch(css, /gap: 10px !important/);
});

test('the mobile rules sit inside a phone breakpoint, not beside one', () => {
  // The whole bug was one stray closing brace: the rules were indented as if
  // they were inside the block and were in fact one line past its end. So the
  // containment is asserted by brace scanning rather than trusted to layout.
  const phone = breakpoints().get('max-599');
  assert.ok(phone, 'expected a max-width: 599px breakpoint');
  assert.ok(
    phone.includes('--card-image-ratio: 1.65'),
    'the mobile card treatment must be inside the phone breakpoint',
  );
});
