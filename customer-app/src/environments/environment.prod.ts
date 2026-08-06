const runtime = globalThis as typeof globalThis & { AURA_CUSTOMER_API_BASE_URL?: string };

export const environment = {
  production: true,
  apiBaseUrl: runtime.AURA_CUSTOMER_API_BASE_URL?.trim() || "/api/v1",
  businessAppUrl: "/login",
  staffAppUrl: "/staff/login",
  firebase: {
    apiKey: "",
    authDomain: "",
    projectId: "",
    appId: "",
    messagingSenderId: "",
    storageBucket: "",
    measurementId: ""
  }
};
