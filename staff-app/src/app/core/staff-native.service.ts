import { Injectable } from "@angular/core";
import { Router } from "@angular/router";
import { Capacitor } from "@capacitor/core";
import { StaffAppService } from "./staff-app.service";

export type StaffNativePermission = "camera" | "gps" | "microphone" | "nfc" | "push";

@Injectable({ providedIn: "root" })
export class StaffNativeService {
  private initialized = false;
  private readonly reportedCrashes = new Set<string>();

  constructor(private readonly router: Router, private readonly staff: StaffAppService) {}

  isNative(): boolean { return Capacitor.isNativePlatform(); }

  platform(): "web" | "android" | "ios" {
    const platform = Capacitor.getPlatform();
    return platform === "android" || platform === "ios" ? platform : "web";
  }

  async initialize(): Promise<void> {
    if (!this.isNative() || this.initialized) return;
    this.initialized = true;
    window.addEventListener("error", (event) => void this.reportCrash(event.error instanceof Error ? event.error.name : "Error", event.message));
    window.addEventListener("unhandledrejection", (event) => {
      const reason = event.reason;
      void this.reportCrash(reason instanceof Error ? reason.name : "UnhandledRejection", reason instanceof Error ? reason.message : String(reason));
    });
    const [{ App }, { Network }, { PushNotifications }] = await Promise.all([
      import("@capacitor/app"),
      import("@capacitor/network"),
      import("@capacitor/push-notifications")
    ]);
    await App.addListener("appUrlOpen", ({ url }) => void this.openDeepLink(url));
    await App.addListener("appStateChange", ({ isActive }) => {
      if (isActive) window.dispatchEvent(new CustomEvent("aura:app-resume"));
    });
    await Network.addListener("networkStatusChange", ({ connected }) => window.dispatchEvent(new Event(connected ? "online" : "offline")));
    await PushNotifications.addListener("pushNotificationReceived", () => window.dispatchEvent(new CustomEvent("aura:notifications-updated")));
    await PushNotifications.addListener("pushNotificationActionPerformed", ({ notification }) => {
      const target = String(notification.data?.["url"] || notification.data?.["deepLink"] || "/staff/notifications");
      void this.openDeepLink(target);
    });
  }

  async permissionStates(): Promise<Record<StaffNativePermission, string>> {
    if (!this.isNative()) return {
      camera: await this.webPermission("camera"),
      gps: await this.webPermission("geolocation"),
      microphone: await this.webPermission("microphone"),
      nfc: "NDEFReader" in globalThis ? "available" : "unavailable",
      push: typeof Notification === "undefined" ? "unavailable" : Notification.permission
    };
    const [{ Camera }, { Geolocation }, { PushNotifications }] = await Promise.all([
      import("@capacitor/camera"),
      import("@capacitor/geolocation"),
      import("@capacitor/push-notifications")
    ]);
    const [camera, gps, push] = await Promise.all([Camera.checkPermissions(), Geolocation.checkPermissions(), PushNotifications.checkPermissions()]);
    return {
      camera: camera.camera,
      gps: gps.location,
      microphone: await this.webPermission("microphone"),
      nfc: this.platform() === "android" ? "available when device supports NFC" : "online-only",
      push: push.receive
    };
  }

  async requestPermission(permission: StaffNativePermission): Promise<void> {
    if (permission === "camera") { const { Camera } = await import("@capacitor/camera"); await Camera.requestPermissions({ permissions: ["camera", "photos"] }); return; }
    if (permission === "gps") { const { Geolocation } = await import("@capacitor/geolocation"); await Geolocation.requestPermissions({ permissions: ["location"] }); return; }
    if (permission === "push") { await this.enableNativePush(); return; }
    if (permission === "microphone") {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((track) => track.stop());
      return;
    }
    if (!("NDEFReader" in globalThis)) throw new Error("NFC is not supported on this device.");
    throw new Error("NFC permission is requested only when an approved NFC workflow starts.");
  }

  async nativePushStatus(): Promise<string> {
    if (!this.isNative()) return "unsupported";
    const { PushNotifications } = await import("@capacitor/push-notifications");
    return (await PushNotifications.checkPermissions()).receive;
  }

  async enableNativePush(): Promise<void> {
    if (!this.isNative()) throw new Error("Native push is available only in the installed Android or iOS app.");
    const { PushNotifications } = await import("@capacitor/push-notifications");
    let permission = await PushNotifications.checkPermissions();
    if (permission.receive === "prompt" || permission.receive === "prompt-with-rationale") permission = await PushNotifications.requestPermissions();
    if (permission.receive !== "granted") throw new Error("Push notification permission was not granted.");
    if (this.platform() === "android") await PushNotifications.createChannel({ id: "staff-operations", name: "Staff operations", description: "Appointments, schedule, chat and attendance alerts", importance: 4, visibility: 0 });
    const token = await new Promise<string>(async (resolve, reject) => {
      const timer = window.setTimeout(() => reject(new Error("Native push registration timed out.")), 20_000);
      const success = await PushNotifications.addListener("registration", ({ value }) => { window.clearTimeout(timer); void success.remove(); void failure.remove(); resolve(value); });
      const failure = await PushNotifications.addListener("registrationError", ({ error }) => { window.clearTimeout(timer); void success.remove(); void failure.remove(); reject(new Error(error)); });
      await PushNotifications.register();
    });
    const platform = this.platform();
    const provider = platform === "android" ? "fcm" : "apns";
    const device = await this.staff.registerPushDevice(this.staff.deviceId(), platform, provider);
    await this.staff.registerPushSubscription({
      deviceId: device.id,
      endpoint: "",
      pushToken: token,
      platform,
      provider,
      authSecret: "",
      p256dh: "",
      metadata: { native: true, appVersion: "0.1.0" }
    });
  }

  private async openDeepLink(raw: string): Promise<void> {
    let path = raw;
    try { path = new URL(raw, "https://staff.aurashine.invalid").pathname; } catch { path = "/staff/notifications"; }
    if (!path.startsWith("/staff/")) path = "/staff/notifications";
    await this.router.navigateByUrl(path);
  }

  private async reportCrash(errorType: string, rawMessage: string): Promise<void> {
    if (!this.staff.isAuthenticated()) return;
    const message = rawMessage.replace(/[\r\n]+/g, " ").slice(0, 500) || "Unknown client error";
    const seed = `${errorType}|${message}|${location.pathname}`;
    let hash = 2166136261;
    for (let index = 0; index < seed.length; index += 1) hash = Math.imul(hash ^ seed.charCodeAt(index), 16777619);
    const fingerprint = (hash >>> 0).toString(16);
    if (this.reportedCrashes.has(fingerprint)) return;
    this.reportedCrashes.add(fingerprint);
    await this.staff.reportMobileCrash({
      deviceId: this.staff.deviceId(),
      platform: this.platform(),
      appVersion: "0.1.0",
      errorType: errorType.slice(0, 100),
      message,
      sourcePath: location.pathname.slice(0, 300),
      fingerprint,
      occurredAt: new Date().toISOString()
    }).catch(() => undefined);
  }

  private async webPermission(name: PermissionName): Promise<string> {
    try { return (await navigator.permissions.query({ name })).state; } catch { return "unavailable"; }
  }
}
