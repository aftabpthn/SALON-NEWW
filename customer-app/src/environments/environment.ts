const runtime = globalThis as typeof globalThis & { AURA_CUSTOMER_API_BASE_URL?: string };

export const environment = {
  production: false,
  apiBaseUrl: runtime.AURA_CUSTOMER_API_BASE_URL?.trim() || "/api/v1",
  businessAppUrl: "http://127.0.0.1:4200/login",
  staffAppUrl: "http://127.0.0.1:4320/staff/login",
  firebase: {
    apiKey: "AIzaSyAFQDxE69U0eprOuJSxd28Q3E6rGMAiAM0",
    authDomain: "aurashineclient.firebaseapp.com",
    projectId: "aurashineclient",
    appId: "1:47194589898:web:4e68ee343a54034e790233",
    messagingSenderId: "47194589898",
    storageBucket: "aurashineclient.firebasestorage.app",
    measurementId: "G-K24F301NRL"
  }
};
