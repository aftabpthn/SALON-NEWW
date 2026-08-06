import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.aura.customer",
  appName: "Aura Booking",
  webDir: "www/browser",
  server: {
    androidScheme: "https"
  },
  plugins: {
    SplashScreen: {
      launchAutoHide: false,
      launchShowDuration: 0,
      showSpinner: true,
      spinnerColor: "#4B1238",
      backgroundColor: "#FAF7F2",
      androidSplashResourceName: "splash",
      androidScaleType: "CENTER_INSIDE"
    },
    PushNotifications: {
      presentationOptions: ["badge", "sound", "alert"]
    }
  }
};

export default config;
