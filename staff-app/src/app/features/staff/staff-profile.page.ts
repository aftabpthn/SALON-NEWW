import { Component, OnDestroy, OnInit, signal } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { StaffAppService, StaffDashboard, StaffSelfProfile } from "../../core/staff-app.service";
import { StaffPageStateComponent } from "./staff-page-state.component";
import { StaffPermissionBadgesComponent } from "./staff-permission-badges.component";

@Component({
  standalone: true,
  imports: [FormsModule, StaffPageStateComponent, StaffPermissionBadgesComponent],
  template: `
    <section class="page">
      <header class="page-head">
        <div>
          <p class="eyebrow">Profile</p>
          <h1>{{ staff.user()?.name || dashboard()?.staff?.fullName || 'My profile' }}</h1>
          <p>{{ dashboard()?.staff?.designation || staff.user()?.role || 'Staff' }} · {{ staff.user()?.branchId || 'branch scoped' }}</p>
        </div>
      </header>

      @if (!canReadProfile()) { <section staffPageState class="notice">You do not have permission to view your profile.</section> }
      @if (loading()) { <section staffPageState class="state" [loading]="true">Loading profile...</section> }
      @if (loadError()) { <section staffPageState class="notice"><span>{{ loadError() }}</span><button class="link-button" type="button" [disabled]="loading()" (click)="load()">Retry</button></section> }
      @if (message()) { <section staffPageState class="notice success" role="status">{{ message() }}</section> }

      @if (dashboard(); as data) {
        <section class="grid two">
          <article class="panel">
            <div class="panel-title"><h2>Identity</h2><span>{{ data.staff.status }}</span></div>
            <div class="profile-photo-row">
              @if (photoPreview()) { <img class="profile-photo" [src]="photoPreview()" [alt]="data.staff.fullName" /> }
              @else { <span class="profile-photo fallback" aria-hidden="true">{{ initials(data.staff.fullName) }}</span> }
              <label class="button photo-button" [class.disabled]="!canManageProfile() || savingPhoto()">
                {{ savingPhoto() ? 'Uploading...' : 'Change photo' }}
                <input type="file" accept="image/jpeg,image/png" [disabled]="!canManageProfile() || savingPhoto()" (change)="uploadPhoto($event)" />
              </label>
            </div>
            <div class="list">
              <div class="row"><strong>Staff ID</strong><span>{{ staff.user()?.staffId || data.staff.id }}</span></div>
              <div class="row"><strong>Login ID</strong><span>{{ staff.user()?.loginId || '-' }}</span></div>
              <div class="row"><strong>Role</strong><span>{{ staff.user()?.role || data.staff.roleId }}</span></div>
              <div class="row"><strong>Designation</strong><span>{{ data.staff.designation || '-' }}</span></div>
              <div class="row"><strong>Department</strong><span>{{ data.staff.department || '-' }}</span></div>
            </div>
          </article>

          <article class="panel">
            <div class="panel-title"><h2>Contact</h2><span>{{ contactCount(data) }}/2 configured</span></div>
            <form class="contact-form" (ngSubmit)="saveContact()">
              <label><span>Mobile</span><input name="mobile" [(ngModel)]="contactForm.mobile" autocomplete="tel" inputmode="tel" [disabled]="!canManageProfile() || savingContact()" /></label>
              <label><span>Email</span><input name="email" [(ngModel)]="contactForm.email" autocomplete="email" inputmode="email" [disabled]="!canManageProfile() || savingContact()" /></label>
              @if (staff.securityContext()?.contactVerificationRequired) {
                <p class="verification-note">Verify this change with your authenticator code, or current password when MFA is not enabled.</p>
                <label><span>Authenticator code</span><input name="mfaCode" [(ngModel)]="contactForm.mfaCode" inputmode="numeric" maxlength="12" autocomplete="one-time-code" [disabled]="savingContact()" /></label>
                <label><span>Current password</span><input name="currentPassword" [(ngModel)]="contactForm.currentPassword" type="password" autocomplete="current-password" [disabled]="savingContact()" /></label>
              }
              <div class="verification-status"><span>Email {{ selfProfile()?.emailVerified ? 'verified' : 'not verified' }}</span><span>Phone {{ selfProfile()?.phoneVerified ? 'verified' : 'not verified' }}</span></div>
              @if (selfProfile(); as profile) {
                @if (profile.email && !profile.emailVerified) {
                  <div class="verification-row">
                    <button class="button" type="button" [disabled]="!!verifyingContact()" (click)="requestVerification('email')">Send email code</button>
                    <input name="emailVerificationCode" aria-label="Email verification code" [(ngModel)]="verificationCodes.email" inputmode="numeric" maxlength="6" autocomplete="one-time-code" placeholder="6-digit code" />
                    <button class="button" type="button" [disabled]="!!verifyingContact() || verificationCodes.email.trim().length !== 6" (click)="verifyContact('email')">Verify email</button>
                  </div>
                }
                @if (profile.mobile && !profile.phoneVerified) {
                  <div class="verification-row">
                    <button class="button" type="button" [disabled]="!!verifyingContact()" (click)="requestVerification('phone')">Send phone code</button>
                    <input name="phoneVerificationCode" aria-label="Phone verification code" [(ngModel)]="verificationCodes.phone" inputmode="numeric" maxlength="6" autocomplete="one-time-code" placeholder="6-digit code" />
                    <button class="button" type="button" [disabled]="!!verifyingContact() || verificationCodes.phone.trim().length !== 6" (click)="verifyContact('phone')">Verify phone</button>
                  </div>
                }
              }
              <button class="button primary" type="submit" [disabled]="!canManageProfile() || savingContact()">{{ savingContact() ? 'Saving...' : 'Save contact' }}</button>
            </form>
            <div class="list contact-meta">
              <div class="row"><strong>Branch</strong><span>{{ staff.user()?.branchId || '-' }}</span></div>
              <div class="row"><strong>Status</strong><span>{{ data.staff.status || '-' }}</span></div>
            </div>
          </article>
        </section>

        <section class="panel">
          <div class="panel-title"><h2>Employment lifecycle</h2><span>{{ data.lifecycle['employmentStatus'] || 'confirmed' }}</span></div>
          <div class="list">
            <div class="row"><strong>Reporting manager</strong><span>{{ data.lifecycle['reportingManagerName'] || '-' }}</span></div>
            <div class="row"><strong>Probation end</strong><span>{{ data.lifecycle['probationEndDate'] || '-' }}</span></div>
            <div class="row"><strong>Confirmation date</strong><span>{{ data.lifecycle['confirmationDate'] || '-' }}</span></div>
            <div class="row"><strong>Last working date</strong><span>{{ data.lifecycle['lastWorkingDate'] || '-' }}</span></div>
            @if (activeCase(data); as lifecycle) { <div class="row"><strong>{{ lifecycle['caseType'] }}</strong><span>{{ lifecycle['status'] }} · {{ lifecycle['settlementStatus'] }}</span></div>@if (lifecycle['finalSettlementPayrollRunId']) { <div class="row"><strong>Settlement payroll</strong><span>{{ lifecycle['finalSettlementPayrollRunId'] }}</span></div> } }
          </div>
        </section>

        <section class="panel">
          <div class="panel-title"><h2>Connected permissions</h2><span>{{ visiblePermissions().length }}</span></div>
          <div staffPermissionBadges class="row-actions" [permissions]="visiblePermissions()"></div>
        </section>

        @if (sourceGaps(data).length) {
          <section class="panel">
            <div class="panel-title"><h2>CRM information pending</h2><span>{{ sourceGaps(data).length }}</span></div>
            <div class="list">@for (gap of sourceGaps(data); track gap) { <div class="row"><strong>{{ gap }}</strong><span>Add in CRM Staff</span></div> }</div>
          </section>
        }
      }
    </section>
  `,
  styleUrls: ["./staff-app.styles.css"],
  styles: [`
    .profile-photo-row { display:flex;align-items:center;gap:12px;margin-bottom:12px; }
    .profile-photo { width:72px;height:72px;border:1px solid var(--staff-border);border-radius:18px;object-fit:cover;background:var(--staff-surface-secondary); }
    .profile-photo.fallback { display:grid;place-items:center;color:var(--staff-primary-hover);font-weight:800; }
    .photo-button { position:relative;overflow:hidden;cursor:pointer; }
    .photo-button input { position:absolute;inset:0;opacity:0;cursor:pointer; }
    .photo-button.disabled { opacity:.55;cursor:not-allowed; }
    .contact-form { display:grid;gap:10px; }
    .contact-form label { display:grid;gap:5px;color:var(--staff-text-secondary);font-size:.74rem;font-weight:700; }
    .contact-form input { min-height:42px;padding:0 11px;border:1px solid var(--staff-border);border-radius:12px;background:var(--staff-surface);color:var(--staff-text); }
    .verification-note { margin:0;color:var(--staff-text-secondary);font-size:.76rem; }
    .verification-status { display:flex;flex-wrap:wrap;gap:8px;color:var(--staff-text-secondary);font-size:.72rem;font-weight:700; }
    .verification-row { display:grid;grid-template-columns:auto minmax(110px,1fr) auto;gap:7px;align-items:center; }
    .verification-row .button { min-height:42px; }
    .contact-meta { margin-top:12px; }
    @media (max-width:600px) { .verification-row { grid-template-columns:1fr; } }
  `]
})
export class StaffProfilePage implements OnInit, OnDestroy {
  readonly dashboard = signal<StaffDashboard | null>(null);
  readonly selfProfile = signal<StaffSelfProfile | null>(null);
  readonly photoPreview = signal("");
  readonly loading = signal(false);
  readonly savingContact = signal(false);
  readonly savingPhoto = signal(false);
  readonly verifyingContact = signal<"" | "email" | "phone">("");
  readonly loadError = signal("");
  readonly message = signal("");
  contactForm = { email: "", mobile: "", mfaCode: "", currentPassword: "" };
  verificationCodes = { email: "", phone: "" };
  private photoObjectUrl = "";

