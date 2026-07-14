const baseUrl = process.env.STAFF_APP_URL || "http://127.0.0.1:4320";
const routes = [
  "/staff/dashboard",
  "/staff/appointments",
  "/staff/business",
  "/staff/queue",
  "/staff/tasks",
  "/staff/calendar",
  "/staff/chat",
  "/staff/learning",
  "/staff/permission-denied",
  "/staff/profile"
];

const headers = {
  "user-agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 AuraStaffSmoke"
};

const results = [];
for (const route of routes) {
  const response = await fetch(`${baseUrl}${route}`, { headers });
  results.push({ route, status: response.status, ok: response.ok });
}

const failed = results.filter((item) => !item.ok);
console.log(JSON.stringify({ ok: failed.length === 0, baseUrl, results }, null, 2));
if (failed.length) process.exit(1);
