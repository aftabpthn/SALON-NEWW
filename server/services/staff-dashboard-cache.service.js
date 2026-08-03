import { createHash } from "node:crypto";

const TTL_MS = Number(process.env.STAFF_DASHBOARD_CACHE_TTL_MS || 10_000);
const MAX_ENTRIES = 2000;
const cache = new Map();

function scopeOf(access = {}) {
  return [access.tenantId, access.branchId, access.staffId, access.userId, access.role]
    .map((value) => String(value ?? ""))
    .join("|");
}

function keyOf(query = {}, access = {}) {
  const scope = scopeOf(access);
  const hash = createHash("sha1").update(JSON.stringify(query || {})).digest("hex");
  return `${scope}|${hash}`;
}

export function cachedStaffDashboard(query, access, compute) {
  const key = keyOf(query, access);
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && now < hit.expiresAt) return hit.value;
  const value = compute(query, access);
  cache.set(key, { value, expiresAt: now + TTL_MS });
  if (cache.size > MAX_ENTRIES) {
    const entries = [...cache.entries()].sort((a, b) => a[1].expiresAt - b[1].expiresAt);
    for (let index = 0; index < entries.length - Math.floor(MAX_ENTRIES / 2); index += 1) {
      cache.delete(entries[index][0]);
    }
  }
  return value;
}

export function invalidateStaffDashboardCache(access) {
  if (!access) {
    cache.clear();
    return;
  }
  const scope = scopeOf(access);
  for (const key of [...cache.keys()]) {
    if (key.startsWith(`${scope}|`)) cache.delete(key);
  }
}
