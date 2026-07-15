const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..', 'src', 'app');
const page = fs.readFileSync(path.join(root, 'pages', 'marketing', 'birthday-anniversary', 'birthday-anniversary-page.component.ts'), 'utf8');
const routes = fs.readFileSync(path.join(root, 'app.routes.ts'), 'utf8');
const sidebar = fs.readFileSync(path.join(root, 'layout', 'app-sidebar.component.ts'), 'utf8');

assert.match(routes, /path: 'marketing\/birthdays'/);
assert.match(sidebar, /route: '\/marketing\/birthdays'/);
for (const endpoint of ['birthday-anniversary/overview', 'birthday-anniversary/drafts', 'birthday-campaign/summary']) assert.ok(page.includes(endpoint));

console.log('birthday-anniversary page wiring: ok');
