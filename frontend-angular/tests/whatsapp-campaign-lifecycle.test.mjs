import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('WhatsApp campaign lifecycle is versioned, audited and centralized in Marketing', () => {
  const migration = read('../backend-rust/migrations/0286_whatsapp_campaign_lifecycle.sql');
  const repository = read('../backend-rust/src/repositories/whatsapp_repository.rs');
  const routes = read('../backend-rust/src/routes/whatsapp.rs');
  const middleware = read('../backend-rust/src/middleware/tenant.rs');
  const marketing = read('src/app/pages/marketing/marketing-leads-page.component.html');
  const marketingLogic = read('src/app/pages/marketing/marketing-leads-page.component.ts');
  const messaging = read('src/app/pages/messaging/whatsapp-automation-page.component.html');
  const messagingLogic = read('src/app/pages/messaging/whatsapp-automation-page.component.ts');
  const whatsappSection = marketing.match(/WhatsApp campaign lifecycle[\s\S]*?Omnichannel campaigns/)?.[0] ?? '';

  for (const status of ['pending', 'rejected', 'stopped', 'archived']) assert.match(migration, new RegExp(`'${status}'`));
  assert.match(migration, /version INTEGER NOT NULL DEFAULT 1/);
  assert.match(repository, /version=version\+1/);
  assert.match(repository, /status IN \('draft','rejected','stopped'\)/);
  assert.doesNotMatch(repository, /DELETE FROM whatsapp_campaign_plans/i);

  for (const action of ['submit', 'approve', 'reject', 'schedule', 'stop', 'archive', 'restore']) {
    assert.match(routes, new RegExp(`plans/:id/${action}`));
    assert.match(marketing, new RegExp(`'${action}'`));
  }
  assert.match(routes, /security_service::record_audit/);
  assert.match(routes, /require_campaign_permission/);
  assert.match(middleware, /whatsapp-campaign-planner/);
  assert.match(marketingLogic, /whatsapp-campaign-planner\/plans/);
  assert.match(whatsappSection, />Edit</);
  assert.doesNotMatch(whatsappSection, />Delete</);
  assert.doesNotMatch(messaging, /Campaign planner/);
  assert.doesNotMatch(messagingLogic, /whatsapp-campaign-planner\/plans/);
});
