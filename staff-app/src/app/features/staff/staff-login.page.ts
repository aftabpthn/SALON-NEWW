import { Component, signal } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { Router } from "@angular/router";
import { IonContent, IonSpinner } from "@ionic/angular/standalone";
import { environment } from "../../../environments/environment";
import { StaffAppService } from "../../core/staff-app.service";

@Component({
  standalone: true,
  imports: [FormsModule, IonContent, IonSpinner],
  template: `
    <ion-content class="staff-login-shell">
      <main class="login-grid">
        <section class="brand-panel">
          <div class="orb one"></div>
          <div class="orb two"></div>
          <p class="eyebrow">Aura Staff OS</p>
          <h1>Salon work, live and permission-aware.</h1>
          <p class="subcopy">Appointments, attendance, payroll, targets and leave stay connected to the real staff profile.</p>
          <div class="status-row">
            <span>API connected</span>
            <span>Branch scoped</span>
            <span>JWT secure</span>
          </div>
        </section>

        <section class="staff-card">
          <div class="orb login-orb"></div>
          <button type="button" class="login-theme-button" [attr.aria-pressed]="theme() === 'dark'" (click)="toggleTheme()">{{ theme() === 'dark' ? 'Light mode' : 'Dark mode' }}</button>
          <p class="eyebrow dark">Secure staff access</p>
          <h2>Open your workspace</h2>

          @if (staff.error()) {
            <div class="notice">{{ staff.error() }}</div>
          }
          @if (message()) {
            <div class="notice success">{{ message() }}</div>
          }
           @if (staff.biometricEnabled()) {
             <button type="button" class="biometric-button" [disabled]="staff.loading()" (click)="unlockBiometric()">Sign in with passkey</button>
          }

          <form class="staff-form" (ngSubmit)="login($event)">
            <label for="staff-tenant-id">Tenant ID</label>
            <input id="staff-tenant-id" [(ngModel)]="tenantId" name="tenantId" placeholder="tenant_aura" autocomplete="organization" />

            <label for="staff-login-id">Staff login ID</label>
            <input id="staff-login-id" [(ngModel)]="loginId" name="loginId" placeholder="isha.staff" autocomplete="username" />

            <label for="staff-password">Password</label>
            <input id="staff-password" [(ngModel)]="password" name="password" type="password" placeholder="Password" autocomplete="current-password" />

            <button type="submit" [disabled]="staff.loading()">
              @if (staff.loading()) { <ion-spinner name="crescent"></ion-spinner> } @else { Open staff app }
            </button>
          </form>

           @if (staff.hasSavedSession() && staff.biometricSupported()) {
            <button type="button" class="secondary-button" [disabled]="staff.loading()" (click)="toggleBiometric()">
              {{ staff.biometricEnabled() ? 'Turn off biometric unlock' : 'Enable biometric unlock' }}
            </button>
          }

          <a [href]="customerAppUrl" class="customer-link">Open customer app</a>
        </section>
      </main>
    </ion-content>
  `,
  styles: [`
    .staff-login-shell { --background: var(--staff-background); }
    .login-grid { width: min(1100px, calc(100% - 28px)); min-height: 100%; margin: 0 auto; padding: 7vh 0; display: grid; grid-template-columns: 1.08fr .92fr; gap: 20px; align-items: stretch; }
    .brand-panel, .staff-card { position: relative; overflow: hidden; border: 1px solid var(--staff-border); border-radius: 28px; background: var(--staff-surface); box-shadow: var(--staff-shadow); }
    .brand-panel { min-height: 580px; padding: 42px; color: var(--staff-text); background: var(--staff-primary-light); }
    .staff-card { padding: 34px; background: var(--staff-primary-light); }
    .login-theme-button { float: right; min-height: 48px; margin: 0 0 16px 16px; padding: 0 14px; border: 1px solid var(--staff-border-accent); border-radius: 14px; background: var(--staff-surface-secondary); color: var(--staff-primary-hover); font-size: .78rem; }
    .orb { position: absolute; border-radius: 50%; opacity: .5; }
    .orb.one { width: 190px; height: 190px; right: -42px; top: -36px; background: var(--staff-decoration-one); }
    .orb.two { width: 260px; height: 260px; left: -90px; bottom: -90px; background: var(--staff-decoration-two); }
    .orb.login-orb { width: 190px; height: 190px; right: -42px; top: -36px; background: var(--staff-decoration-one); }
    .eyebrow { position: relative; margin: 0 0 12px; color: var(--staff-primary-hover); font-size: .72rem; font-weight: 800; letter-spacing: .16em; text-transform: uppercase; }
    .dark { color: var(--staff-primary); }
    h1 { position: relative; max-width: 680px; margin: 0; font-size: clamp(3rem, 8vw, 5.8rem); line-height: .9; letter-spacing: -.06em; }
    h2 { margin: 0; color: var(--staff-text); font-size: clamp(2rem, 5vw, 3.2rem); line-height: 1; letter-spacing: -.04em; }
    .subcopy, .form-copy { position: relative; color: var(--staff-text-secondary); font-weight: 600; line-height: 1.6; font-size: 1.02rem; }
    .status-row { position: absolute; left: 42px; right: 42px; bottom: 42px; display: flex; flex-wrap: wrap; gap: 10px; }
    .status-row span { padding: 9px 12px; border: 1px solid var(--staff-border-accent); border-radius: 999px; background: var(--staff-surface-glass); color: var(--staff-primary-hover); font-weight: 700; }
    .staff-form { display: grid; gap: 10px; margin-top: 20px; }
    label { color: var(--staff-text); font-size: .82rem; font-weight: 700; }
    input { min-height: 56px; border: 1px solid var(--staff-border); border-radius: 16px; padding: 0 15px; color: var(--staff-text); background: var(--staff-surface-secondary); font: inherit; font-weight: 650; }
    input:focus { border-color: var(--staff-primary); outline: 3px solid var(--staff-focus-ring); }
    button { margin-top: 14px; min-height: 56px; border: 1px solid var(--staff-primary); border-radius: 16px; background: var(--staff-primary); color: var(--staff-on-primary); font-weight: 750; cursor: pointer; }
    button:hover:not(:disabled) { border-color: var(--staff-primary-hover); background: var(--staff-primary-hover); }
    button:disabled { cursor: progress; opacity: .72; }
    .biometric-button, .secondary-button { width: 100%; margin-top: 14px; min-height: 52px; border: 1px solid var(--staff-border-accent); border-radius: 16px; background: var(--staff-surface); color: var(--staff-primary-hover); font-weight: 750; cursor: pointer; }
    .biometric-button { border-color: var(--staff-border-accent); background: var(--staff-primary-light); color: var(--staff-primary-hover); }
    .notice { margin: 18px 0; padding: 14px 16px; border: 1px solid var(--staff-error-border); border-radius: 16px; color: var(--staff-error-text); background: var(--staff-error-surface); font-weight: 650; }
    .success { border-color: var(--staff-success-border); color: var(--staff-success-text); background: var(--staff-success-surface); }
    .customer-link { display: block; margin-top: 18px; color: var(--staff-primary-hover); font-weight: 700; text-align: center; text-decoration: none; }
    @media (max-width: 820px) { .login-grid { width: calc(100% - 40px); grid-template-columns: 1fr; padding: 20px 0; gap: 16px; } .brand-panel { min-height: 336px; padding: 20px; } .staff-card { padding: 20px; } .status-row { position: relative; left: auto; right: auto; bottom: auto; margin-top: 24px; } }
  `]
})
export class StaffLoginPage {
  readonly customerAppUrl = environment.customerAppUrl;
  readonly message = signal("");
  readonly theme = signal<"light" | "dark">(document.documentElement.dataset["staffTheme"] === "dark" ? "dark" : "light");
  tenantId = "tenant_aura";
  loginId = "";
  password = "";

