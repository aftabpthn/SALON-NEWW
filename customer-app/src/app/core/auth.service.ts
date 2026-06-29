import { Injectable, computed, signal } from "@angular/core";
import { User } from "firebase/auth";
import { firstValueFrom } from "rxjs";
import { AuthSession, CustomerDeviceInfo, CustomerDeviceSession, CustomerProfile, OtpRequestResponse } from "./api.types";
import { SESSION_EXPIRED_EVENT, SESSION_REFRESHED_EVENT } from "./auth.interceptor";
import { CustomerApiService } from "./customer-api.service";
import { FirebaseCustomerAuthService } from "./firebase-customer-auth.service";

const ACCESS_TOKEN_KEY = "auraCustomerAccessToken";
const REFRESH_TOKEN_KEY = "auraCustomerRefreshToken";
const DEVICE_ID_KEY = "auraCustomerDeviceId";
const BIOMETRIC_ENABLED_KEY = "auraCustomerBiometricEnabled";
const BIOMETRIC_CREDENTIAL_KEY = "auraCustomerBiometricCredentialId";

@Injectable({ providedIn: "root" })
export class AuthService {
  readonly loading = signal(false);
  readonly error = signal("");
  readonly customer = signal<CustomerProfile | null>(null);
  readonly otpRequest = signal<OtpRequestResponse | null>(null);
  readonly emailCodeRequest = signal<OtpRequestResponse | null>(null);
  readonly otpPhone = signal("");
  readonly codeEmail = signal("");
  readonly devices = signal<CustomerDeviceSession[]>([]);
  readonly biometricEnabled = signal(this.readFlag(BIOMETRIC_ENABLED_KEY));
  readonly biometricLocked = signal(this.readFlag(BIOMETRIC_ENABLED_KEY) && !!this.readToken(ACCESS_TOKEN_KEY));
  readonly isAuthenticated = computed(() => !!this.accessToken());
  readonly accessToken = signal<string | null>(this.readToken(ACCESS_TOKEN_KEY));
  readonly refreshToken = signal<string | null>(this.readToken(REFRESH_TOKEN_KEY));

  constructor(private readonly api: CustomerApiService, private readonly firebaseAuth: FirebaseCustomerAuthService) {
    this.ensureDeviceId();
    this.listenForSessionEvents();
    if (this.accessToken() && !this.biometricLocked()) void this.loadMe();
  }

  private listenForSessionEvents() {
    if (typeof window === "undefined") return;
    // The HTTP interceptor rotates/expires tokens directly in localStorage (to avoid an
    // HttpClient → AuthService dependency cycle). Mirror those changes into our signals.
    window.addEventListener(SESSION_REFRESHED_EVENT, () => {
      this.accessToken.set(this.readToken(ACCESS_TOKEN_KEY));
      this.refreshToken.set(this.readToken(REFRESH_TOKEN_KEY));
    });
    window.addEventListener(SESSION_EXPIRED_EVENT, () => {
      this.clearSession();
      this.error.set("Your session expired. Please sign in again.");
    });
  }

  firebaseConfigured(): boolean {
    return this.firebaseAuth.isConfigured();
  }

  firebaseProjectId(): string {
    return this.firebaseAuth.projectId();
  }

  profileComplete(profile = this.customer()): boolean {
    if (!profile) return false;
    return Boolean(profile.profileComplete)
      || (!!String(profile.firstName || "").trim()
        && !!String(profile.lastName || "").trim()
        && !!String(profile.email || "").trim()
        && !!String(profile.phone || "").trim()
        && !!String(profile.phoneVerifiedAt || "").trim());
  }

  async signInWithGoogle(): Promise<AuthSession> {
    return this.runFirebaseAuth("Unable to sign in with Google", async () => {
      const user = await this.firebaseAuth.signInWithGoogle();
      return this.exchangeFirebaseUser(user, "google");
    });
  }

  async signInWithApple(): Promise<AuthSession> {
    return this.runFirebaseAuth("Unable to sign in with Apple", async () => {
      const user = await this.firebaseAuth.signInWithApple();
      return this.exchangeFirebaseUser(user, "apple");
    });
  }

