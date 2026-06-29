import { Injectable } from "@angular/core";
import type { FirebaseApp, FirebaseOptions } from "firebase/app";
import type { Auth, ConfirmationResult, RecaptchaVerifier, User } from "firebase/auth";
import { environment } from "../../environments/environment";

const EXPECTED_FIREBASE_PROJECT_ID = "aurashineclient";
export const APPLE_LOGIN_ENABLED = false;

declare global {
  interface Window {
    AURA_CUSTOMER_FIREBASE_CONFIG?: Partial<FirebaseOptions>;
  }
}

@Injectable({ providedIn: "root" })
export class FirebaseCustomerAuthService {
  private app: FirebaseApp | null = null;
  private auth: Auth | null = null;
  private recaptcha: RecaptchaVerifier | null = null;
  private recaptchaHostId = "";
  private confirmation: ConfirmationResult | null = null;

  isConfigured(): boolean {
    const config = this.firebaseConfig();
    return Boolean(config.apiKey && config.authDomain && config.projectId && config.appId);
  }

  projectId(): string {
    return String(this.app?.options?.projectId || this.firebaseConfig().projectId || "");
  }

  appId(): string {
    return String(this.app?.options?.appId || this.firebaseConfig().appId || "");
  }

  authDomain(): string {
    return String(this.app?.options?.authDomain || this.firebaseConfig().authDomain || "");
  }

  async signInWithGoogle(): Promise<User> {
    const auth = await this.requireAuth();
    const { GoogleAuthProvider, signInWithPopup } = await import("firebase/auth");
    const result = await signInWithPopup(auth, new GoogleAuthProvider());
    return result.user;
  }

  async signInWithApple(): Promise<User> {
    if (!APPLE_LOGIN_ENABLED) throw new Error("Apple Sign-In is temporarily disabled.");
    const auth = await this.requireAuth();
    const { OAuthProvider, signInWithPopup } = await import("firebase/auth");
    const provider = new OAuthProvider("apple.com");
    provider.addScope("email");
    provider.addScope("name");
    await this.assertProviderEnabled("apple.com");
    const result = await signInWithPopup(auth, provider);
    return result.user;
  }

  async signInWithFacebook(): Promise<void> {
    const auth = await this.requireAuth();
    const { FacebookAuthProvider, signInWithRedirect } = await import("firebase/auth");
    const provider = new FacebookAuthProvider();
    provider.addScope("email");
    provider.addScope("public_profile");
    console.log("[FacebookAuth] Redirecting to Facebook OAuth...", { authDomain: this.authDomain(), projectId: this.projectId() });
    try {
      await signInWithRedirect(auth, provider);
      console.log("[FacebookAuth] Redirect initiated");
    } catch (error) {
      console.error("[FacebookAuth] signInWithRedirect failed", error);
      throw error;
    }
  }

  async getFacebookRedirectResult(): Promise<User | null> {
    const auth = await this.requireAuth();
    const { getRedirectResult } = await import("firebase/auth");
    console.log("[FacebookAuth] Checking redirect result...");
    try {
      const result = await getRedirectResult(auth);
      if (result?.user) {
        console.log("[FacebookAuth] Redirect result found", { uid: result.user.uid, email: result.user.email });
        return result.user;
      }
      console.log("[FacebookAuth] No redirect result");
      return null;
    } catch (error) {
      console.error("[FacebookAuth] getRedirectResult failed", error);
      throw error;
    }
  }

  async signInWithEmail(email: string, password: string): Promise<User> {
    const auth = await this.requireAuth();
    const { signInWithEmailAndPassword } = await import("firebase/auth");
    return (await signInWithEmailAndPassword(auth, email, password)).user;
  }

  async createWithEmail(email: string, password: string): Promise<User> {
    const auth = await this.requireAuth();
    const { createUserWithEmailAndPassword } = await import("firebase/auth");
    return (await createUserWithEmailAndPassword(auth, email, password)).user;
  }

  async updateDisplayName(user: User, name: string): Promise<User> {
    const { updateProfile } = await import("firebase/auth");
    if (name.trim()) await updateProfile(user, { displayName: name.trim() });
    return user;
  }

  async changePassword(currentPassword: string, newPassword: string): Promise<void> {
    const auth = await this.requireAuth();
    if (!auth.currentUser?.email) throw new Error("Password changes are available for email accounts only.");
    const { EmailAuthProvider, reauthenticateWithCredential, updatePassword } = await import("firebase/auth");
    const credential = EmailAuthProvider.credential(auth.currentUser.email, currentPassword);
    await reauthenticateWithCredential(auth.currentUser, credential);
    await updatePassword(auth.currentUser, newPassword);
  }