  constructor(readonly staff: StaffAppService, private readonly router: Router) {}

  toggleTheme() {
    const next = this.theme() === "dark" ? "light" : "dark";
    this.theme.set(next);
    document.documentElement.dataset["staffTheme"] = next;
    document.documentElement.style.colorScheme = next;
    localStorage.setItem("auraStaffTheme", next);
    document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.setAttribute("content", next === "dark" ? "#111B21" : "#00A884");
  }

  async login(event?: Event) {
    event?.preventDefault();
    if (this.staff.loading()) return;
    this.message.set("");
    try {
      await this.staff.login({ tenantId: this.tenantId, loginId: this.loginId, password: this.password });
      this.message.set("Staff session created. Opening dashboard...");
      await this.router.navigateByUrl("/staff/dashboard");
    } catch {
      this.message.set("");
    }
  }

  async unlockBiometric() {
    if (this.staff.loading()) return;
    try {
      await this.staff.unlockWithBiometric();
      this.message.set("Biometric verified. Opening dashboard...");
      await this.router.navigateByUrl("/staff/dashboard");
    } catch (error) {
      this.staff.error.set(error instanceof Error ? error.message : "Biometric unlock failed.");
    }
  }

  async toggleBiometric() {
    if (this.staff.loading()) return;
    try {
      const next = !this.staff.biometricEnabled();
      await this.staff.setBiometricEnabled(next);
      this.message.set(next ? "Biometric unlock enabled on this device." : "Biometric unlock disabled.");
    } catch (error) {
      this.staff.error.set(error instanceof Error ? error.message : "Unable to update biometric unlock.");
    }
  }
}
