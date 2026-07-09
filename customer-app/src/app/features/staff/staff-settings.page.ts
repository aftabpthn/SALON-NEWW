import { Component, OnInit, signal } from "@angular/core";
import { Router } from "@angular/router";
import { IonSpinner } from "@ionic/angular/standalone";
import { StaffAppService, StaffDashboard } from "../../core/staff-app.service";

@Component({
  standalone: true,
  imports: [IonSpinner],
  template: `
    <section class="page">
      <header class="page-head">
        <div>
          <p class="eyebrow">Settings</p>
          <h1>Staff settings</h1>
          <p>Security, biometric unlock, session and permission context.</p>
        </div>
      </header>

      @if (loading()) { <section class="state"><ion-spinner name="crescent" /> Loading settings...</section> }
      @if (message()) { <section class="notice success">{{ message() }}</section> }
      @if (staff.error()) { <section class="notice">{{ staff.error() }}</section> }

      @if (dashboard(); as data) {
        <section class="grid two">
          <article class="panel">
            <div class="panel-title"><h2>Session</h2><span>{{ staff.hasSavedSession() ? 'active' : 'inactive' }}</span></div>
            <div class="list">
              <div class="row"><strong>Login ID</strong><span>{{ staff.user()?.loginId || '-' }}</span></div>
              <div class="row"><strong>Staff</strong><span>{{ data.staff.fullName || staff.user()?.name || '-' }}</span></div>
              <div class="row"><strong>Role</strong><span>{{ staff.user()?.role || data.staff.roleId }}</span></div>
              <div class="row"><strong>Branch</strong><span>{{ staff.user()?.branchId || '-' }}</span></div>
            </div>
            <div class="row-actions permission-actions">
              <button class="button primary" type="button" (click)="refresh()">Refresh session</button>
              <button class="button" type="button" (click)="logout()">Logout</button>
            </div>
          </article>

          <article class="panel dark">
            <div class="panel-title"><h2>Biometric unlock</h2><span>{{ staff.biometricEnabled() ? 'enabled' : 'off' }}</span></div>
            <p class="muted">Use device fingerprint, face unlock, or secure screen lock to open this staff app on this device.</p>
            <div class="list">
              <div class="row"><strong>Device support</strong><span>{{ staff.biometricSupported() ? 'Available' : 'Not available' }}</span></div>
              <div class="row"><strong>Saved session</strong><span>{{ staff.hasSavedSession() ? 'Ready' : 'Login required' }}</span></div>
            </div>
            <div class="row-actions permission-actions">
              <button class="button primary" type="button" [disabled]="!staff.biometricSupported() || !staff.hasSavedSession()" (click)="toggleBiometric()">
                {{ staff.biometricEnabled() ? 'Turn off biometric' : 'Enable biometric' }}
              </button>
            </div>
          </article>
        </section>

        <section class="panel">
          <div class="panel-title"><h2>Permissions</h2><span>{{ staff.user()?.permissions?.length || 0 }}</span></div>
          <div class="row-actions">
            @for (permission of visiblePermissions(); track permission) { <span class="badge">{{ permission }}</span> }
            @empty { <p class="empty">No permission metadata.</p> }
          </div>
        </section>
      }
    </section>
  `,
  styleUrls: ["./staff-app.styles.css"]
})
export class StaffSettingsPage implements OnInit {
  readonly dashboard = signal<StaffDashboard | null>(null);
  readonly loading = signal(false);
  readonly message = signal("");

  constructor(readonly staff: StaffAppService, private readonly router: Router) {}

  ngOnInit() { void this.load(); }

  async load() {
    this.loading.set(true);
    try {
      this.dashboard.set(await this.staff.dashboard());
    } finally {
      this.loading.set(false);
    }
  }

  visiblePermissions(): string[] {
    return (this.staff.user()?.permissions || []).slice(0, 60);
  }

  async toggleBiometric() {
    try {
      const enabled = !this.staff.biometricEnabled();
      await this.staff.setBiometricEnabled(enabled);
      this.message.set(enabled ? "Biometric unlock enabled." : "Biometric unlock disabled.");
    } catch (error) {
      this.staff.error.set(error instanceof Error ? error.message : "Unable to update biometric unlock.");
    }
  }

  async refresh() {
    await this.load();
    this.message.set("Session refreshed.");
  }

  async logout() {
    this.staff.logout();
    await this.router.navigateByUrl("/staff/login");
  }
}