  constructor(readonly staff: StaffAppService) {}

  ngOnInit() { if (this.canReadProfile()) void this.load(); }

  async load() {
    if (!this.canReadProfile()) return;
    this.loading.set(true);
    this.loadError.set("");
    try {
      const [dashboard, profile] = await Promise.all([this.staff.dashboard(), this.staff.selfProfile()]);
      this.dashboard.set(dashboard);
      this.selfProfile.set(profile);
      this.contactForm = { email: profile.email, mobile: profile.mobile, mfaCode: "", currentPassword: "" };
      await this.loadPhoto(profile.photoUrl);
    } catch {
      this.loadError.set(this.staff.error() || "Unable to load profile.");
    } finally {
      this.loading.set(false);
    }
  }

  canReadProfile(): boolean { return this.staff.hasPermission("staff.app.profile.read"); }
  canManageProfile(): boolean { return this.staff.hasPermission("staff.app.profile.manage"); }

  async saveContact() {
    if (!this.canManageProfile() || this.savingContact()) return;
    this.savingContact.set(true);
    this.message.set("");
    this.loadError.set("");
    try {
      const profile = await this.staff.updateSelfProfile({
        email: this.contactForm.email.trim(),
        mobile: this.contactForm.mobile.trim(),
        mfaCode: this.contactForm.mfaCode.trim() || undefined,
        currentPassword: this.contactForm.currentPassword || undefined
      });
      this.selfProfile.set(profile);
      this.contactForm.mfaCode = "";
      this.contactForm.currentPassword = "";
      await this.load();
      this.message.set("Profile contact updated.");
    } catch { this.loadError.set(this.staff.error() || "Unable to update profile contact."); }
    finally { this.savingContact.set(false); }
  }

