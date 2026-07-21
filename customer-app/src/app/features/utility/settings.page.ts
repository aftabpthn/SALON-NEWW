import { Component, OnInit } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { Router } from "@angular/router";
import { IonBackButton, IonButton, IonButtons, IonContent, IonHeader, IonIcon, IonToggle, IonToolbar } from "@ionic/angular/standalone";
import { addIcons } from "ionicons";
import { fingerPrintOutline, phonePortraitOutline, trashOutline } from "ionicons/icons";
import { MarketplaceService } from "../../core/marketplace.service";
import { AuthService } from "../../core/auth.service";
import { CustomerDeviceSession, CustomerNotificationPreferences } from "../../core/api.types";

@Component({
  standalone: true,
  imports: [FormsModule, IonBackButton, IonButton, IonButtons, IonContent, IonHeader, IonIcon, IonToggle, IonToolbar],
  template: `
    <ion-header class="ion-no-border"><ion-toolbar><ion-buttons slot="start"><ion-back-button defaultHref="/tabs/profile"></ion-back-button></ion-buttons></ion-toolbar></ion-header>
    <ion-content>
      <main class="page-narrow settings-page">
        <h1 class="page-title">Preferences</h1>
        @if (marketplace.customer(); as customer) {
          <section class="premium-card identity-card">
            <div class="identity-avatar">{{ (customer.name || "?").charAt(0) }}</div>
            <div>
              <strong>{{ customer.name || "Aura customer" }}</strong>
              <span>{{ customer.email || "No email saved" }}</span>
              <span>{{ customer.phone || "No phone saved" }}</span>
              <small>Signed in with {{ customer.authProvider || "customer login" }}</small>
            </div>
          </section>
        }
        <section class="premium-card setting-row"><div><strong>Booking reminders</strong><span>Push reminders before appointments</span></div><ion-toggle [(ngModel)]="preferences.bookingReminders" (ionChange)="save()" aria-label="Booking reminders"></ion-toggle></section>
        <section class="premium-card setting-row"><div><strong>Marketing offers</strong><span>Personalized beauty and wellness deals</span></div><ion-toggle [(ngModel)]="preferences.promotions" (ionChange)="save()" aria-label="Marketing offers"></ion-toggle></section>
        <section class="premium-card setting-row"><div><strong>Loyalty alerts</strong><span>Rewards, points, and membership updates</span></div><ion-toggle [(ngModel)]="preferences.loyalty" (ionChange)="save()" aria-label="Loyalty alerts"></ion-toggle></section>

        <section class="section-heading">
          <h2>Device security</h2>
        </section>

        @if (message) {
          <p class="notice-text">{{ message }}</p>
        }
        @if (auth.error()) {
          <p class="error-text">{{ auth.error() }}</p>
        }

        <section class="premium-card setting-row">
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

        <section class="premium-card device-panel">
          <div class="device-heading">
            <div>
              <strong>Active Devices</strong>
              <span>Manage browsers and phones where your Aura account is signed in.</span>
            </div>
            <ion-button size="small" fill="outline" (click)="loadDevices()" [disabled]="auth.loading()">Refresh</ion-button>
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
    .settings-page { display: grid; gap: 14px; }
    .identity-card {
      display: grid;
      grid-template-columns: auto minmax(0, 1fr);
      gap: 14px;
      align-items: center;
      padding: 18px;
    }
    .identity-avatar {
      width: 58px;
      height: 58px;
      display: grid;
      place-items: center;
      border-radius: 20px;
      color: #ffffff;
      background: linear-gradient(135deg, var(--primary), var(--primary-2));
      font-size: 1.35rem;
      font-weight: 900;
    }
    .setting-row { display: flex; align-items: center; justify-content: space-between; gap: 18px; padding: 18px; }
    .section-heading { margin-top: 10px; }
    .section-heading h2 { margin: 0; font-size: 1.45rem; letter-spacing: 0; }
    .setting-copy, .device-heading, .device-row { display: flex; align-items: center; gap: 12px; }
    .setting-icon {
      flex: 0 0 auto;
      width: 40px;
      height: 40px;
      display: grid;
      place-items: center;
      border-radius: 14px;
      color: var(--primary-2);
      background: rgba(245, 243, 255, 0.92);
      font-size: 1.14rem;
    }
    .device-panel { display: grid; gap: 14px; padding: 18px; }
    .device-heading { justify-content: space-between; gap: 16px; }
    .device-row {
      padding: 12px 0;
      border-top: 1px solid var(--border);
    }
    .device-row div { min-width: 0; flex: 1; }
    .empty-state, .notice-text, .error-text {
      margin: 0;
      padding: 12px 14px;
      border-radius: 16px;
      font-weight: 800;
      line-height: 1.45;
    }
    .empty-state { color: var(--muted); background: var(--surface-soft); }
    .notice-text { color: var(--primary); background: var(--aura-gold-soft); border: 1px solid rgba(214, 169, 74, 0.22); }
    .error-text { color: #EF4444; background: #fff1f2; border: 1px solid rgba(225, 29, 72, 0.16); }
    strong, span { display: block; }
    strong { margin-bottom: 5px; }
    span { color: var(--muted); line-height: 1.4; }
    small { display: block; margin-top: 7px; color: #8B5CF6; font-weight: 800; }
    @media (max-width: 599px) {
      .setting-row, .device-heading { align-items: flex-start; }
      .device-heading { flex-direction: column; }
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

  constructor(readonly marketplace: MarketplaceService, readonly auth: AuthService, private readonly router: Router) {
    addIcons({ fingerPrintOutline, phonePortraitOutline, trashOutline });
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
      .then(() => this.router.navigateByUrl("/tabs/home"))
      .catch(() => undefined);
  }

  formatDate(value: string): string {
    if (!value) return "recently";
    return new Intl.DateTimeFormat("en-IN", { day: "2-digit", month: "short", hour: "numeric", minute: "2-digit" }).format(new Date(value));
  }
}