  async signInWithFacebook(): Promise<void> {
    this.loading.set(true);
    this.error.set("");
    try {
      await this.firebaseAuth.signInWithFacebook();
    } catch (error) {
      console.error("[AuthService] Unable to sign in with Facebook", error);
      this.error.set(this.firebaseAuth.friendlyMessage(error, "Unable to sign in with Facebook"));
      throw error;
    } finally {
      this.loading.set(false);
    }
  }

  async handleFacebookRedirect(): Promise<AuthSession | null> {
    this.loading.set(true);
    this.error.set("");
    try {
      const user = await this.firebaseAuth.getFacebookRedirectResult();
      if (!user) return null;
      const session = await this.exchangeFirebaseUser(user, "facebook");
      return session;
    } catch (error) {
      console.error("[AuthService] Facebook redirect result error", error);
      this.error.set(this.firebaseAuth.friendlyMessage(error, "Unable to complete Facebook sign-in"));
      throw error;
    } finally {
      this.loading.set(false);
    }
  }

  async signInWithEmail(email: string, password: string): Promise<AuthSession> {
    return this.runFirebaseAuth("Unable to sign in with email", async () => {
      const user = await this.firebaseAuth.signInWithEmail(email.trim(), password);
      return this.exchangeFirebaseUser(user, "password");
    });
  }

  async createWithEmail(email: string, password: string, name = ""): Promise<AuthSession> {
    return this.runFirebaseAuth("Unable to create customer account", async () => {
      let user = await this.firebaseAuth.createWithEmail(email.trim(), password);
      user = await this.firebaseAuth.updateDisplayName(user, name);
      return this.exchangeFirebaseUser(user, "password");
    });
  }

  async requestFirebasePhoneOtp(phone: string, recaptchaContainerId: string): Promise<void> {
    this.loading.set(true);
    this.error.set("");
    try {
      await this.firebaseAuth.sendPhoneOtp(phone.trim(), recaptchaContainerId);
      this.otpPhone.set(phone.trim());
      this.otpRequest.set(null);
    } catch (error) {
      this.error.set(this.firebaseAuth.friendlyMessage(error, "Unable to send OTP"));
      throw error;
    } finally {
      this.loading.set(false);
    }
  }

  async verifyFirebasePhoneOtp(otp: string): Promise<AuthSession> {
    const cleanOtp = otp.trim();
    if (!/^\d{6}$/.test(cleanOtp)) {
      this.error.set("Enter the 6-digit OTP.");
      throw new Error("Enter the 6-digit OTP.");
    }
    return this.runFirebaseAuth("Unable to verify OTP", async () => {
      const user = await this.firebaseAuth.verifyPhoneOtp(cleanOtp);
      return this.exchangeFirebaseUser(user, "phone");
    });
  }

  async requestOtp(phone: string, channel: "sms" | "whatsapp" = "sms"): Promise<OtpRequestResponse> {
    this.loading.set(true);
    this.error.set("");
    try {
      const response = await firstValueFrom(this.api.requestOtp(phone.trim(), channel));
      this.otpRequest.set(response);
      this.otpPhone.set(phone.trim());
      return response;
    } catch (error) {
      this.error.set(this.message(error, "Unable to request OTP"));
      throw error;
    } finally {
      this.loading.set(false);
    }
  }

  async requestEmailCode(email: string): Promise<OtpRequestResponse> {
    this.loading.set(true);
    this.error.set("");
    try {
      const response = await firstValueFrom(this.api.requestEmailCode(email.trim()));
      this.emailCodeRequest.set(response);
      this.codeEmail.set(email.trim());
      return response;
    } catch (error) {
      this.error.set(this.message(error, "Unable to send verification code"));
      throw error;
    } finally {
      this.loading.set(false);
    }
  }