  async updatePasswordAfterVerification(newPassword: string): Promise<void> {
    const auth = await this.requireAuth();
    if (!auth.currentUser?.email) throw new Error("Password changes are available for email accounts only.");
    const { updatePassword } = await import("firebase/auth");
    await updatePassword(auth.currentUser, newPassword);
  }

  async sendPasswordReset(email: string): Promise<void> {
    const auth = await this.requireAuth();
    const { sendPasswordResetEmail } = await import("firebase/auth");
    await sendPasswordResetEmail(auth, email.trim());
  }

  async deleteCurrentUser(currentPassword = ""): Promise<void> {
    const auth = await this.requireAuth();
    if (!auth.currentUser) return;
    if (auth.currentUser.email && currentPassword) {
      const { EmailAuthProvider, reauthenticateWithCredential } = await import("firebase/auth");
      const credential = EmailAuthProvider.credential(auth.currentUser.email, currentPassword);
      await reauthenticateWithCredential(auth.currentUser, credential);
    }
    const { deleteUser } = await import("firebase/auth");
    await deleteUser(auth.currentUser);
  }

  hasEmailPasswordUser(): boolean {
    return Boolean(this.auth?.currentUser?.email);
  }

  biometricSupported(): boolean {
    return typeof window !== "undefined" && Boolean(window.PublicKeyCredential);
  }

  async sendPhoneOtp(phone: string, containerId: string): Promise<void> {
    const auth = await this.requireAuth();
    const { RecaptchaVerifier, signInWithPhoneNumber } = await import("firebase/auth");
    const normalizedPhone = this.normalizePhone(phone);
    try {
      if (!this.recaptcha || this.recaptchaHostId !== containerId) {
        this.resetRecaptcha();
        this.recaptchaHostId = containerId;
        this.recaptcha = new RecaptchaVerifier(auth, this.recaptchaContainer(containerId), { size: "invisible" });
        await this.recaptcha.render();
      }
      this.confirmation = await signInWithPhoneNumber(auth, normalizedPhone, this.recaptcha);
    } catch (error) {
      this.resetRecaptcha();
      throw error;
    }
  }

  async verifyPhoneOtp(otp: string): Promise<User> {
    if (!this.confirmation) throw new Error("Request a new OTP before verifying.");
    const result = await this.confirmation.confirm(otp);
    this.confirmation = null;
    return result.user;
  }

  async idTokenFor(user: User): Promise<string> {
    return user.getIdToken();
  }

  async logout(): Promise<void> {
    if (!this.auth) return;
    const { signOut } = await import("firebase/auth");
    await signOut(this.auth);
  }