  async uploadPhoto(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = "";
    if (!file || !this.canManageProfile() || this.savingPhoto()) return;
    this.savingPhoto.set(true);
    this.message.set("");
    this.loadError.set("");
    try {
      await this.staff.uploadSelfProfilePhoto(file);
      await this.load();
      this.message.set("Profile photo updated.");
    } catch (error) { this.loadError.set(error instanceof Error ? error.message : "Unable to upload profile photo."); }
    finally { this.savingPhoto.set(false); }
  }

  async requestVerification(contactType: "email" | "phone") {
    if (!this.canManageProfile() || this.verifyingContact()) return;
    this.verifyingContact.set(contactType);
    this.loadError.set("");
    try {
      const result = await this.staff.requestContactVerification(contactType);
      this.message.set(`Verification code sent to ${result.target}.`);
    } catch (error) { this.loadError.set(error instanceof Error ? error.message : "Unable to send verification code."); }
    finally { this.verifyingContact.set(""); }
  }

  async verifyContact(contactType: "email" | "phone") {
    if (!this.canManageProfile() || this.verifyingContact()) return;
    this.verifyingContact.set(contactType);
    this.loadError.set("");
    try {
      await this.staff.verifyContactVerification(contactType, this.verificationCodes[contactType].trim());
      this.verificationCodes[contactType] = "";
      await this.load();
      this.message.set(`${contactType === "email" ? "Email" : "Phone"} verified.`);
    } catch (error) { this.loadError.set(error instanceof Error ? error.message : "Unable to verify contact."); }
    finally { this.verifyingContact.set(""); }
  }

  initials(name: string): string { return name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "S"; }

  ngOnDestroy() { if (this.photoObjectUrl) URL.revokeObjectURL(this.photoObjectUrl); }

  contactCount(data: StaffDashboard): number { return Number(!!data.staff.mobile) + Number(!!data.staff.email); }

  activeCase(data: StaffDashboard): Record<string, unknown> | null {
    const value = data.lifecycle['activeCase'];
    return value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length ? value as Record<string, unknown> : null;
  }

  sourceGaps(data: StaffDashboard): string[] {
    const gaps: string[] = [];
    if (!data.staff.designation || !data.staff.department) gaps.push("Designation or department");
    if (!data.staff.mobile || !data.staff.email) gaps.push("Mobile or email");
    if (!this.staff.user()?.loginId) gaps.push("Staff App login ID");
    return gaps;
  }

  visiblePermissions(): string[] {
    return (this.staff.user()?.permissions || []).slice(0, 36);
  }

  private async loadPhoto(photoUrl: string) {
    if (this.photoObjectUrl) URL.revokeObjectURL(this.photoObjectUrl);
    this.photoObjectUrl = "";
    if (!photoUrl) { this.photoPreview.set(""); return; }
    const fileId = photoUrl.startsWith("/staff/files/") ? photoUrl.split("/").pop() || "" : "";
    if (!fileId) { this.photoPreview.set(photoUrl); return; }
    try {
      this.photoObjectUrl = URL.createObjectURL(await this.staff.selfProfilePhoto(fileId));
      this.photoPreview.set(this.photoObjectUrl);
    } catch { this.photoPreview.set(""); }
  }
}
