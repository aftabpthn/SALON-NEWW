import { Injectable } from "@angular/core";
import { Capacitor, registerPlugin } from "@capacitor/core";

export type AttendanceInstallationIdentity = {
  installationId: string;
  publicKeySpkiBase64: string;
  algorithm: string;
  biometricLabel?: string;
  hardwareBacked: boolean;
  verificationCapability: "biometric_or_device_credential";
  attestationStatus: "unverified" | "verified";
};

export type NativeAttendanceLocation = {
  locationReceipt: string;
  latitude: number;
  longitude: number;
  accuracyMeters: number;
  capturedAt: string;
  mockLocation: boolean;
  integrityVerdict?: string;
};

export type AttendanceUserVerification = {
  signatureBase64: string;
  algorithm: string;
  userVerified: boolean;
  verifiedAt: string;
};

type AttendanceBiometricPlugin = {
  getInstallationIdentity(): Promise<AttendanceInstallationIdentity>;
  capturePreciseLocation(options: { maxAccuracyMeters: number; timeoutMs: number }): Promise<NativeAttendanceLocation>;
  verifyUserAndSign(options: { signingPayloadBase64: string; locationReceipt: string; reason: string }): Promise<AttendanceUserVerification>;
};

const AttendanceBiometric = registerPlugin<AttendanceBiometricPlugin>("AttendanceBiometric");

@Injectable({ providedIn: "root" })
export class AttendanceBiometricService {
  isSupportedPlatform(): boolean { return Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android"; }

  unsupportedMessage(): string {
    return "Secure attendance is available only in the Android Aura Staff app. This punch was not recorded or queued.";
  }

  installationIdentity(): Promise<AttendanceInstallationIdentity> {
    this.assertSupported();
    return AttendanceBiometric.getInstallationIdentity();
  }

  preciseLocation(maxAccuracyMeters: number): Promise<NativeAttendanceLocation> {
    this.assertSupported();
    return AttendanceBiometric.capturePreciseLocation({ maxAccuracyMeters, timeoutMs: 20_000 });
  }

  verifyUserAndSign(signingPayloadBase64: string, locationReceipt: string, reason: string): Promise<AttendanceUserVerification> {
    this.assertSupported();
    return AttendanceBiometric.verifyUserAndSign({ signingPayloadBase64, locationReceipt, reason });
  }

  private assertSupported(): void {
    if (!this.isSupportedPlatform()) throw new Error(this.unsupportedMessage());
  }
}
