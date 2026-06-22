import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const offlineService = readFileSync("server/services/offline.service.js", "utf8");
const offlineRoutes = readFileSync("server/routes/offline.routes.js", "utf8");
const appRoutes = readFileSync("src/app/app.routes.ts", "utf8");
const appComponent = readFileSync("src/app/app.component.ts", "utf8");
const offlineSupportPage = readFileSync("src/app/pages/offline-support.component.ts", "utf8");
const syncQueuePage = readFileSync("src/app/pages/offline-sync-queue.component.ts", "utf8");
const deviceHealthPage = readFileSync("src/app/pages/offline-device-health.component.ts", "utf8");
const mobileStaffPage = readFileSync("src/app/features/staff-os/pages/mobile-staff-dashboard-preview.page.ts", "utf8");
const staffMobileSyncRoutes = readFileSync("server/routes/staff-mobile-sync.routes.js", "utf8");
const staffMobileSyncService = readFileSync("server/services/staff-mobile-sync.service.js", "utf8");
const indexHtml = readFileSync("src/index.html", "utf8");
const manifest = readFileSync("public/manifest.webmanifest", "utf8");
const serviceWorker = readFileSync("public/offline-sw.js", "utf8");

test("Offline backend exposes retry dashboard, device sync status and single item retry", () => {
  assert.match(offlineRoutes, /\/offline\/retry-dashboard/, "Retry dashboard route should exist");
  assert.match(offlineRoutes, /\/offline\/device-sync-status/, "Device sync status route should exist");
  assert.match(offlineRoutes, /\/offline\/sync-items\/:id\/retry/, "Single sync item retry route should exist");
  assert.match(offlineService, /retryDashboard\(query = \{\}, access\)/, "Offline service should compute retry dashboard");
  assert.match(offlineService, /deviceSyncStatus\(query = \{\}, access\)/, "Offline service should compute device sync status");
  assert.match(offlineService, /retrySyncItem\(id, payload = \{\}, access\)/, "Offline service should retry a selected queue item");
  assert.match(offlineService, /offlineFirstPwa/, "Offline service should expose PWA readiness signals");
  assert.match(offlineService, /priorityBilling/, "Retry dashboard should prioritize billing first");
  assert.match(offlineService, /priorityAppointments/, "Retry dashboard should prioritize appointments second");
});

test("Offline pages render retry dashboard, PWA readiness and device sync status", () => {
  for (const path of ["offline", "offline/devices", "offline/sync-queue", "offline/conflicts", "offline/appointments"]) {
    assert.ok(appRoutes.includes(`path: '${path}'`), `${path} route should be wired`);
  }
  assert.match(appComponent, /\/offline\/devices/, "Device status should be reachable from sidebar");
  assert.match(appComponent, /\/offline\/sync-queue/, "Retry queue should be reachable from sidebar");
  assert.match(offlineSupportPage, /Retry dashboard \/ force sync/, "Command center should describe retry dashboard");
  assert.match(syncQueuePage, /offline\/retry-dashboard/, "Sync queue page should load retry dashboard");
  assert.match(syncQueuePage, /offline\/device-sync-status/, "Sync queue page should load device sync status");
  assert.match(syncQueuePage, /offline\/sync-items\/\$\{item\.id\}\/retry/, "Sync queue page should post selected item retry");
  assert.match(deviceHealthPage, /Offline-first PWA/, "Device page should show PWA readiness");
  assert.match(deviceHealthPage, /offline\/device-sync-status/, "Device page should use backend device status");
});

test("Mobile staff view stays connected to offline and staff mobile sync surfaces", () => {
  assert.match(staffMobileSyncRoutes, /\/staff-os\/mobile\/snapshot/, "Staff mobile snapshot endpoint should exist");
  assert.match(staffMobileSyncRoutes, /\/staff-os\/mobile\/sync/, "Staff mobile sync endpoint should exist");
  assert.match(staffMobileSyncRoutes, /\/staff-os\/mobile\/conflicts/, "Staff mobile conflict endpoint should exist");
  assert.match(staffMobileSyncService, /idempotencyKey/, "Staff mobile sync should protect offline retries with idempotency");
  assert.match(staffMobileSyncService, /createConflict/, "Staff mobile sync should create conflicts instead of dropping failed mutations");
  assert.match(mobileStaffPage, /offline\/device-sync-status/, "Mobile staff page should show common device sync status");
  assert.match(mobileStaffPage, /staff-os\/mobile\/conflicts/, "Mobile staff page should show staff mobile conflicts");
  assert.match(mobileStaffPage, /Offline-first PWA/, "Mobile staff page should expose PWA readiness");
});

test("Offline-first PWA assets are registered for mobile install and app shell retry", () => {
  assert.match(indexHtml, /manifest\.webmanifest/, "Index should link the PWA manifest");
  assert.match(indexHtml, /serviceWorker\.register\('\/offline-sw\.js'\)/, "Index should register the offline service worker");
  assert.match(manifest, /"start_url": "\/offline"/, "PWA should open into Offline command center");
  assert.match(manifest, /"display": "standalone"/, "PWA should run as standalone app");
  assert.match(serviceWorker, /CACHE_NAME/, "Service worker should define an app-shell cache");
  assert.match(serviceWorker, /url\.pathname\.startsWith\("\/api"\)/, "Service worker should not stale-cache API writes or reads");
  assert.match(offlineService, /serviceWorker: "\/offline-sw\.js"/, "Backend readiness should expose service-worker status");
  assert.match(offlineService, /manifest: "\/manifest\.webmanifest"/, "Backend readiness should expose manifest status");
});
