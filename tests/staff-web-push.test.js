import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("staff notifications subscribe and deliver through Web Push", () => {
  const client = read("staff-app/src/app/core/staff-push.service.ts");
  const worker = read("staff-app/src/assets/staff-push-sw.js");
  const delivery = read("server/services/staff-web-push.service.js");
  const jobWorker = read("server/workers/job-worker.js");
  const notifications = read("server/services/staff-enterprise.service.js");

  assert.match(client, /Notification\.requestPermission\(\)/);
  assert.match(client, /pushManager\.subscribe/);
  assert.match(worker, /addEventListener\("push"/);
  assert.match(worker, /showNotification/);
  assert.match(delivery, /webpush\.sendNotification/);
  assert.match(jobWorker, /staff_web_push_send: staffWebPushSend/);
  assert.match(notifications, /staffWebPushService\.queueStaffNotification\(row\)/);
});