  friendlyMessage(error: unknown, fallback: string): string {
    const code = this.errorCode(error);
    const apiMessage = this.apiErrorMessage(error);
    if (code === "auth/popup-closed-by-user") { console.error("[FacebookAuth] Popup closed by user", { code, error }); return "Sign-in was cancelled."; }
    if (code === "auth/popup-blocked") { console.error("[FacebookAuth] Popup blocked", { code, error }); return "Allow popups for this site, then try again."; }
    if (code === "auth/unauthorized-domain") { console.error("[FacebookAuth] Unauthorized domain", { code, error, hostname: window.location.hostname }); return `Firebase is blocking this domain. Add ${window.location.hostname} to Authentication > Settings > Authorized domains for project ${this.projectId()}.`; }
    if (code === "auth/operation-not-allowed") { console.error("[FacebookAuth] Operation not allowed", { code, error, projectId: this.projectId(), authDomain: this.authDomain(), appId: this.appId() }); return `Firebase rejected this provider for project ${this.projectId()} (${this.authDomain()}, app ${this.appId()}). Enable it on this exact Firebase project and web app configuration.`; }
    if (code === "auth/account-exists-with-different-credential") { console.error("[FacebookAuth] Account exists with different credential", { code, error }); return "An account already exists with this email using a different sign-in method. Please sign in with your existing method, then link this provider from account settings."; }
    if (code === "auth/cancelled-popup-request") { console.error("[FacebookAuth] Popup request was cancelled", { code, error }); return "Sign-in was cancelled."; }
    if (code === "auth/invalid-phone-number" || code === "auth/missing-phone-number") return "Enter a valid phone number with country code.";
    if (code === "auth/too-many-requests" || code === "auth/quota-exceeded") return "Too many OTP attempts or SMS quota exceeded. Please wait and try again.";
    if (code === "auth/captcha-check-failed") return "reCAPTCHA verification failed. Refresh the page and try again.";
    if (code === "auth/missing-app-credential" || code === "auth/invalid-app-credential") return "Firebase could not verify this app session. Refresh the page and try again.";
    if (code === "auth/app-not-authorized") return `Firebase has not authorized ${this.currentHostname()}. Add this domain in Firebase Authentication authorized domains.`;
    if (code === "auth/network-request-failed") return "Network error while contacting Firebase. Check internet connection and try again.";
    if (code === "auth/internal-error" && apiMessage) return this.firebaseServerMessage(apiMessage, fallback);
    if (code === "auth/internal-error") return "Firebase could not send OTP right now. Check Phone provider setup, SMS region policy, and project quota.";
    if (code === "auth/invalid-verification-code") return "The OTP is not correct. Please check and try again.";
    if (code === "auth/code-expired") return "The OTP has expired. Please request a new one.";
    if (code === "auth/email-already-in-use") return "This email already has an account. Sign in with the correct password.";
    if (code === "auth/wrong-password" || code === "auth/invalid-credential") return "Email or password is incorrect.";
    if (code === "auth/weak-password") return "Use a stronger password with at least 6 characters.";
    if (code === "auth/requires-recent-login") return "Please sign in again before changing this sensitive account setting.";
    if (code === "auth/user-mismatch") return "The current password does not match this account.";
    if (code === "auth/configuration-not-found") return "Firebase Authentication is not enabled for this app yet.";
    if (error instanceof Error && error.message.startsWith("Firebase rejected Apple Sign-In")) return error.message;
    if (apiMessage.includes("reCAPTCHA has already been rendered") || (error instanceof Error && error.message.includes("reCAPTCHA has already been rendered"))) return "reCAPTCHA was reset. Hard refresh this page, then tap Send OTP again.";
    if (apiMessage.includes("Firebase project is not configured")) return "Google sign-in reached Firebase, but the AuraSalon API is missing FIREBASE_PROJECT_ID=aurashineclient.";
    if (apiMessage && apiMessage !== "Error") return this.firebaseServerMessage(apiMessage, fallback);
    if ((apiMessage === "Error" || (error instanceof Error && error.message === "Error")) && fallback.toLowerCase().includes("otp")) return this.localPhoneAuthMessage(fallback);
    if (error instanceof Error && error.message.includes("Firebase project is not configured")) return "Google sign-in reached Firebase, but the AuraSalon API is missing FIREBASE_PROJECT_ID=aurashineclient.";
    if (error instanceof Error && (error.message.startsWith("Http failure response") || error.message.includes("Unknown Error"))) return error.message || fallback;
    if (error instanceof Error && error.message.startsWith("Firebase:")) return this.firebaseMessage(error, fallback);
    return error instanceof Error ? error.message || fallback : fallback;
  }

  private async requireAuth(): Promise<Auth> {
    if (!this.isConfigured()) {
      throw new Error("Firebase is not configured. Add the Firebase web config in the customer app environment file.");
    }
    if (!this.auth) {
      const { initializeApp } = await import("firebase/app");
      const { getAuth } = await import("firebase/auth");
      this.app = initializeApp(this.firebaseConfig());
      if (this.projectId() !== EXPECTED_FIREBASE_PROJECT_ID) {
        throw new Error("Customer app is connected to the wrong Firebase project. Expected AuraShineClient.");
      }
      this.auth = getAuth(this.app);
    }
    return this.auth;
  }

