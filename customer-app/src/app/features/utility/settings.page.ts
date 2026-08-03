import { Component, OnInit } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { Router } from "@angular/router";
import { IonBackButton, IonButton, IonContent, IonIcon, IonToggle } from "@ionic/angular/standalone";
import { addIcons } from "ionicons";
import { contrastOutline, fingerPrintOutline, moonOutline, phonePortraitOutline, sunnyOutline, trashOutline } from "ionicons/icons";
import { MarketplaceService } from "../../core/marketplace.service";
import { AuthService } from "../../core/auth.service";
import { CustomerDeviceSession, CustomerNotificationPreferences } from "../../core/api.types";

@Component({
  standalone: true,
  imports: [FormsModule, IonBackButton, IonButton, IonContent, IonIcon, IonToggle],
  template: `
    <ion-content>
      <main class="page-narrow settings-page">
        <section class="settings-hero">
          <div class="content-title-row">
            <ion-back-button class="content-back-button" [defaultHref]="backHref()" text=""></ion-back-button>
            <div>
              <p class="settings-eyebrow">Account controls</p>
              <h1 class="page-title">Preferences</h1>
            </div>
          </div>
          <p class="settings-intro">Manage alerts, login security, and devices connected to your Aura account.</p>

          @if (marketplace.customer(); as customer) {
            <section class="identity-card">
              <div class="identity-avatar">{{ (customer.name || "?").charAt(0) }}</div>
              <div>
                <strong>{{ customer.name || "Aura customer" }}</strong>
                <span>{{ customer.email || "No email saved" }}</span>
                <span>{{ customer.phone || "No phone saved" }}</span>
                <small>Signed in with {{ customer.authProvider || "customer login" }}</small>
              </div>
            </section>
          }
        </section>

        <section class="settings-card" aria-labelledby="notification-settings-title">
          <div class="settings-section-heading">
            <p>Notifications</p>
            <h2 id="notification-settings-title">Choose what reaches you</h2>
          </div>
          <div class="settings-list">
            <section class="setting-row"><div><strong>Booking reminders</strong><span>Push reminders before appointments</span></div><ion-toggle [(ngModel)]="preferences.bookingReminders" (ionChange)="save()" aria-label="Booking reminders"></ion-toggle></section>
            <section class="setting-row"><div><strong>Marketing offers</strong><span>Personalized beauty and wellness deals</span></div><ion-toggle [(ngModel)]="preferences.promotions" (ionChange)="save()" aria-label="Marketing offers"></ion-toggle></section>
            <section class="setting-row"><div><strong>Loyalty alerts</strong><span>Rewards, points, and membership updates</span></div><ion-toggle [(ngModel)]="preferences.loyalty" (ionChange)="save()" aria-label="Loyalty alerts"></ion-toggle></section>
            <section class="setting-row"><div><strong>Membership alerts</strong><span>Renewal, expiry, and benefit updates</span></div><ion-toggle [(ngModel)]="preferences.membership" (ionChange)="save()" aria-label="Membership alerts"></ion-toggle></section>
          </div>
        </section>

        @if (message) {
          <p class="notice-text">{{ message }}</p>
        }
        @if (auth.error()) {
          <p class="error-text">{{ auth.error() }}</p>
        }

        <section class="settings-card" aria-labelledby="appearance-settings-title">
          <div class="settings-section-heading">
            <p>Appearance</p>
            <h2 id="appearance-settings-title">Choose your look</h2>
          </div>
          <div class="theme-switch-row" role="radiogroup" aria-label="App theme">
            <button type="button" class="theme-option" [class.active]="themeMode === 'system'" role="radio" [attr.aria-checked]="themeMode === 'system'" (click)="setTheme('system')">
              <ion-icon name="contrast-outline"></ion-icon><span>System</span>
            </button>
            <button type="button" class="theme-option" [class.active]="themeMode === 'light'" role="radio" [attr.aria-checked]="themeMode === 'light'" (click)="setTheme('light')">
              <ion-icon name="sunny-outline"></ion-icon><span>Light</span>
            </button>
            <button type="button" class="theme-option" [class.active]="themeMode === 'dark'" role="radio" [attr.aria-checked]="themeMode === 'dark'" (click)="setTheme('dark')">
              <ion-icon name="moon-outline"></ion-icon><span>Dark</span>
            </button>
          </div>
          <p class="theme-hint">System follows your device setting. Light and Dark override it for this app only.</p>
        </section>

        <section class="settings-card" aria-labelledby="security-settings-title">
          <div class="settings-section-heading device-heading">
            <div>
              <p>Device security</p>
              <h2 id="security-settings-title">Protect your access</h2>
            </div>
            <ion-button size="small" fill="outline" (click)="loadDevices()" [disabled]="auth.loading()">Refresh</ion-button>
          </div>

          <section class="setting-row security-row">
            <div class="setting-copy">
              <span class="setting-icon"><ion-icon name="finger-print-outline"></ion-icon></span>
              <div>
                <strong>Biometric Login</strong>
                <span>Optional Face ID, Touch ID, or fingerprint check when opening this device.</span>
                @if (!auth.biometricSupported()) {
                }
              </div>
            </div>
            <ion-toggle [ngModel]="auth.biometricEnabled()" (ionChange)="toggleBiometric($event)" [disabled]="auth.loading() || !auth.biometricSupported()" aria-label="Biometric Login"></ion-toggle>
          </section>

          <div class="devices-title">
            <strong>Active Devices</strong>
            <span>Manage browsers and phones where your Aura account is signed in.</span>
          </div>
          @if (!devices.length) {
            <p class="empty-state">No active devices found yet.</p>
          }
          @for (device of devices; track device.id) {
            <div class="device-row">
              <span class="setting-icon"><ion-icon name="phone-portrait-outline"></ion-icon></span>
              <div>
                <strong>{{ device.deviceName }} {{ device.current ? '· This device' : '' }}</strong>
                <span>{{ device.platform }} · Last active {{ formatDate(device.lastSeenAt) }}</span>
              </div>
              <ion-button size="small" fill="clear" color="danger" (click)="logoutDevice(device)" [disabled]="auth.loading()">
                <ion-icon name="trash-outline" slot="icon-only"></ion-icon>
              </ion-button>
            </div>
          }
          <ion-button expand="block" fill="outline" color="danger" (click)="logoutAllDevices()" [disabled]="auth.loading() || !devices.length">Logout all devices</ion-button>
        </section>
      </main>
    </ion-content>
  `,
  styles: [`
    .settings-page { display: grid; gap: 14px; padding-bottom: 32px; }
    .settings-hero {
      display: grid;
      gap: 14px;
      padding: 4px 0 2px;
    }
    .content-title-row { display: flex; align-items: center; gap: 10px; }
    .content-title-row .page-title { margin: 0; color: var(--brand-950); font-size: clamp(2.1rem, 8vw, 3.4rem); font-weight: 900; letter-spacing: -0.055em; line-height: 0.95; }
    .content-back-button {
      width: 38px;
      height: 38px;
      min-width: 38px;
      margin-left: -8px;
      --color: var(--brand-950);
      --icon-font-size: 25px;
      --background: transparent;
      --border-radius: 12px;
      --padding-start: 0;
      --padding-end: 0;
      filter: drop-shadow(0.45px 0 0 var(--brand-950));
    }
    .settings-eyebrow,
    .settings-section-heading p {
      margin: 0 0 4px;
      color: var(--primary);
      font-size: 0.7rem;
      font-weight: 900;
      letter-spacing: 0.12em;
      text-transform: uppercase;
    }
    .settings-intro {
      max-width: 620px;
      margin: 0;
      color: var(--muted);
      font-size: 0.88rem;
      font-weight: 750;
      line-height: 1.5;
    }
    .identity-card {
      display: grid;
      grid-template-columns: auto minmax(0, 1fr);
      gap: 14px;
      align-items: center;
      padding: 16px;
      border: 1px solid var(--border);
      border-radius: 22px;
      background: var(--glass);
      box-shadow: 0 14px 34px rgba(28, 28, 28, 0.08);
    }
    .identity-avatar {
      width: 56px;
      height: 56px;
      display: grid;
      place-items: center;
      border-radius: 18px;
      color: #ffffff;
      background: linear-gradient(135deg, var(--primary), var(--primary-2));
      font-size: 1.35rem;
      font-weight: 900;
    }
    .settings-card {
      overflow: hidden;
      display: grid;
      gap: 0;
      border: 1px solid var(--border);
      border-radius: 24px;
      background: var(--surface);
      box-shadow: 0 16px 38px rgba(28, 28, 28, 0.08);
    }
    .settings-section-heading {
      padding: 18px 18px 14px;
      border-bottom: 1px solid var(--border);
    }
    .settings-section-heading h2 {
      margin: 0;
      color: var(--brand-950);
      font-size: clamp(1.3rem, 4vw, 1.65rem);
      font-weight: 900;
      letter-spacing: -0.04em;
      line-height: 1.08;
    }
    .settings-list { display: grid; }
    .setting-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 18px;
      padding: 16px 18px;
      border-top: 1px solid var(--border);
    }
    .settings-list .setting-row:first-child { border-top: 0; }
    .security-row { border-top: 0; }
    .setting-copy, .device-heading, .device-row { display: flex; align-items: center; gap: 12px; }
    .setting-icon {
      flex: 0 0 auto;
      width: 40px;
      height: 40px;
      display: grid;
      place-items: center;
      border-radius: 14px;
      color: var(--primary-2);
      background: var(--primary-soft);
      font-size: 1.14rem;
    }
    .device-heading { align-items: end; justify-content: space-between; gap: 16px; }
    .devices-title {
      display: grid;
      gap: 4px;
      padding: 16px 18px 4px;
      border-top: 1px solid var(--border);
    }
    .device-row {
      padding: 14px 18px;
      border-top: 1px solid var(--border);
    }
    .theme-switch-row {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 8px;
      padding: 16px 18px 0;
    }
    .theme-option {
      display: inline-flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 6px;
      min-height: 74px;
      border: 1px solid var(--border);
      border-radius: 18px;
      color: var(--muted);
      background: var(--surface-soft);
      font: inherit;
      font-size: 0.8rem;
      font-weight: 900;
      cursor: pointer;
      transition: border-color var(--motion-fast), background var(--motion-fast), color var(--motion-fast), box-shadow var(--motion-fast);
    }
    .theme-option ion-icon { font-size: 1.35rem; }
    .theme-option:hover { border-color: rgba(99, 102, 241, 0.4); }
    .theme-option:focus-visible { outline: 2px solid var(--focus); outline-offset: 2px; }
    .theme-option.active {
      color: #FFFFFF;
      border-color: var(--primary);
      background: linear-gradient(135deg, var(--primary), var(--primary-2));
      box-shadow: 0 10px 22px rgba(99, 102, 241, 0.22);
    }
    .theme-hint {
      margin: 0;
      padding: 10px 18px 18px;
      color: var(--muted);
      font-size: 0.78rem;
      font-weight: 750;
      line-height: 1.45;
    }
    .device-row div { min-width: 0; flex: 1; }
    .settings-card > ion-button {
      margin: 14px 18px 18px;
    }
    .empty-state, .notice-text, .error-text {
      margin: 0;
      padding: 12px 14px;
      border-radius: 16px;
      font-weight: 800;
      line-height: 1.45;
    }
    .empty-state { color: var(--muted); background: var(--surface-soft); }
    .notice-text { color: var(--primary); background: var(--primary-soft); border: 1px solid rgba(99, 102, 241, 0.22); }
    .error-text { color: #EF4444; background: var(--error-soft); border: 1px solid rgba(225, 29, 72, 0.16); }
    .settings-card .empty-state { margin: 14px 18px 0; }
    strong, span { display: block; }
    strong { margin-bottom: 5px; color: var(--brand-950); font-weight: 900; }
    span { color: var(--muted); font-size: 0.86rem; font-weight: 750; line-height: 1.4; }
    small { display: block; margin-top: 7px; color: var(--primary); font-size: 0.76rem; font-weight: 850; }
    @media (max-width: 599px) {
      .settings-page { gap: 12px; }
      .setting-row, .device-heading { align-items: flex-start; }
      .device-heading { flex-direction: column; }
      .content-title-row .page-title { font-size: 2rem; }
    }
  `]
})
export class SettingsPage implements OnInit {
  preferences: CustomerNotificationPreferences = {
    bookingReminders: true,
    promotions: true,
    loyalty: true,
    membership: true
  };
  devices: CustomerDeviceSession[] = [];
  message = "";
  themeMode: "system" | "light" | "dark" = "system";

