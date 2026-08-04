import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

const html = read('../src/app/layout/app-header.component.html');
const css = read('../src/app/layout/app-header.component.css');

const drawer = html.slice(
  html.indexOf('<aside class="assistant-drawer"'),
  html.indexOf('</aside>', html.indexOf('<aside class="assistant-drawer"')),
);

const at = (needle) => {
  const index = drawer.indexOf(needle);
  assert.ok(index > -1, `expected to find ${needle} in the assistant drawer`);
  return index;
};

test('the answer and its backing sit together, above the composer', () => {
  // The evidence panel used to render at the very top of the drawer. In a chat
  // panel the newest answer is at the bottom, so its own evidence was at the
  // opposite end from the message it explained.
  const transcript = at('class="assistant-transcript"');
  const context = at('class="assistant-context"');
  const composer = at('<footer><textarea');
  assert.ok(transcript < context, 'evidence belongs below the conversation');
  assert.ok(context < composer, 'and above the composer');
});

test('the conversation cannot be squeezed to nothing', () => {
  // This was the real bug. A flex item defaults to min-height:auto, so the
  // uncapped evidence block simply refused to shrink: metrics, evidence lines,
  // proposals and entities stack up, and the transcript — the thing the panel
  // exists for — got driven toward zero height.
  assert.match(css, /\.assistant-context\{flex:0 0 auto;max-height:45%;overflow-y:auto/);
  // The transcript stays the one item that absorbs whatever is left.
  assert.match(css, /\.assistant-transcript\{[^}]*flex:1 1 auto/);
  assert.match(css, /\.assistant-transcript\{[^}]*min-height:0/);
  assert.match(css, /\.assistant-transcript\{[^}]*overflow:auto/);
});

test('a long provider error does not take the panel over either', () => {
  assert.match(css, /\.assistant-error\{max-height:30vh;overflow-y:auto\}/);
});

test('the drawer is capped in height so the caps mean something', () => {
  // max-height:45% resolves against this; without an explicit height on the
  // parent the percentage would be ignored and the cap would do nothing.
  assert.match(css, /\.assistant-drawer\{[^}]*height:calc\(100vh - 58px\)/);
  assert.match(css, /\.assistant-drawer\{[^}]*flex-direction:column/);
});

test('a pasted link wraps instead of widening the drawer', () => {
  // Replies are pre-wrap, which preserves newlines but does not break a long
  // unbroken token such as a URL.
  assert.match(css, /\.assistant-transcript p\{overflow-wrap:anywhere\}/);
});

test('the small-screen cap leaves more room for the conversation', () => {
  // The drawer is full height on a phone, where 45% of a short viewport is a
  // larger share of the usable space than it is on a desktop.
  assert.match(css, /@media\(max-width:760px\)\{\.assistant-context\{max-height:40%\}\}/);
});

test('auto-scroll still targets its own scroll container', () => {
  // scrollTranscriptToLatest writes scrollTop on this element, so the transcript
  // has to keep being the scroller — moving the evidence must not have turned
  // the whole drawer into one scroll region.
  assert.match(drawer, /#assistantTranscript/);
  const ts = read('../src/app/layout/app-header.component.ts');
  assert.match(ts, /transcript\.scrollTop = transcript\.scrollHeight;/);
  assert.doesNotMatch(css, /\.assistant-drawer\{[^}]*overflow-y:auto/);
});

test('the approval prompt is near the hands, not at the far end', () => {
  // It is the one thing in the panel that asks the user to decide something.
  const context = at('class="assistant-context"');
  const approval = at('class="assistant-approval"');
  const transcript = at('class="assistant-transcript"');
  assert.ok(approval > context && approval > transcript);
  assert.match(drawer, /role="alertdialog"/);
});