  async verifyEmailCode(email: string, code: string, name = ""): Promise<AuthSession> {
    const cleanCode = code.trim();
    if (!/^\d{6}$/.test(cleanCode)) {
      this.error.set("Enter the 6-digit verification code.");
      throw new Error("Enter the 6-digit verification code.");
    }
    this.loading.set(true);
    this.error.set("");
    try {
      const response = await firstValueFrom(this.api.verifyEmailCode(email.trim(), cleanCode, name.trim(), this.deviceInfo()));
      this.saveSession(response);
      const profile = await this.loadMe();
      return { ...response, customer: profile };
    } catch (error) {
      this.error.set(this.message(error, "Unable to verify email code"));
      throw error;
    } finally {
      this.loading.set(false);
    }
  }

  async verifyOtp(phone: string, otp: string): Promise<AuthSession> {
    const cleanOtp = otp.trim();
    if (!/^\d{6}$/.test(cleanOtp)) {
      this.error.set("Enter the 6-digit OTP.");
      throw new Error("Enter the 6-digit OTP.");
    }
    this.loading.set(true);
    this.error.set("");
    try {
      const response = await firstValueFrom(this.api.verifyOtp(phone.trim(), cleanOtp, this.deviceInfo()));
      this.saveSession(response);
      const profile = await this.loadMe();
      return { ...response, customer: profile };
    } catch (error) {
      this.error.set(this.message(error, "Unable to verify OTP"));
      throw error;
    } finally {
      this.loading.set(false);
    }
  }

  async loadMe(): Promise<CustomerProfile> {
    this.loading.set(true);
    this.error.set("");
    try {
      const profile = await firstValueFrom(this.api.getMe());
      this.customer.set({ ...profile, isLoggedIn: true });
      return this.customer() as CustomerProfile;
    } catch (error) {
      const message = this.message(error, "Unable to load customer profile");
      this.error.set(message);
      throw error;
    } finally {
      this.loading.set(false);
    }
  }

  async updateMe(payload: Partial<CustomerProfile>): Promise<CustomerProfile> {
    this.loading.set(true);
    this.error.set("");
    try {
      const profile = await firstValueFrom(this.api.updateMe(payload));
      this.customer.set({ ...profile, isLoggedIn: true });
      return this.customer() as CustomerProfile;
    } catch (error) {
      this.error.set(this.message(error, "Unable to update customer profile"));
      throw error;
    } finally {
      this.loading.set(false);
    }
  }

  async requestProfileEmailCode(email: string): Promise<OtpRequestResponse> {
    this.loading.set(true);
    this.error.set("");
    try {
      return await firstValueFrom(this.api.requestProfileEmailCode(email.trim()));
    } catch (error) {
      this.error.set(this.message(error, "Unable to send email verification code"));
      throw error;
    } finally {
      this.loading.set(false);
    }
  }

  async verifyProfileEmailCode(email: string, code: string): Promise<CustomerProfile> {
    const cleanCode = code.trim();
    if (!/^\d{6}$/.test(cleanCode)) {
      this.error.set("Enter the 6-digit verification code.");
      throw new Error("Enter the 6-digit verification code.");
    }
    this.loading.set(true);
    this.error.set("");
    try {
      const profile = await firstValueFrom(this.api.verifyProfileEmailCode(email.trim(), cleanCode));
      this.customer.set({ ...profile, isLoggedIn: true });
      return this.customer() as CustomerProfile;
    } catch (error) {
      this.error.set(this.message(error, "Unable to verify email code"));
      throw error;
    } finally {
      this.loading.set(false);
    }
  }

  async requestProfilePhoneOtp(phone: string, channel: "sms" | "whatsapp" = "sms"): Promise<OtpRequestResponse> {
    this.loading.set(true);
    this.error.set("");
    try {
      return await firstValueFrom(this.api.requestProfilePhoneOtp(phone.trim(), channel));
    } catch (error) {
      this.error.set(this.message(error, "Unable to send mobile OTP"));
      throw error;
    } finally {
      this.loading.set(false);
    }
  }

