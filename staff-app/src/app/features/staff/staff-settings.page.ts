import { Component, HostListener, OnInit, signal } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { Router } from "@angular/router";
import { StaffAppService, StaffDashboard, StaffWorkspacePreferences, StaffWorkspacePreferenceUpdate } from "../../core/staff-app.service";
import { StaffPageStateComponent } from "./staff-page-state.component";
import { StaffPermissionBadgesComponent } from "./staff-permission-badges.component";

@Component({
  standalone: true,
  imports: [FormsModule, StaffPageStateComponent, StaffPermissionBadgesComponent],
  template: `
    <section class="page">
      <header class="page-head">
        <div>
          <p class="eyebrow">Settings</p>
          <h1>Staff settings</h1>
          <p>Session, permissions, biometric unlock, and workspace preferences.</p>
        </div>
      </header>

      @if (!canReadSettings()) { <section staffPageState class="notice">You do not have permission to view staff settings.</section> }
      @if (loading() && !dashboard()) {
        <section class="settings-skeleton" aria-label="Loading settings">
          <div class="skeleton-grid"><span class="skeleton"></span><span class="skeleton"></span></div>
          <span class="skeleton settings-list-skeleton"></span>
        </section>
      }
      @if (loadError()) { <section staffPageState class="notice settings-error"><span>{{ loadError() }}</span><button class="link-button" type="button" [disabled]="loading()" [attr.aria-busy]="loading()" (click)="load()">Retry</button></section> }
      @if (message()) { <section staffPageState class="notice success" role="status">{{ message() }}</section> }
      @if (localError()) { <section staffPageState class="notice">{{ localError() }}</section> }
      @if (staff.error() && !loadError() && !localError()) { <section staffPageState class="notice">{{ staff.error() }}</section> }

      @if (canReadSettings() && dashboard(); as data) {
        <section class="grid two settings-layout">
          <article class="panel">
            <div class="panel-title"><h2>Session</h2><span>{{ staff.hasSavedSession() ? 'Active' : 'Inactive' }}</span></div>
            <div class="list">
              <div class="row"><strong>Login ID</strong><span>{{ staff.user()?.loginId || '-' }}</span></div>
              <div class="row"><strong>Staff</strong><span>{{ staff.user()?.name || data.staff.fullName || '-' }}</span></div>
              <div class="row"><strong>Role</strong><span>{{ staff.user()?.role || data.staff.roleId || '-' }}</span></div>
              <div class="row"><strong>Branch</strong><span>{{ staff.user()?.branchId || '-' }}</span></div>
            </div>
            <div class="row-actions permission-actions settings-actions">
              <button class="button primary" type="button" [disabled]="loading() || loggingOut()" [attr.aria-busy]="loading()" (click)="refresh()">{{ loading() ? 'Refreshing...' : 'Refresh session' }}</button>
              <button class="button" type="button" [disabled]="loggingOut()" [attr.aria-busy]="loggingOut()" (click)="logout()">{{ loggingOut() ? 'Logging out...' : 'Logout' }}</button>
            </div>
          </article>

          <div class="security-stack">
            <article class="panel dark biometric-panel">
              <div class="panel-title">
                <h2>Biometric unlock</h2>
                <button
                  class="biometric-switch"
                  type="button"
                  role="switch"
                  [attr.aria-checked]="staff.biometricEnabled()"
                  [attr.aria-busy]="savingBiometric()"
                  aria-label="Biometric unlock"
                  [disabled]="savingBiometric() || !staff.biometricSupported() || !staff.hasSavedSession()"
                  (click)="toggleBiometric()"
                ><span aria-hidden="true"></span></button>
              </div>
              <div class="biometric-meta"><span>Device support</span><strong>{{ staff.biometricSupported() ? 'Available' : 'Not available' }}</strong></div>
            </article>

            <details class="panel permission-panel">
              <summary><strong>Permissions</strong><span>{{ staff.user()?.permissions?.length || 0 }}</span></summary>
              <div staffPermissionBadges class="row-actions permission-list" [permissions]="visiblePermissions()"></div>
            </details>
          </div>
        </section>

        @if (preferences(); as prefs) {
          <section class="panel preferences-panel">
            <div class="panel-title"><h2>Workspace preferences</h2><span>{{ savingPreferences() ? 'Saving...' : prefs.localization.timezone }}</span></div>
            <form class="preferences-grid" (ngSubmit)="savePreferences()">
              <label>
                <span>Workspace</span>
                <input name="workspaceName" [(ngModel)]="preferenceForm.workspaceName" maxlength="80" [disabled]="savingPreferences()" [attr.aria-invalid]="!workspaceNameValid()" />
              </label>
              <label>
                <span>Timezone</span>
                <select name="timezone" [(ngModel)]="preferenceForm.timezone" [disabled]="savingPreferences()">
                  @for (timezone of timezones; track timezone) { <option [value]="timezone">{{ timezone }}</option> }
                </select>
              </label>
              <label>
                <span>Locale</span>
                <select name="locale" [(ngModel)]="preferenceForm.locale" [disabled]="savingPreferences()">
                  <option value="en-IN">English India</option>
                  <option value="en-US">English US</option>
                </select>
              </label>
              <label>
                <span>Date format</span>
                <select name="dateFormat" [(ngModel)]="preferenceForm.dateFormat" [disabled]="savingPreferences()">
                  <option value="DD/MM/YYYY">DD/MM/YYYY</option>
                  <option value="YYYY-MM-DD">YYYY-MM-DD</option>
                  <option value="MM/DD/YYYY">MM/DD/YYYY</option>
                </select>
              </label>
              <label>
                <span>Time format</span>
                <select name="timeFormat" [(ngModel)]="preferenceForm.timeFormat" [disabled]="savingPreferences()">
                  <option value="HH:mm">24 hour</option>
                  <option value="hh:mm a">12 hour</option>
                </select>
              </label>
              <label class="check-row">
                <input type="checkbox" name="compactMode" [(ngModel)]="preferenceForm.compactMode" [disabled]="savingPreferences()" />
                <span>Compact mode</span>
              </label>
              <label class="check-row">
                <input type="checkbox" name="staffHints" [(ngModel)]="preferenceForm.staffHints" [disabled]="savingPreferences()" />
                <span>Staff hints</span>
              </label>
              <div class="row-actions preference-actions">
                <button class="button primary" type="submit" [disabled]="savingPreferences() || !canSavePreferences()" [attr.aria-busy]="savingPreferences()">{{ savingPreferences() ? 'Saving...' : 'Save preferences' }}</button>
              </div>
            </form>
          </section>
        }
      }
    </section>
  `,
  styleUrls: ["./staff-app.styles.css"],
  styles: [`
    .settings-skeleton { display: grid; gap: 12px; }
    .settings-list-skeleton { min-height: 260px; }
    .settings-error { justify-content: space-between; }
    .security-stack { display: flex; flex-direction: column; align-self: start; gap: 8px; min-width: 0; width: 100%; }
    .biometric-panel { padding: 12px 14px; border-radius: 16px; }
    .biometric-panel .panel-title { min-height: 24px; margin: 0; align-items: center; }
    .biometric-panel .panel-title h2 { font-size: .92rem; }
    .biometric-meta { display: flex; justify-content: space-between; gap: 12px; margin-top: 5px; color: var(--staff-text-secondary); font-size: .72rem; }
    .biometric-meta strong { color: inherit; font-weight: 650; }
    .biometric-switch { position: relative; width: 36px; height: 20px; flex: 0 0 36px; padding: 0; border: 1px solid var(--staff-border-accent); border-radius: 999px; background: var(--staff-surface-secondary); cursor: pointer; transition: background-color 180ms ease, border-color 180ms ease; }
    .biometric-switch span { position: absolute; top: 2px; left: 2px; width: 14px; height: 14px; border-radius: 50%; background: var(--staff-text-secondary); transition: transform 180ms ease, background-color 180ms ease; }
    .biometric-switch[aria-checked="true"] { border-color: var(--staff-primary); background: var(--staff-primary); }
    .biometric-switch[aria-checked="true"] span { transform: translateX(16px); background: var(--staff-on-primary); }
    .biometric-switch:focus-visible { outline: 3px solid var(--staff-focus-ring); outline-offset: 3px; }
    .biometric-switch:disabled { opacity: .55; cursor: not-allowed; }
    .permission-panel { width: 100%; min-width: 0; margin: 0; padding: 0; border-radius: 16px; box-sizing: border-box; }
    .permission-panel summary { display: flex; align-items: center; justify-content: space-between; width: 100%; min-height: 58px; padding: 12px 14px; list-style: none; box-sizing: border-box; cursor: pointer; }
    .permission-panel summary::-webkit-details-marker { display: none; }
    .permission-panel summary strong { color: var(--staff-text); font-size: .92rem; }
    .permission-panel summary span { color: var(--staff-text-secondary); font-size: .72rem; font-weight: 700; }
    .permission-panel summary:focus-visible { outline: 3px solid var(--staff-focus-ring); outline-offset: 2px; border-radius: 14px; }
    .permission-list { justify-content: flex-start; padding: 0 14px 12px; border-top: 1px solid var(--staff-border); }
    .permission-panel[open] .permission-list { padding-top: 10px; }
    .preferences-panel { margin-top: 10px; }
    .preferences-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; align-items: end; }
    .preferences-grid label { display: flex; flex-direction: column; gap: 5px; min-width: 0; color: var(--staff-text-secondary); font-size: .72rem; font-weight: 700; }
    .preferences-grid input, .preferences-grid select { width: 100%; min-height: 38px; border: 1px solid var(--staff-border); border-radius: 12px; padding: 0 10px; color: var(--staff-text); background: var(--staff-surface); box-sizing: border-box; }
    .preferences-grid input[aria-invalid="true"] { border-color: var(--staff-error); background: var(--staff-input-error-background); }
    .check-row { flex-direction: row !important; align-items: center; min-height: 38px; }
    .check-row input { width: 16px; min-height: 16px; }
    .preference-actions { justify-content: flex-end; }
    @media (max-width: 820px) { .preferences-grid { grid-template-columns: 1fr 1fr; } }
    @media (max-width: 700px) {
      .settings-error, .settings-actions, .preference-actions { align-items: stretch; flex-direction: column; }
      .settings-error button, .settings-actions .button, .preference-actions .button { width: 100%; }
      .settings-layout { gap: 14px; }
    }
    @media (max-width: 520px) { .preferences-grid { grid-template-columns: 1fr; } }
    @media (prefers-reduced-motion: reduce) { .biometric-switch, .biometric-switch span { transition: none; } }
  `]
})
export class StaffSettingsPage implements OnInit {
  readonly dashboard = signal<StaffDashboard | null>(null);
  readonly preferences = signal<StaffWorkspacePreferences | null>(null);
  readonly loading = signal(false);
  readonly savingPreferences = signal(false);
  readonly savingBiometric = signal(false);
  readonly loggingOut = signal(false);
  readonly message = signal("");
  readonly localError = signal("");
  readonly loadError = signal("");
  readonly timezones = ["Asia/Kolkata", "UTC", "Asia/Dubai", "Europe/London", "America/New_York"];
  preferenceForm: StaffWorkspacePreferenceUpdate = {};

