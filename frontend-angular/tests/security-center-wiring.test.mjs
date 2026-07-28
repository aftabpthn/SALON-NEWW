import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const component = readFileSync('src/app/pages/security/security-center/security-center-page.component.ts', 'utf8');
const template = readFileSync('src/app/pages/security/security-center/security-center-page.component.html', 'utf8');
const routes = readFileSync('../backend-rust/src/routes/security.rs', 'utf8');

test('security center tabs refresh their real API-backed sections', () => {
  assert.match(template, /\(click\)="selectTab\(tab\.key\)"/);
  assert.doesNotMatch(template, /\(click\)="activeTab = tab\.key"/);

  for (const tab of [
    'overview', 'mfa', 'passkeys', 'privileged', 'provisioning', 'audit', 'fieldAudit',
    'sessions', 'devices', 'permissions', 'governance', 'playbooks', 'privacy',
    'alerts', 'blocklist', 'fraud', 'policy',
  ]) {
    assert.match(template, new RegExp(`activeTab === '${tab}'`), `missing ${tab} panel`);
  }

  for (const loader of [
    'reloadSummary', 'reloadMfa', 'reloadPasskeys', 'reloadPrivilegedSession',
    'reloadProvisioning', 'reloadAudit', 'reloadFieldAudit', 'reloadSessions',
    'reloadDevices', 'reloadPermissions', 'reloadSecurityGovernance', 'reloadPlaybooks',
    'reloadPrivacyDisclosure', 'reloadAlerts', 'reloadBlocks', 'reloadFraudGuards',
    'reloadPolicy',
  ]) {
    assert.match(component, new RegExp(`this\\.${loader}\\(`), `selectTab does not call ${loader}`);
  }
});

test('security center command actions stay exposed and wired', () => {
  for (const label of [
    'Setup MFA', 'Enable MFA', 'Disable MFA',
    'Add passkey', 'Delete passkey',
    'Verify session', 'End session',
    'Save SSO policy', 'Generate/Rotate SCIM token', 'Revoke SCIM',
    'Seal &amp; verify', 'Export evidence',
    'Revoke session',
    'Trust', 'Revoke', 'Sign out all',
    'Simulate permission', 'Edit role',
    'Request approval', 'Approve', 'Reject', 'Add access rule', 'Request temporary access', 'Break glass',
    'Add playbook', 'Disable playbook',
    'Add privacy request', 'Resolve request', 'Add disclosure report',
    'Resolve alert',
    'Unblock',
    'Run scan', 'Add warning',
    'Save policy',
  ]) {
    assert.ok(template.includes(label), `${label} command is missing`);
  }

  for (const method of [
    'deleteFirstPasskey', 'revokeFirstSession', 'trustFirstDevice', 'revokeFirstDevice',
    'signOutFirstDevice', 'decideFirstApproval', 'disableFirstPlaybook',
    'resolveFirstPrivacyRequest', 'resolveFirstAlert', 'unblockFirst', 'editRoleLater',
  ]) {
    assert.match(component, new RegExp(`\\b${method}\\(`), `missing ${method}`);
  }
});

test('security center frontend calls have matching backend routes', () => {
  const apiPaths = [...component.matchAll(/(?:get|post|put|patch|delete)<[^>]+>\('([^']+)'/g)]
    .map((match) => match[1].split('?')[0].replace(/\$\{[^}]+\}/g, ':'));
  const backendPaths = [...routes.matchAll(/"\s*(\/(?:security|settings\/security)[^"]*)"/g)]
    .map((match) => match[1].replace(/:[^/]+/g, ':'));
  const authPaths = ['auth/mfa/status', 'auth/mfa/setup', 'auth/mfa/enable', 'auth/mfa/disable', 'auth/webauthn/credentials'];

  for (const path of new Set(apiPaths)) {
    if (authPaths.some((prefix) => path.startsWith(prefix))) continue;
    assert.ok(backendPaths.includes(`/${path}`), `missing backend route ${path}`);
  }
});