  async verifyProfilePhoneOtp(phone: string, otp: string): Promise<CustomerProfile> {
    const cleanOtp = otp.trim();
    if (!/^\d{6}$/.test(cleanOtp)) {
      this.error.set("Enter the 6-digit OTP.");
      throw new Error("Enter the 6-digit OTP.");
    }
    this.loading.set(true);
    this.error.set("");
    try {
      const profile = await firstValueFrom(this.api.verifyProfilePhoneOtp(phone.trim(), cleanOtp));
      this.customer.set({ ...profile, isLoggedIn: true });
      return this.customer() as CustomerProfile;
    } catch (error) {
      this.error.set(this.message(error, "Unable to verify mobile OTP"));
      throw error;
    } finally {
      this.loading.set(false);
    }
  }

  async changePassword(currentPassword: string, newPassword: string): Promise<void> {
    this.loading.set(true);
    this.error.set("");
    try {
      await this.firebaseAuth.changePassword(currentPassword, newPassword);
    } catch (error) {
      this.error.set(this.firebaseAuth.friendlyMessage(error, "Unable to change password"));
      throw error;
    } finally {
      this.loading.set(false);
    }
  }

  async changePasswordWithPhoneOtp(phone: string, otp: string, newPassword: string): Promise<void> {
    const cleanOtp = otp.trim();
    if (!/^\d{6}$/.test(cleanOtp)) {
      this.error.set("Enter the 6-digit OTP.");
      throw new Error("Enter the 6-digit OTP.");
    }
    this.loading.set(true);
    this.error.set("");
    try {
      const profile = await firstValueFrom(this.api.verifyProfilePhoneOtp(phone.trim(), cleanOtp));
      this.customer.set({ ...profile, isLoggedIn: true });
      await this.firebaseAuth.updatePasswordAfterVerification(newPassword);
    } catch (error) {
      this.error.set(this.firebaseAuth.friendlyMessage(error, this.message(error, "Unable to change password with mobile OTP")));
      throw error;
    } finally {
      this.loading.set(false);
    }
  }

  async sendPasswordReset(email: string): Promise<void> {
    this.loading.set(true);
    this.error.set("");
    try {
      await this.firebaseAuth.sendPasswordReset(email);
    } catch (error) {
      this.error.set(this.firebaseAuth.friendlyMessage(error, "Unable to send password reset email"));
      throw error;
    } finally {
      this.loading.set(false);
    }
  }

  async deleteAccount(currentPassword = ""): Promise<void> {
    this.loading.set(true);
    this.error.set("");
    try {
      if (this.firebaseConfigured()) await this.firebaseAuth.deleteCurrentUser(currentPassword);
      await firstValueFrom(this.api.deleteMe());
      this.clearSession();
    } catch (error) {
      this.error.set(this.firebaseAuth.friendlyMessage(error, this.message(error, "Unable to delete account")));
      throw error;
    } finally {
      this.loading.set(false);
    }
  }

  async logout(): Promise<void> {
    this.loading.set(true);
    this.error.set("");
    try {
      await firstValueFrom(this.api.logout());
      await this.firebaseAuth.logout();
    } catch (error) {
      this.error.set(this.message(error, "Unable to logout from server"));
      throw error;
    } finally {
      this.clearSession();
      this.loading.set(false);
    }
  }

  getAccessToken(): string | null {
    return this.readToken(ACCESS_TOKEN_KEY) || this.accessToken();
  }

  getRefreshToken(): string | null {
    return this.refreshToken();
  }

  async refreshSession(): Promise<AuthSession> {
    const refreshToken = this.readToken(REFRESH_TOKEN_KEY) || this.refreshToken();
    if (!refreshToken) throw new Error("Your session expired. Please sign in again.");
    const session = await firstValueFrom(this.api.refreshCustomerSession(refreshToken, this.deviceInfo()));
    this.saveSession(session);
    return session;
  }

  clearExpiredSession() {
    this.error.set("We could not refresh this secure session. Please try again.");
  }

  biometricSupported(): boolean {
    return this.firebaseAuth.biometricSupported();
  }