  private async assertProviderEnabled(providerId: "apple.com"): Promise<void> {
    const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:createAuthUri?key=${encodeURIComponent(String(this.firebaseConfig().apiKey || ""))}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        providerId,
        continueUri: window.location.origin,
        customParameter: {}
      })
    });
    const body = await response.json().catch(() => null);
    if (response.ok) return;
    const message = String(body?.error?.message || "");
    if (message.includes("Code flow is not enabled for Apple")) {
      throw new Error(`Firebase reached project ${this.projectId()}, but Apple OAuth code flow is not enabled for this web app. Complete the Apple provider web configuration in Firebase Authentication for ${this.authDomain()}.`);
    }
    if (message.includes("OPERATION_NOT_ALLOWED")) {
      throw new Error(`Firebase rejected Apple Sign-In for project ${this.projectId()} (${this.authDomain()}, app ${this.appId()}). Apple must be enabled on this exact Firebase API key/project.`);
    }
    if (message.includes("INVALID_PROVIDER_ID")) {
      throw new Error(`Firebase does not recognize Apple provider for project ${this.projectId()}. Check the Apple Sign-In provider setup in Firebase Authentication.`);
    }
    throw new Error(message || "Firebase could not verify Apple Sign-In provider status.");
  }

  private firebaseConfig(): FirebaseOptions {
    const runtimeConfig = typeof window === "undefined" ? {} : window.AURA_CUSTOMER_FIREBASE_CONFIG || {};
    return { ...environment.firebase, ...runtimeConfig };
  }


  private recaptchaContainer(containerId: string): HTMLElement | string {
    if (typeof document === "undefined") return containerId;
    const host = document.getElementById(containerId);
    if (!host) return containerId;
    host.replaceChildren();
    const element = document.createElement("div");
    element.id = `${containerId}-widget-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    host.appendChild(element);
    return element;
  }

  private resetRecaptcha() {
    this.recaptcha?.clear();
    this.recaptcha = null;
    if (typeof document !== "undefined" && this.recaptchaHostId) {
      document.getElementById(this.recaptchaHostId)?.replaceChildren();
    }
    this.recaptchaHostId = "";
  }

  private normalizePhone(phone: string): string {
    const trimmed = phone.trim();
    if (trimmed.startsWith("+")) return trimmed;
    const digits = trimmed.replace(/\D/g, "");
    if (digits.length === 10) return `+91${digits}`;
    if (digits.startsWith("91") && digits.length === 12) return `+${digits}`;
    return `+${digits}`;
  }

  private errorCode(error: unknown): string {
    return typeof error === "object" && error && "code" in error ? String((error as { code?: unknown }).code || "") : "";
  }

  private currentHostname(): string {
    return typeof window === "undefined" ? "this domain" : window.location.hostname || "this domain";
  }
  private localPhoneAuthMessage(fallback: string): string {
    if (typeof window !== "undefined" && ["localhost", "127.0.0.1", "::1"].includes(window.location.hostname)) {
      return "Firebase real SMS OTP cannot be sent from localhost. Use an HTTPS authorized domain for real phone auth.";
    }
    return "Firebase could not send OTP. Check Phone provider, SMS region policy, authorized domain, and quota.";
  }

  private firebaseMessage(error: Error, fallback: string): string {
    const message = error.message.replace(/^Firebase:\s*/i, "").replace(/\s*\([^)]*\)\.?$/, "").trim();
    return this.firebaseServerMessage(message, fallback);
  }

  private firebaseServerMessage(message: string, fallback: string): string {
    const normalized = message.trim();
    const upper = normalized.toUpperCase();
    if (!normalized || upper === "ERROR") return this.localPhoneAuthMessage(fallback);
    if (upper.includes("BILLING_NOT_ENABLED") || upper.includes("BILLING")) return "Firebase billing is not enabled for Phone Auth SMS. Upgrade the project to Blaze and try again.";
    if (upper.includes("OPERATION_NOT_ALLOWED") || upper.includes("PHONE_PROVIDER_DISABLED")) return "Firebase Phone provider is disabled. Enable Authentication > Sign-in method > Phone.";
    if (upper.includes("TOO_MANY_ATTEMPTS") || upper.includes("QUOTA") || upper.includes("RATE_LIMIT")) return "Too many OTP attempts or SMS quota exceeded. Please wait before trying again.";
    if (upper.includes("SMS_REGION") || upper.includes("REGION")) return "Firebase SMS region policy is blocking India. Allow India in Authentication SMS region policy.";
    if (upper.includes("APP_NOT_AUTHORIZED") || upper.includes("UNAUTHORIZED_DOMAIN")) return `Firebase has not authorized ${this.currentHostname()}. Add this domain in Firebase Authentication authorized domains.`;
    if (upper.includes("CAPTCHA") || upper.includes("APP_CREDENTIAL")) return "Firebase could not verify reCAPTCHA for this session. Hard refresh the page and try again.";
    return normalized || fallback;
  }

  private apiErrorMessage(error: unknown): string {
    if (!error || typeof error !== "object") return "";
    const payload = error as {
      error?: unknown;
      message?: unknown;
      customData?: { _serverResponse?: unknown; _tokenResponse?: { error?: { message?: unknown } } };
    };
    const tokenMessage = payload.customData?._tokenResponse?.error?.message;
    if (typeof tokenMessage === "string") return tokenMessage;
    const serverMessage = this.serverResponseMessage(payload.customData?._serverResponse);
    if (serverMessage) return serverMessage;
    if (payload.error && typeof payload.error === "object") {
      const apiError = payload.error as { error?: unknown; message?: unknown };
      if (typeof apiError.message === "string") return apiError.message;
      if (typeof apiError.error === "string") return apiError.error;
      if (apiError.error && typeof apiError.error === "object") {
        const nested = apiError.error as { message?: unknown };
        if (typeof nested.message === "string") return nested.message;
      }
    }
    return typeof payload.message === "string" ? payload.message : "";
  }

  private serverResponseMessage(response: unknown): string {
    if (typeof response !== "string" || !response.trim()) return "";
    try {
      const parsed = JSON.parse(response) as { error?: { message?: unknown } };
      return typeof parsed.error?.message === "string" ? parsed.error.message : "";
    } catch {
      return response;
    }
  }
}
