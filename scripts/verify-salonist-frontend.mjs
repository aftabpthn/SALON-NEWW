import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import WebSocket from "ws";
import { db } from "../server/db.js";

const frontend = "http://127.0.0.1:4300";
const api = "http://127.0.0.1:4000/api/v1";
const edgePath = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const debugPort = 9333;
const tempRoot = "C:\\Users\\ADMIN\\AppData\\Local\\Temp\\opencode";
const userDataDir = join(tempRoot, `edge-salonist-${Date.now()}`);
const evidenceDir = join(process.cwd(), "docs", "reports", "frontend-visibility");
mkdirSync(userDataDir, { recursive: true });
mkdirSync(evidenceDir, { recursive: true });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const product = db.prepare("SELECT id, name, qrCode FROM products WHERE tenantId=@tenantId AND qrCode<>@empty ORDER BY id LIMIT 1").get({ tenantId: "tenant_salonist", empty: "" });
const membership = db.prepare("SELECT id, planName, soldByStaffName FROM memberships WHERE tenantId=@tenantId AND soldByStaffName<>@empty ORDER BY id LIMIT 1").get({ tenantId: "tenant_salonist", empty: "" });

const loginResponse = await fetch(`${api}/auth/login`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ tenantId: "tenant_salonist", email: "ssense@example.com", password: "ssense#121", branchId: "branch_363bdc6b-2" })
});
const loginBody = await loginResponse.json();
if (!loginResponse.ok || !loginBody.data?.accessToken) throw new Error("Browser verification login failed");
const session = loginBody.data;

const edge = spawn(edgePath, [
  "--headless=new",
  "--disable-gpu",
  "--hide-scrollbars",
  `--remote-debugging-port=${debugPort}`,
  `--user-data-dir=${userDataDir}`,
  "--window-size=1600,1200",
  "about:blank"
], { stdio: "ignore" });

let version;
for (let attempt = 0; attempt < 40; attempt++) {
  try {
    const response = await fetch(`http://127.0.0.1:${debugPort}/json/version`);
    if (response.ok) {
      version = await response.json();
      break;
    }
  } catch {}
  await sleep(250);
}
if (!version) throw new Error("Edge DevTools endpoint did not start");

const targetResponse = await fetch(`http://127.0.0.1:${debugPort}/json/new?${encodeURIComponent(frontend)}`, { method: "PUT" });
const target = await targetResponse.json();
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.once("open", resolve); ws.once("error", reject); });

let commandId = 0;
const pending = new Map();
const browserErrors = [];
ws.on("message", (raw) => {
  const message = JSON.parse(String(raw));
  if (message.id && pending.has(message.id)) {
    const { resolve, reject } = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) reject(new Error(message.error.message)); else resolve(message.result || {});
    return;
  }
  if (message.method === "Runtime.exceptionThrown") browserErrors.push(message.params?.exceptionDetails?.text || "Runtime exception");
  if (message.method === "Log.entryAdded" && ["error", "warning"].includes(message.params?.entry?.level)) browserErrors.push(message.params.entry.text);
});
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++commandId;
  pending.set(id, { resolve, reject });
  ws.send(JSON.stringify({ id, method, params }));
});

await send("Page.enable");
await send("Runtime.enable");
await send("Log.enable");
await send("Network.enable");
await sleep(1500);
await send("Runtime.evaluate", {
  expression: `localStorage.setItem('aura.authSession', ${JSON.stringify(JSON.stringify(session))}); localStorage.setItem('aura.selectedTenantId','tenant_salonist'); localStorage.setItem('aura.userRole','owner'); localStorage.setItem('aura.selectedBranchId','branch_363bdc6b-2'); localStorage.setItem('aura.selectedBranchId.tenant_salonist','branch_363bdc6b-2'); true`,
  returnByValue: true
});

async function bodyText() {
  const response = await send("Runtime.evaluate", { expression: "document.body?.innerText || ''", returnByValue: true });
  return String(response.result?.value || "");
}

async function navigate(check) {
  browserErrors.length = 0;
  await send("Page.navigate", { url: `${frontend}${check.path}` });
  let text = "";
  for (let attempt = 0; attempt < 40; attempt++) {
    await sleep(250);
    text = await bodyText();
    if (check.expected.every((value) => text.toLowerCase().includes(value.toLowerCase()))) break;
  }
  const missing = check.expected.filter((value) => !text.toLowerCase().includes(value.toLowerCase()));
  const screenshot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  writeFileSync(join(evidenceDir, `${check.key}.png`), Buffer.from(screenshot.data, "base64"));
  const currentUrl = (await send("Runtime.evaluate", { expression: "location.pathname + location.search", returnByValue: true })).result?.value || "";
  return {
    key: check.key,
    path: check.path,
    pass: missing.length === 0 && browserErrors.length === 0,
    expected: check.expected,
    missing,
    browserErrors: [...browserErrors],
    currentUrl,
    title: (await send("Runtime.evaluate", { expression: "document.title", returnByValue: true })).result?.value || "",
    textSample: text.slice(0, 500)
  };
}

const checks = [
  { key: "client", path: "/clients/clientrec_0bf234ffb34ee4f6", expected: ["WALIKIN", "Communication consent", "Visits"] },
  { key: "services", path: "/services", expected: ["Services, Add-ons & Packages", "Member price", "376"] },
  { key: "product", path: `/inventory/products/${product.id}`, expected: [product.name, "Legacy issue quantity", "Source QR", "System QR", "Movement rows"] },
  { key: "membership", path: `/memberships/${membership.id}`, expected: [membership.planName, "Sold by", membership.soldByStaffName, "Credits"] },
  { key: "invoices", path: "/pos/invoices?range=all", expected: ["Invoices", "All dates"] },
  { key: "migration-review", path: "/data-migration/validation", expected: ["Validation", "Needs review", "4"] }
];

const results = [];
for (const check of checks) results.push(await navigate(check));

const mobile = await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
void mobile;
await send("Page.navigate", { url: `${frontend}/clients/clientrec_0bf234ffb34ee4f6` });
await sleep(2500);
const mobileMetrics = await send("Runtime.evaluate", {
  expression: "({scrollWidth:document.documentElement.scrollWidth,clientWidth:document.documentElement.clientWidth,bodyText:(document.body?.innerText||'').length})",
  returnByValue: true
});
const mobileScreenshot = await send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
writeFileSync(join(evidenceDir, "mobile-client.png"), Buffer.from(mobileScreenshot.data, "base64"));

const report = {
  generatedAt: new Date().toISOString(),
  passed: results.every((result) => result.pass) && Number(mobileMetrics.result?.value?.scrollWidth || 0) <= Number(mobileMetrics.result?.value?.clientWidth || 0),
  desktop: results,
  mobile: mobileMetrics.result?.value || {},
  evidenceDir
};
writeFileSync(join(evidenceDir, "verification.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));

ws.close();
edge.kill();
process.exitCode = report.passed ? 0 : 1;