  constructor(readonly staff: StaffAppService, private readonly router: Router) {}

  ngOnInit() { if (this.canReadSettings()) void this.load(); }

  async load() {
    if (!this.canReadSettings()) {
      this.dashboard.set(null);
      this.preferences.set(null);
      return;
    }
    this.loading.set(true);
    this.loadError.set("");
    try {
      const [dashboard, preferences] = await Promise.all([
        this.staff.dashboard(),
        this.staff.workspacePreferences()
      ]);
      this.dashboard.set(dashboard);
      this.setPreferences(preferences);
      this.applyCompactMode(preferences);
    } catch {
      this.loadError.set(this.staff.error() || "Unable to load settings.");
    } finally {
      this.loading.set(false);
    }
  }

  @HostListener("window:aura:preferences-updated", ["$event"])
  onPreferencesUpdated(event: CustomEvent<StaffWorkspacePreferences>) {
    if (event.detail) {
      this.setPreferences(event.detail);
      this.applyCompactMode(event.detail);
    }
  }

  canReadSettings(): boolean {
    return this.staff.hasPermission("staff.app.settings.read");
  }

  workspaceNameValid(): boolean {
    return (this.preferenceForm.workspaceName || "").trim().length <= 80;
  }

  canSavePreferences(): boolean {
    return this.workspaceNameValid() && !this.savingPreferences();
  }