  async setBiometricEnabled(enabled: boolean): Promise<void> {
    this.error.set("");
    if (!enabled) {
      localStorage.removeItem(BIOMETRIC_ENABLED_KEY);
      localStorage.removeItem(BIOMETRIC_CREDENTIAL_KEY);
      this.biometricEnabled.set(false);
      this.biometricLocked.set(false);
      return;
    }
    if (!this.biometricSupported()) {
      this.error.set("Biometric login is not supported on this device.");
      throw new Error("Biometric login is not supported on this device.");
    }
    await this.registerBiometricCredential();
    localStorage.setItem(BIOMETRIC_ENABLED_KEY, "true");
    this.biometricEnabled.set(true);
    this.biometricLocked.set(false);
  }

  async verifyBiometricUnlock(): Promise<void> {
    if (!this.biometricEnabled()) {
      this.biometricLocked.set(false);
      return;
    }
    const credentialId = this.readToken(BIOMETRIC_CREDENTIAL_KEY);
    if (!credentialId || !this.biometricSupported()) {
      this.biometricLocked.set(false);
      this.biometricEnabled.set(false);
      localStorage.removeItem(BIOMETRIC_ENABLED_KEY);
      return;
    }
    this.loading.set(true);
    this.error.set("");
    try {
      await navigator.credentials.get({
        publicKey: {
          challenge: this.randomChallenge(),
          timeout: 60000,
          userVerification: "required",
          allowCredentials: [{
            id: this.base64UrlToArrayBuffer(credentialId),
            type: "public-key",
            transports: ["internal"]
          }]
        }
      });
      this.biometricLocked.set(false);
      if (!this.customer()) await this.loadMe();
    } catch (error) {
      this.error.set("Biometric verification was cancelled or failed.");
      throw error;
    } finally {
      this.loading.set(false);
    }
  }

  async loadDevices(): Promise<CustomerDeviceSession[]> {
    this.loading.set(true);
    this.error.set("");
    try {
      const rows = await firstValueFrom(this.api.listDevices());
      this.devices.set(rows);
      return rows;
    } catch (error) {
      this.error.set(this.message(error, "Unable to load active devices"));
      throw error;
    } finally {
      this.loading.set(false);
    }
  }

  async logoutDevice(sessionId: string): Promise<void> {
    this.loading.set(true);
    this.error.set("");
    try {
      await firstValueFrom(this.api.logoutDevice(sessionId));
      this.devices.update((rows) => rows.filter((row) => row.id !== sessionId));
    } catch (error) {
      this.error.set(this.message(error, "Unable to logout this device"));
      throw error;
    } finally {
      this.loading.set(false);
    }
  }

  async logoutAllDevices(): Promise<void> {
    this.loading.set(true);
    this.error.set("");
    try {
      await firstValueFrom(this.api.logoutAllDevices());
      await this.firebaseAuth.logout();
    } catch (error) {
      this.error.set(this.message(error, "Unable to logout all devices"));
      throw error;
    } finally {
      this.clearSession();
      this.loading.set(false);
    }
  }

  deviceInfo(): CustomerDeviceInfo {
    const userAgent = typeof navigator === "undefined" ? "" : navigator.userAgent;
    const platform = typeof navigator === "undefined" ? "web" : navigator.platform || "web";
    return {
      deviceId: this.ensureDeviceId(),
      deviceName: this.deviceName(platform, userAgent),
      platform,
      userAgent
    };
  }

  private saveSession(session: AuthSession) {
    localStorage.setItem(ACCESS_TOKEN_KEY, session.accessToken);
    if (session.refreshToken) localStorage.setItem(REFRESH_TOKEN_KEY, session.refreshToken);
    this.accessToken.set(session.accessToken);
    if (session.refreshToken) this.refreshToken.set(session.refreshToken);
    this.customer.set({ ...session.customer, isLoggedIn: true });
    this.biometricLocked.set(false);
  }

  private async exchangeFirebaseUser(user: User, provider: "google" | "apple" | "facebook" | "phone" | "password"): Promise<AuthSession> {
    const idToken = await this.firebaseAuth.idTokenFor(user);
    const response = await firstValueFrom(this.api.exchangeFirebaseToken({ idToken, provider, device: this.deviceInfo() }));
    this.saveSession(response);
    const profile = await this.loadMe();
    return { ...response, customer: profile };
  }

