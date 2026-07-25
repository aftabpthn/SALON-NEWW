import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const app = read('../src/app/app.component.ts');
const header = read('../src/app/layout/app-header.component.html');
const headerCss = read('../src/app/layout/app-header.component.css');
const sidebar = read('../src/app/layout/app-sidebar.component.html');
const sidebarCss = read('../src/app/layout/app-sidebar.component.css');
const globalCss = read('../src/styles.css');

assert.match(app, /\[class\.mobile-nav-open\]="mobileNavOpen"/);
assert.match(app, /\[mobileOpen\]="mobileNavOpen"/);
assert.match(app, /\(navigationClosed\)="mobileNavOpen = false"/);
assert.match(header, /aria-controls="primary-navigation"/);
assert.match(header, /\[attr\.aria-expanded\]="mobileNavOpen"/);
assert.match(sidebar, /id="primary-navigation"/);
assert.match(sidebar, /class="rail-label"/);
assert.match(globalCss, /\.app-shell\.mobile-nav-open \.mobile-nav-backdrop/);
assert.match(globalCss, /@media \(max-width: 760px\)[\s\S]*grid-template-columns: 1fr/);
assert.match(sidebarCss, /:host\(\.mobile-open\)[\s\S]*transform: translateX\(0\)/);
assert.match(sidebarCss, /\.flyout-link \{\s*min-height: 44px/);
assert.match(headerCss, /\.mobile-menu-button \{[\s\S]*width: 44px;[\s\S]*height: 44px/);

console.log('Mobile shell responsive checks passed');
