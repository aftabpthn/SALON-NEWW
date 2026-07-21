const runtime = globalThis as typeof globalThis & { AURA_STAFF_API_BASE_URL?: string };

export const environment = {
  production: false,
  apiBaseUrl: runtime.AURA_STAFF_API_BASE_URL?.trim() || "/api/v1",
  customerAppUrl: "http://127.0.0.1:4310/"
};
