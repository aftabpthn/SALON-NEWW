import { Injectable } from "@angular/core";
import { Capacitor, registerPlugin } from "@capacitor/core";

type AttendanceBiometricPlugin = {
  getPublicKey(): Promise<{ publicKeySpkiBase64: string; biometricLabel?: string; hardwareBacked?: boolean }>;
  signNonce(options: { nonceBase64: string }): Promise<{ signatureBase64: string; biometricLabel?: string }>;
};

const AttendanceBiometric = registerPlugin<AttendanceBiometricPlugin>("AttendanceBiometric");
const DEVICE_ID_KEY = "auraStaffAttendanceDeviceId";

export type AttendanceLocation = {
  latitude: number;
  longitude: number;
  accuracyMeters: number;
  capturedAt: string;
};

@Injectable({ providedIn: "root" })
export class AttendanceBiometricService {
  isSupportedPlatform(): boolean { return Capacitor.getPlatform() === "android"; }

  deviceId(): string {
    try {
      const existing = localStorage.getItem(DEVICE_ID_KEY);
      if (existing) return existing;
      const created = crypto.randomUUID();
      localStorage.setItem(DEVICE_ID_KEY, created);
      return created;
    } catch {
      throw new Error("Secure attendance needs local storage to identify this app installation.");
    }
  }

  deviceLabel(): string {
    const platform = Capacitor.getPlatform();
    return `${platform === "android" ? "Android" : "Unsupported"} staff app`;
  }

  async publicKey() { return AttendanceBiometric.getPublicKey(); }
  async signNonce(nonceBase64: string) { return AttendanceBiometric.signNonce({ nonceBase64 }); }

  location(maxAccuracyMeters?: number): Promise<AttendanceLocation> {
    if (!navigator.geolocation) return Promise.reject(new Error("Location is unavailable on this device."));
    return new Promise((resolve, reject) => navigator.geolocation.getCurrentPosition(
      (position) => {
        const ageMs = Date.now() - position.timestamp;
        if (ageMs > 30_000) { reject(new Error("Location is stale. Please try again with location enabled.")); return; }
        if (!Number.isFinite(position.coords.accuracy)) { reject(new Error("Location accuracy is unavailable.")); return; }
        if (maxAccuracyMeters && position.coords.accuracy > maxAccuracyMeters) {
          reject(new Error(`Location accuracy is ${Math.round(position.coords.accuracy)} m; ${Math.round(maxAccuracyMeters)} m or better is required.`));
          return;
        }
        resolve({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracyMeters: position.coords.accuracy,
          capturedAt: new Date(position.timestamp).toISOString()
        });
      },
      (error) => reject(new Error(error.code === error.PERMISSION_DENIED
        ? "Location permission was denied. Allow precise location to record attendance."
        : "Current location is unavailable. Move to an open area and try again.")),
      { enableHighAccuracy: true, maximumAge: 0, timeout: 15_000 }
    ));
  }
}
