import { Injectable, effect } from "@angular/core";
import { Router } from "@angular/router";
import { Capacitor } from "@capacitor/core";
import { PushNotifications, PushNotificationSchema, ActionPerformed, Token } from "@capacitor/push-notifications";
import { firstValueFrom } from "rxjs";
import { AuthService } from "./auth.service";
import { CustomerApiService } from "./customer-api.service";
import { MarketplaceService } from "./marketplace.service";

@Injectable({ providedIn: "root" })
export class CustomerPushNotificationService {
  private initialization?: Promise<void>;
  private registrationRequested = false;

  constructor(
    private readonly auth: AuthService,
    private readonly api: CustomerApiService,
    private readonly marketplace: MarketplaceService,
    private readonly router: Router
  ) {
    effect(() => {
      const customer = this.auth.customer();
      const canRegister = Boolean(this.auth.accessToken() && customer && !this.auth.biometricLocked());
      const preferences = customer?.notificationPreferences;
      const anyCategoryEnabled = !preferences || Object.values(preferences).some(Boolean);
      if (canRegister && anyCategoryEnabled) void this.registerForPush();
    });
  }

  initialize(): Promise<void> {
    if (!this.isSupported()) return Promise.resolve();
    if (!this.initialization) this.initialization = this.attachListeners();
    return this.initialization;
  }

  private isSupported(): boolean {
    return Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android";
  }

  private async attachListeners(): Promise<void> {
    await PushNotifications.addListener("registration", (token: Token) => void this.saveToken(token.value));
    await PushNotifications.addListener("registrationError", (error) => {
      this.registrationRequested = false;
      console.error("[CustomerPush] Registration failed", error);
    });
    await PushNotifications.addListener("pushNotificationReceived", (_notification: PushNotificationSchema) => {
      if (this.marketplace.isAuthenticated() && this.router.url.startsWith("/notifications")) {
        void this.marketplace.loadAccountModule("notifications").catch(() => undefined);
      }
    });
    await PushNotifications.addListener("pushNotificationActionPerformed", (action: ActionPerformed) => void this.openNotification(action));
    await PushNotifications.createChannel({
      id: "customer_notifications",
      name: "Customer updates",
      description: "Booking, payment, reward, and account updates",
      importance: 4,
      visibility: 1,
      vibration: true
    });
  }

  private async registerForPush(): Promise<void> {
    if (!this.isSupported() || this.registrationRequested) return;
    this.registrationRequested = true;
    try {
      await this.initialize();
      let permission = await PushNotifications.checkPermissions();
      if (permission.receive === "prompt") permission = await PushNotifications.requestPermissions();
      if (permission.receive !== "granted") {
        this.registrationRequested = false;
        return;
      }
      await PushNotifications.register();
    } catch (error) {
      console.error("[CustomerPush] Unable to enable notifications", error);
      this.registrationRequested = false;
    }
  }

  private async saveToken(token: string): Promise<void> {
    if (!token || !this.auth.accessToken() || !this.auth.customer()) return;
    const device = this.auth.deviceInfo();
    await firstValueFrom(this.api.registerPushDevice(device.deviceId, {
      token,
      platform: "android"
    })).catch((error) => console.error("[CustomerPush] Unable to save device token", error));
  }

  private async openNotification(action: ActionPerformed): Promise<void> {
    const data = action.notification.data || {};
    const notificationId = typeof data["notificationId"] === "string" ? data["notificationId"] : "";
    const route = this.safeRoute(typeof data["deepLink"] === "string" ? data["deepLink"] : "");
    if (notificationId && this.auth.accessToken()) {
      void firstValueFrom(this.api.updateNotificationStatus(notificationId, "read")).catch(() => undefined);
    }
    if (route) await this.router.navigateByUrl(route);
  }

  private safeRoute(value: string): string {
    if (!value.startsWith("/") || value.startsWith("//") || /[\\\u0000-\u001f]/.test(value)) return "/notifications";
    return /^(?:\/bookings\/[A-Za-z0-9_-]+(?:\/chat)?|\/tabs\/(?:bookings|wallet|offers|rewards|memberships|profile)|\/notifications)$/.test(value)
      ? value
      : "/notifications";
  }
}