  visiblePermissions(): string[] {
    return (this.staff.user()?.permissions || []).slice(0, 60);
  }

  async toggleBiometric() {
    if (this.savingBiometric()) return;
    this.message.set("");
    this.localError.set("");
    this.savingBiometric.set(true);
    try {
      const enabled = !this.staff.biometricEnabled();
      await this.staff.setBiometricEnabled(enabled);
      this.message.set(enabled ? "Biometric unlock enabled." : "Biometric unlock disabled.");
    } catch (error) {
      this.localError.set(error instanceof Error ? error.message : "Unable to update biometric unlock.");
    } finally {
      this.savingBiometric.set(false);
    }
  }

  async refresh() {
    this.message.set("");
    this.localError.set("");
    await this.load();
    if (!this.loadError()) this.message.set("Session refreshed.");
  }

  async savePreferences() {
    this.message.set("");
    this.localError.set("");
    if (!this.canSavePreferences()) {
      this.localError.set("Workspace name must be 80 characters or less.");
      return;
    }
    this.savingPreferences.set(true);
    try {
      const saved = await this.staff.saveWorkspacePreferences({
        ...this.preferenceForm,
        workspaceName: this.preferenceForm.workspaceName?.trim(),
        timezone: this.preferenceForm.timezone?.trim(),
        locale: this.preferenceForm.locale?.trim(),
        dateFormat: this.preferenceForm.dateFormat?.trim(),
        timeFormat: this.preferenceForm.timeFormat?.trim()
      });
      this.setPreferences(saved);
      this.applyCompactMode(saved);
      this.message.set("Preferences saved.");
    } catch {
      this.localError.set(this.staff.error() || "Unable to save preferences.");
    } finally {
      this.savingPreferences.set(false);
    }
  }

  async logout() {
    if (this.loggingOut()) return;
    this.loggingOut.set(true);
    try {
      await this.staff.logout();
      await this.router.navigateByUrl("/staff/login");
    } finally {
      this.loggingOut.set(false);
    }
  }

  private setPreferences(preferences: StaffWorkspacePreferences) {
    this.preferences.set(preferences);
    this.preferenceForm = {
      workspaceName: preferences.workspace.workspaceName,
      timezone: preferences.localization.timezone,
      locale: preferences.localization.locale,
      dateFormat: preferences.dateTime.dateFormat,
      timeFormat: preferences.dateTime.timeFormat,
      compactMode: preferences.interface.compactMode,
      staffHints: preferences.defaults.staffHints
    };
  }

  private applyCompactMode(preferences: StaffWorkspacePreferences) {
    document.documentElement.dataset["staffCompactMode"] = preferences.interface.compactMode ? "true" : "false";
  }
}