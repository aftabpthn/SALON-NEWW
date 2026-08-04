import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');

test('clients cross-module handoffs and write gates stay wired', () => {
  const clients = read('../src/app/pages/clients/clients-page.component.ts');
  const clientsTemplate = read('../src/app/pages/clients/clients-page.component.html');
  const appointments = read('../src/app/pages/appointments/appointments-page.component.ts');
  const notifications = read('../src/app/pages/notifications/notifications-page.component.ts');
  const routes = read('../../backend-rust/src/routes/clients.rs');

  assert.match(clients, /navigate\(\['\/appointments'\],\s*\{\s*queryParams:\s*\{\s*clientId:\s*this\.selectedClient\.id\s*\}/s);
  assert.match(appointments, /ActivatedRoute/);
  assert.match(appointments, /queryParamMap\.get\('clientId'\)/);
  assert.match(appointments, /if \(routeClient\)[\s\S]{0,200}?this\.selectClient\(routeClient\)/);

  assert.match(clients, /navigate\(\['\/notifications'\],\s*\{\s*queryParams:\s*\{\s*clientId:\s*this\.selectedClient\.id\s*\}/s);
  assert.match(notifications, /ActivatedRoute/);
  assert.match(notifications, /queryParamMap\.get\('clientId'\)/);
  assert.match(notifications, /this\.mode = 'client'/);

  assert.match(clients, /get canManageClients\(\)/);
  assert.match(clientsTemplate, /\[disabled\]="!canManageClients"/);
  assert.match(routes, /async fn create_client\([\s\S]*Extension\(claims\): Extension<AuthClaims>[\s\S]*require_client_permission\(&claims, "clients\.manage"\)\?/);
  assert.match(routes, /async fn update_client\([\s\S]*Extension\(claims\): Extension<AuthClaims>[\s\S]*require_client_permission\(&claims, "clients\.manage"\)\?/);
});