  constructor(readonly marketplace: MarketplaceService, readonly auth: AuthService, private readonly router: Router) {
    addIcons({ contrastOutline, fingerPrintOutline, moonOutline, phonePortraitOutline, sunnyOutline, trashOutline });
    try {
      const saved = localStorage.getItem("aura-theme");
      if (saved === "light" || saved === "dark") this.themeMode = saved;
    } catch {
      this.themeMode = "system";
    }
  }

  backHref(): string {
    return this.marketplace.salonMode() ? this.marketplace.salonModeUrl() : "/tabs/profile";
  }

  async ngOnInit() {
    if (this.marketplace.isAuthenticated()) {
      await this.marketplace.loadCustomer().then(() => {
        this.preferences = {
          ...this.preferences,
          ...(this.marketplace.customer()?.notificationPreferences || {})
        };
      }).catch(() => undefined);
      await this.loadDevices();
    }
  }

  save() {
    void this.marketplace.updateCustomer({ notificationPreferences: this.preferences }).catch(() => undefined);
  }

  setTheme(mode: "system" | "light" | "dark") {
    this.themeMode = mode;
    try {
      if (mode === "system") {
        localStorage.removeItem("aura-theme");
        document.documentElement.removeAttribute("data-theme");
      } else {
        localStorage.setItem("aura-theme", mode);
        document.documentElement.setAttribute("data-theme", mode);
      }
    } catch {
      // storage unavailable — theme still applies for this session
    }
  }

  async toggleBiometric(event: CustomEvent) {
    const enabled = Boolean(event.detail?.checked);
    this.message = "";
    await this.auth.setBiometricEnabled(enabled)
      .then(() => this.message = enabled ? "Biometric Login is enabled for this device." : "Biometric Login is disabled for this device.")
      .catch(() => undefined);
  }

  async loadDevices() {
    this.devices = await this.auth.loadDevices().catch(() => []);
  }

  async logoutDevice(device: CustomerDeviceSession) {
    await this.auth.logoutDevice(device.id).then(() => this.loadDevices()).catch(() => undefined);
  }

  async logoutAllDevices() {
    const confirmed = window.confirm("Logout all active devices? You will need to sign in again.");
    if (!confirmed) return;
    await this.auth.logoutAllDevices()
      .then(() => this.router.navigateByUrl(this.marketplace.salonMode() ? this.marketplace.salonModeUrl() : "/tabs/home"))
      .catch(() => undefined);
  }

  formatDate(value: string): string {
    if (!value) return "recently";
    return new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", hour: "numeric", minute: "2-digit" }).format(new Date(value));
  }
}
