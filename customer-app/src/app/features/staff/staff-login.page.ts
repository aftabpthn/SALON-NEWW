import { Component, signal } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { Router, RouterLink } from "@angular/router";
import { IonContent, IonSpinner } from "@ionic/angular/standalone";
import { StaffAppService } from "../../core/staff-app.service";

@Component({
  standalone: true,
  imports: [FormsModule, RouterLink, IonContent, IonSpinner],
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
          <p class="eyebrow dark">Secure staff access</p>
          <h2>Open your workspace</h2>
          <p class="form-copy">Demo staff is prefilled. Login writes a real staff session, then opens the connected dashboard.</p>

          @if (staff.error()) {
            <div class="notice">{{ staff.error() }}</div>
          }
          @if (message()) {
            <div class="notice success">{{ message() }}</div>
          }
          @if (staff.biometricEnabled() && staff.hasSavedSession()) {
            <button type="button" class="biometric-button" [disabled]="staff.loading()" (click)="unlockBiometric()">Unlock with biometric</button>
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

          <a routerLink="/" class="customer-link">Open customer app</a>
        </section>
      </main>
    </ion-content>
  `,
  styles: [`
    .staff-login-shell { --background: radial-gradient(circle at 20% 10%, #ffe7a8 0, transparent 28%), radial-gradient(circle at 90% 5%, #7d4c11 0, transparent 24%), linear-gradient(135deg, #201205, #5c3410 45%, #f5ddb0); }
    .login-grid { width: min(1100px, calc(100% - 28px)); min-height: 100%; margin: 0 auto; padding: 7vh 0; display: grid; grid-template-columns: 1.08fr .92fr; gap: 20px; align-items: stretch; }
    .brand-panel, .staff-card { position: relative; overflow: hidden; border: 1px solid rgba(255,255,255,.24); border-radius: 34px; box-shadow: 0 28px 90px rgba(0,0,0,.26); backdrop-filter: blur(18px); }
    .brand-panel { min-height: 580px; padding: 42px; color: #fff8e8; background: linear-gradient(145deg, rgba(255,255,255,.15), rgba(255,255,255,.04)); }
    .staff-card { padding: 34px; background: rgba(255, 250, 238, .94); }
    .orb { position: absolute; border-radius: 50%; filter: blur(2px); opacity: .72; }
    .orb.one { width: 190px; height: 190px; right: -42px; top: -36px; background: #ffd36e; }
    .orb.two { width: 260px; height: 260px; left: -90px; bottom: -90px; background: #9b6221; }
    .eyebrow { position: relative; margin: 0 0 12px; color: #f7d98c; font-size: .74rem; font-weight: 950; letter-spacing: .18em; text-transform: uppercase; }
    .dark { color: #8b5d15; }
    h1 { position: relative; max-width: 680px; margin: 0; font-size: clamp(3rem, 8vw, 6.4rem); line-height: .84; letter-spacing: -.06em; }
    h2 { margin: 0; color: #1d1307; font-size: clamp(2rem, 5vw, 3.2rem); line-height: .95; letter-spacing: -.04em; }
    .subcopy, .form-copy { position: relative; color: #f8e7bd; font-weight: 850; line-height: 1.55; font-size: 1.02rem; }
    .form-copy { color: #74522b; }
    .status-row { position: absolute; left: 42px; right: 42px; bottom: 42px; display: flex; flex-wrap: wrap; gap: 10px; }
    .status-row span { padding: 10px 13px; border: 1px solid rgba(255,255,255,.25); border-radius: 999px; background: rgba(255,255,255,.12); color: #fff3d6; font-weight: 950; }
    .staff-form { display: grid; gap: 10px; margin-top: 20px; }
    label { color: #3a2713; font-size: .85rem; font-weight: 900; }
    input { min-height: 56px; border: 1px solid #ead5aa; border-radius: 18px; padding: 0 15px; color: #1d1307; background: #fff; font: inherit; font-weight: 850; box-shadow: inset 0 1px 0 rgba(255,255,255,.8); }
    input:focus { border-color: #c38b2b; outline: 3px solid rgba(214, 169, 74, .22); }
    button { margin-top: 14px; min-height: 56px; border: 0; border-radius: 18px; background: linear-gradient(135deg, #f9df98, #d6a94a 55%, #9b6418); color: #1b1207; font-weight: 950; cursor: pointer; box-shadow: 0 18px 32px rgba(139, 93, 21, .22); }
    button:disabled { cursor: progress; opacity: .72; }
    .biometric-button, .secondary-button { width: 100%; margin-top: 14px; min-height: 52px; border: 1px solid #d6aa55; border-radius: 18px; background: #fffdf8; color: #6e4810; font-weight: 950; cursor: pointer; box-shadow: 0 12px 24px rgba(139, 93, 21, .12); }
    .biometric-button { background: linear-gradient(135deg, #1d1307, #6e4810); color: #fff8e8; border-color: rgba(255,255,255,.18); }
    .notice { margin: 18px 0; padding: 14px 16px; border: 1px solid #eac36f; border-radius: 16px; color: #6b4a18; background: #fff4d8; font-weight: 800; }
    .success { border-color: #afd8a8; color: #1f6b2d; background: #effbea; }
    .customer-link { display: block; margin-top: 18px; color: #815712; font-weight: 900; text-align: center; text-decoration: none; }
    @media (max-width: 820px) { .login-grid { grid-template-columns: 1fr; padding: 18px 0; } .brand-panel { min-height: 360px; padding: 28px; } .staff-card { padding: 26px; } .status-row { position: relative; left: auto; right: auto; bottom: auto; margin-top: 24px; } }
    .staff-login-shell { --background: radial-gradient(circle at 18% 8%, rgba(246,200,189,.55) 0, transparent 27%), radial-gradient(circle at 92% 4%, rgba(226,171,103,.35) 0, transparent 24%), linear-gradient(135deg, #241625, #563346 52%, #dcae83); }
    .brand-panel { background: linear-gradient(145deg, rgba(255,255,255,.18), rgba(50,25,44,.42)); }
    .staff-card { background: rgba(255,250,246,.96); box-shadow: 0 28px 90px rgba(50,25,44,.28); }
    .dark { color: #a05b6c; }
    button { background: linear-gradient(135deg, #f6c8bd, #e2ab67 58%, #a05b6c); }
    .biometric-button { background: linear-gradient(135deg, #321827, #694052); }
    .customer-link { color: #8d4f62; }  `]
})
export class StaffLoginPage {
  readonly message = signal("");
  tenantId = "tenant_aura";
  loginId = "";
  password = "";

  constructor(readonly staff: StaffAppService, private readonly router: Router) {}

  async login(event?: Event) {
    event?.preventDefault();
    if (this.staff.loading()) return;
    this.message.set("");
    this.staff.logout();
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
