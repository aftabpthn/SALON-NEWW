import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.aura.staff",
  appName: "Aura Staff OS",
  webDir: "www/browser",
  bundledWebRuntime: false,
  server: {
    androidScheme: "https"
  }
};

export default config;