  private async runFirebaseAuth(fallback: string, action: () => Promise<AuthSession>): Promise<AuthSession> {
    this.loading.set(true);
    this.error.set("");
    try {
      return await action();
    } catch (error) {
      console.error(`[AuthService] ${fallback}`, error);
      this.error.set(this.firebaseAuth.friendlyMessage(error, fallback));
      throw error;
    } finally {
      this.loading.set(false);
    }
  }

  private clearSession() {
    localStorage.removeItem(ACCESS_TOKEN_KEY);
    localStorage.removeItem(REFRESH_TOKEN_KEY);
    this.accessToken.set(null);
    this.refreshToken.set(null);
    this.customer.set(null);
    this.otpRequest.set(null);
    this.emailCodeRequest.set(null);
    this.otpPhone.set("");
    this.codeEmail.set("");
    this.devices.set([]);
    this.biometricLocked.set(false);
  }

  private readToken(key: string): string | null {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  }

  private readFlag(key: string): boolean {
    try {
      return localStorage.getItem(key) === "true";
    } catch {
      return false;
    }
  }

  private ensureDeviceId(): string {
    const existing = this.readToken(DEVICE_ID_KEY);
    if (existing) return existing;
    const id = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `device-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    localStorage.setItem(DEVICE_ID_KEY, id);
    return id;
  }

  private deviceName(platform: string, userAgent: string): string {
    if (/iphone|ipad/i.test(userAgent)) return "iOS device";
    if (/android/i.test(userAgent)) return "Android device";
    if (/windows/i.test(userAgent)) return "Windows browser";
    if (/mac/i.test(platform)) return "Mac browser";
    return "Web browser";
  }

  private async registerBiometricCredential(): Promise<void> {
    const profile = this.customer();
    const credential = await navigator.credentials.create({
      publicKey: {
        challenge: this.randomChallenge(),
        rp: { name: "Aura Shine" },
        user: {
          id: new TextEncoder().encode(profile?.id || this.ensureDeviceId()),
          name: profile?.email || profile?.phone || "Aura customer",
          displayName: profile?.name || "Aura customer"
        },
        pubKeyCredParams: [{ type: "public-key", alg: -7 }, { type: "public-key", alg: -257 }],
        timeout: 60000,
        authenticatorSelection: {
          authenticatorAttachment: "platform",
          residentKey: "preferred",
          userVerification: "required"
        },
        attestation: "none"
      }
    }) as PublicKeyCredential | null;
    if (!credential) throw new Error("Biometric setup was cancelled.");
    localStorage.setItem(BIOMETRIC_CREDENTIAL_KEY, this.arrayBufferToBase64Url(credential.rawId));
  }

  private randomChallenge(): Uint8Array {
    const challenge = new Uint8Array(32);
    crypto.getRandomValues(challenge);
    return challenge;
  }

  private arrayBufferToBase64Url(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let value = "";
    bytes.forEach((byte) => value += String.fromCharCode(byte));
    return btoa(value).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  private base64UrlToArrayBuffer(value: string): ArrayBuffer {
    const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes.buffer;
  }

  private message(error: unknown, fallback: string): string {
    const candidate = error as {
      message?: unknown;
      error?: {
        message?: unknown;
        error?: string | { message?: unknown };
      };
    };
    const apiError = candidate?.error?.error;
    if (typeof apiError === "string") return apiError;
    if (apiError && typeof apiError === "object" && "message" in apiError) return String(apiError.message || fallback);
    if (candidate?.error?.message) return String(candidate.error.message);
    if (error instanceof Error) {
      return error.message.startsWith("Http failure response") || error.message.includes("Unknown Error") ? fallback : error.message || fallback;
    }
    if (typeof error === "object" && error && "message" in error) return String((error as { message?: unknown }).message || fallback);
    return fallback;
  }
}
