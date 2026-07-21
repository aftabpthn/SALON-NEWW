const runtime = globalThis as typeof globalThis & { AURA_STAFF_API_BASE_URL?: string };

export const environment = {
  production: true,
  apiBaseUrl: runtime.AURA_STAFF_API_BASE_URL?.trim() || "/api/v1",
  customerAppUrl: "/"
};
