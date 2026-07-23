import { Component, effect, signal, untracked } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { OwnerAppService } from "./owner-app.service";
import { OwnerContextService } from "./owner-context.service";
import {
  OwnerAttendanceDevice,
  OwnerAttendanceDeviceStatus,
  OwnerAttendanceEvidence,
  OwnerAttendanceEvidenceDecision,
  OwnerAttendancePolicy
} from "./owner-people.models";

const DEFAULT_POLICY: OwnerAttendancePolicy = {
  latitude: 0,
  longitude: 0,
  radiusMeters: 50,
  maxAccuracyMeters: 50,
  requireLocation: true,
  requireBiometric: true,
  enforceClockIn: true,
  enforceClockOut: true,
  status: "enabled",
  version: 0
};

@Component({
  selector: "owner-attendance-verification",
  standalone: true,
  imports: [FormsModule],
  template: `
    <section class="verification" aria-labelledby="verification-title">
      <header class="verification-head">
        <div>
          <p class="eyebrow">Secure punch controls</p>
          <h2 id="verification-title">Location & biometric verification</h2>
          <p>Configure branch rules, review enrolled devices and inspect the evidence captured with each punch.</p>
        </div>
        <span class="scope-chip">{{ context.selectedBranch()?.name || 'Select one branch' }}</span>
      </header>

      @if (!branchId()) {
        <div class="verification-state" role="status">
          <strong>Select a branch to manage verification</strong>
          <p>Security policy, trusted devices and punch evidence are always scoped to one branch.</p>
        </div>
      } @else {
        <div class="verification-grid">
          <section class="security-panel policy-panel" [attr.aria-busy]="policyLoading()">
            <header class="section-head">
              <div><span>01</span><div><h3>Verification policy</h3><p>Allowed punch location and enforcement rules</p></div></div>
              <label class="status-toggle"><input type="checkbox" [checked]="policy().status === 'enabled'" (change)="setPolicyStatus($event)"><span>Enabled</span></label>
            </header>

            @if (policyLoading()) {
              <div class="panel-loading" aria-label="Loading verification policy"><i></i><i></i><i></i></div>
            } @else {
              @if (policyError()) { <p class="inline-message error" role="alert">{{ policyError() }}</p> }
              <div class="coordinate-grid">
                <label>Latitude<input type="number" step="any" min="-90" max="90" [ngModel]="policy().latitude" (ngModelChange)="updatePolicy('latitude', $event)" inputmode="decimal"></label>
                <label>Longitude<input type="number" step="any" min="-180" max="180" [ngModel]="policy().longitude" (ngModelChange)="updatePolicy('longitude', $event)" inputmode="decimal"></label>
              </div>
              <div class="location-actions">
                <button type="button" class="small-button" (click)="useCurrentLocation()" [disabled]="locating()">{{ locating() ? 'Locating…' : 'Use current location' }}</button>
                @if (hasCoordinates()) { <a [href]="osmUrl(policy().latitude, policy().longitude)" target="_blank" rel="noopener noreferrer">Preview on OpenStreetMap <span aria-hidden="true">↗</span></a> }
              </div>
              @if (locationMessage()) { <p class="inline-message" [class.error]="locationError()" [attr.role]="locationError() ? 'alert' : 'status'">{{ locationMessage() }}</p> }

              <div class="range-field">
                <div><label for="attendance-radius">Allowed radius</label><output for="attendance-radius attendance-radius-number">{{ policy().radiusMeters }} m</output></div>
                <input id="attendance-radius" type="range" min="25" max="500" step="5" [ngModel]="policy().radiusMeters" (ngModelChange)="updatePolicy('radiusMeters', $event)">
                <label class="number-field" for="attendance-radius-number">Exact radius<input id="attendance-radius-number" type="number" min="25" max="500" [ngModel]="policy().radiusMeters" (ngModelChange)="updatePolicy('radiusMeters', $event)"></label>
              </div>
              <label class="accuracy-field">Maximum accepted GPS accuracy (metres)<input type="number" min="1" step="1" [ngModel]="policy().maxAccuracyMeters" (ngModelChange)="updatePolicy('maxAccuracyMeters', $event)"></label>

              <fieldset class="rule-list">
                <legend>Required verification</legend>
                <label><input type="checkbox" [checked]="policy().requireLocation" (change)="togglePolicy('requireLocation', $event)"><span><strong>Location</strong><small>Require coordinates within the allowed radius.</small></span></label>
                <label><input type="checkbox" [checked]="policy().requireBiometric" (change)="togglePolicy('requireBiometric', $event)"><span><strong>Biometric</strong><small>Require successful device biometric verification.</small></span></label>
                <label><input type="checkbox" [checked]="policy().enforceClockIn" (change)="togglePolicy('enforceClockIn', $event)"><span><strong>Enforce clock-in</strong><small>Apply verification checks when a shift starts.</small></span></label>
                <label><input type="checkbox" [checked]="policy().enforceClockOut" (change)="togglePolicy('enforceClockOut', $event)"><span><strong>Enforce clock-out</strong><small>Apply verification checks when a shift ends.</small></span></label>
              </fieldset>
              <footer class="panel-actions">
                <span class="save-state" [class.error-text]="policyMessageError()" [attr.role]="policyMessageError() ? 'alert' : 'status'">{{ policyMessage() }}</span>
                <button type="button" class="button primary" (click)="savePolicy()" [disabled]="policySaving() || !!policyError() || !policyValid()">{{ policySaving() ? 'Saving…' : 'Save policy' }}</button>
              </footer>
            }
          </section>

          <section class="security-panel devices-panel" [attr.aria-busy]="devicesLoading()">
            <header class="section-head stacked">
              <div><span>02</span><div><h3>Trusted devices</h3><p>Approve registrations and revoke lost devices</p></div></div>
              <label>Device status<select [ngModel]="deviceStatus()" (ngModelChange)="deviceStatus.set($event); loadDevices()"><option value="">All devices</option><option value="pending">Pending review</option><option value="trusted">Trusted</option><option value="revoked">Revoked</option></select></label>
            </header>
            @if (deviceMessage()) { <p class="inline-message" [class.error]="deviceMessageError()" [attr.role]="deviceMessageError() ? 'alert' : 'status'">{{ deviceMessage() }}</p> }
            @if (devicesLoading()) {
              <div class="panel-loading" aria-label="Loading registered devices"><i></i><i></i></div>
            } @else if (devicesError()) {
              <div class="compact-state"><p role="alert">{{ devicesError() }}</p><button class="small-button" (click)="loadDevices()">Try again</button></div>
            } @else if (!devices().length) {
              <div class="compact-state"><strong>No registered devices</strong><p>No devices match this branch and status.</p></div>
            } @else {
              <div class="device-list">
                @for (device of devices(); track device.id) {
                  <article class="device-card">
                    <header><div><strong>{{ device.staffName }}</strong><span>{{ device.deviceLabel || 'Unnamed device' }} · {{ device.platform || 'Platform unavailable' }}</span></div><span class="state-badge" [attr.data-tone]="device.status">{{ label(device.status) }}</span></header>
                    <dl><div><dt>Fingerprint</dt><dd class="fingerprint">{{ device.publicKeyFingerprint }}</dd></div><div><dt>Registered</dt><dd>{{ dateTime(device.registeredAt) }}</dd></div><div><dt>Last used</dt><dd>{{ device.lastUsedAt ? dateTime(device.lastUsedAt) : 'Never' }}</dd></div></dl>
                    <footer>
                      @if (device.status !== 'trusted') { <button class="small-button primary" [disabled]="deviceBusy() === device.id" (click)="changeDeviceStatus(device, 'trusted')">{{ deviceBusy() === device.id ? 'Updating…' : 'Approve' }}</button> }
                      @if (device.status !== 'revoked') { <button class="small-button danger" [disabled]="deviceBusy() === device.id" (click)="changeDeviceStatus(device, 'revoked')">Revoke</button> }
                    </footer>
                  </article>
                }
              </div>
            }
          </section>
        </div>

        <section class="security-panel evidence-panel" [attr.aria-busy]="evidenceLoading()">
          <header class="section-head evidence-head">
            <div><span>03</span><div><h3>Punch evidence</h3><p>Verification captured alongside attendance attempts</p></div></div>
            <div class="evidence-filters">
              <label>Staff<select [ngModel]="evidenceStaffId()" (ngModelChange)="evidenceStaffId.set($event); loadEvidence()"><option value="">All staff</option>@for (staff of evidenceStaff(); track staff.id) { <option [value]="staff.id">{{ staff.name }}</option> }</select></label>
              <label>Decision<select [ngModel]="evidenceDecision()" (ngModelChange)="evidenceDecision.set($event); loadEvidence()"><option value="">All decisions</option><option value="accepted">Accepted</option><option value="rejected">Rejected</option><option value="overridden">Overridden</option></select></label>
              <button type="button" class="small-button" (click)="loadEvidence()" [disabled]="evidenceLoading()">Refresh</button>
            </div>
          </header>
          @if (evidenceMessage()) { <p class="inline-message" [class.error]="evidenceMessageError()" [attr.role]="evidenceMessageError() ? 'alert' : 'status'">{{ evidenceMessage() }}</p> }
          @if (evidenceLoading()) {
            <div class="panel-loading evidence-loading" aria-label="Loading punch evidence"><i></i><i></i><i></i></div>
          } @else if (evidenceError()) {
            <div class="compact-state"><p role="alert">{{ evidenceError() }}</p><button class="small-button" (click)="loadEvidence()">Try again</button></div>
          } @else if (!evidence().length) {
            <div class="compact-state"><strong>No punch evidence</strong><p>No verification attempts match this branch, period and filters.</p></div>
          } @else {
            <div class="evidence-list">
              @for (item of evidence(); track item.id) {
                <article class="evidence-card">
                  <header><div><strong>{{ item.staffName }}</strong><span>{{ label(item.action) }} · {{ dateTime(item.capturedAt) }}</span></div><span class="state-badge" [attr.data-tone]="item.decision">{{ label(item.decision) }}</span></header>
                  <div class="evidence-facts">
                    <div><span>Coordinates</span><strong>{{ item.latitude === null || item.longitude === null ? 'Not captured' : item.latitude + ', ' + item.longitude }}</strong>@if (item.latitude !== null && item.longitude !== null) { <a [href]="osmUrl(item.latitude, item.longitude)" target="_blank" rel="noopener noreferrer">View location ↗</a> }</div>
                    <div><span>Distance</span><strong>{{ item.distanceMeters === null ? 'Not evaluated' : item.distanceMeters + ' m' }}</strong><small>{{ item.accuracyMeters === null ? 'GPS accuracy unavailable' : item.accuracyMeters + ' m GPS accuracy' }}</small></div>
                    <div><span>Device</span><strong>{{ item.deviceVerified ? 'Verified' : 'Not verified' }}</strong><small>Biometric {{ item.biometricVerified ? 'verified' : 'not verified' }}</small></div>
                    <div><span>Attendance</span><strong>{{ item.attendanceId || 'No saved punch' }}</strong><small>{{ item.reason || 'No rejection reason' }}</small></div>
                  </div>
                  @if (item.decision === 'overridden') { <p class="override-note"><strong>Owner override:</strong> {{ overrideReason(item) }}</p> }
                  @if (item.decision === 'rejected') {
                    @if (overrideId() === item.id) {
                      <div class="override-form">
                        <p><strong>Warning:</strong> overriding accepts this rejected attempt for attendance review. The original evidence remains recorded.</p>
                        <label [for]="'override-reason-' + item.id">Mandatory reason<textarea [id]="'override-reason-' + item.id" [(ngModel)]="overrideReasonDraft" placeholder="Explain why this rejected attempt should be accepted"></textarea></label>
                        <div><button class="small-button" (click)="cancelOverride()" [disabled]="overrideBusy()">Cancel</button><button class="small-button primary" (click)="submitOverride(item)" [disabled]="overrideBusy() || !overrideReasonDraft.trim()">{{ overrideBusy() ? 'Overriding…' : 'Confirm override' }}</button></div>
                      </div>
                    } @else {
                      <footer><button class="small-button warning" (click)="beginOverride(item)">Review & override</button></footer>
                    }
                  }
                </article>
              }
            </div>
          }
        </section>
      }
    </section>
  `,
  styleUrls: ["./owner-attendance-verification.component.css"]
})
export class OwnerAttendanceVerificationComponent {
  readonly branchId = signal("");
  readonly policy = signal<OwnerAttendancePolicy>({ ...DEFAULT_POLICY });
  readonly policyLoading = signal(false);
  readonly policySaving = signal(false);
  readonly policyError = signal("");
  readonly policyMessage = signal("");
  readonly policyMessageError = signal(false);
  readonly locating = signal(false);
  readonly locationMessage = signal("");
  readonly locationError = signal(false);

  readonly devices = signal<OwnerAttendanceDevice[]>([]);
  readonly deviceStatus = signal<OwnerAttendanceDeviceStatus | "">("");
  readonly devicesLoading = signal(false);
  readonly devicesError = signal("");
  readonly deviceBusy = signal("");
  readonly deviceMessage = signal("");
  readonly deviceMessageError = signal(false);

  readonly evidence = signal<OwnerAttendanceEvidence[]>([]);
  readonly evidenceLoading = signal(false);
  readonly evidenceError = signal("");
  readonly evidenceDecision = signal<OwnerAttendanceEvidenceDecision | "">("");
  readonly evidenceStaffId = signal("");
  readonly evidenceMessage = signal("");
  readonly evidenceMessageError = signal(false);
  readonly overrideId = signal("");
  readonly overrideBusy = signal(false);
  overrideReasonDraft = "";

  private policyRequest = 0;
  private devicesRequest = 0;
  private evidenceRequest = 0;

  constructor(private readonly api: OwnerAppService, readonly context: OwnerContextService) {
    effect(() => {
      const branchId = context.selectedBranchId();
      const range = context.periodRange();
      untracked(() => {
        this.branchId.set(branchId);
        this.resetBranchState();
        if (branchId) {
          void this.loadPolicy();
          void this.loadDevices();
          void this.loadEvidence(branchId, range.start, range.end);
        }
      });
    });
  }

  evidenceStaff(): { id: string; name: string }[] {
    const staff = new Map<string, string>();
    for (const item of [...this.evidence(), ...this.devices()]) staff.set(item.staffId, item.staffName);
    return [...staff].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }

  updatePolicy(key: "latitude" | "longitude" | "radiusMeters" | "maxAccuracyMeters", value: number | string): void {
    this.policy.update(policy => ({ ...policy, [key]: Number(value) }));
    this.policyMessage.set("");
  }

  togglePolicy(key: "requireLocation" | "requireBiometric" | "enforceClockIn" | "enforceClockOut", event: Event): void {
    this.policy.update(policy => ({ ...policy, [key]: (event.target as HTMLInputElement).checked }));
    this.policyMessage.set("");
  }

  setPolicyStatus(event: Event): void {
    this.policy.update(policy => ({ ...policy, status: (event.target as HTMLInputElement).checked ? "enabled" : "disabled" }));
    this.policyMessage.set("");
  }

  hasCoordinates(): boolean { const { latitude, longitude } = this.policy(); return typeof latitude === "number" && typeof longitude === "number" && Number.isFinite(latitude) && Number.isFinite(longitude) && (latitude !== 0 || longitude !== 0); }
  policyValid(): boolean {
    const value = this.policy();
    const coordinatesValid = typeof value.latitude === "number" && value.latitude >= -90 && value.latitude <= 90 && typeof value.longitude === "number" && value.longitude >= -180 && value.longitude <= 180;
    return coordinatesValid && Number.isFinite(value.radiusMeters) && value.radiusMeters >= 25 && value.radiusMeters <= 500 && Number.isFinite(value.maxAccuracyMeters) && value.maxAccuracyMeters > 0;
  }

  async loadPolicy(): Promise<void> {
    const branchId = this.branchId();
    if (!branchId) return;
    const request = ++this.policyRequest;
    this.policyLoading.set(true);
    this.policyError.set("");
    this.policyMessage.set("");
    this.policyMessageError.set(false);
    try {
      const policy = await this.api.ownerAttendancePolicy(branchId);
      if (request === this.policyRequest && branchId === this.branchId()) this.policy.set({ ...DEFAULT_POLICY, ...policy });
    } catch {
      if (request === this.policyRequest) this.policyError.set("Verification policy could not be loaded. Refresh before making changes.");
    } finally {
      if (request === this.policyRequest) this.policyLoading.set(false);
    }
  }

  async savePolicy(): Promise<void> {
    const branchId = this.branchId();
    if (!branchId || !this.policyValid() || this.policySaving()) return;
    this.policySaving.set(true);
    this.policyMessage.set("");
    try {
      const saved = await this.api.saveOwnerAttendancePolicy(branchId, this.policy());
      if (branchId === this.branchId()) {
        this.policy.set({ ...DEFAULT_POLICY, ...saved });
        this.policyMessageError.set(false);
        this.policyMessage.set("Policy saved for this branch.");
      }
    } catch {
      this.policyMessageError.set(true);
      this.policyMessage.set("Policy was not saved. It may have changed elsewhere; refresh and try again.");
    } finally {
      this.policySaving.set(false);
    }
  }

  useCurrentLocation(): void {
    if (!navigator.geolocation) {
      this.locationError.set(true);
      this.locationMessage.set("Location is not available in this browser.");
      return;
    }
    this.locating.set(true);
    this.locationError.set(false);
    this.locationMessage.set("Requesting precise browser location…");
    navigator.geolocation.getCurrentPosition(position => {
      this.policy.update(policy => ({ ...policy, latitude: position.coords.latitude, longitude: position.coords.longitude }));
      this.locationMessage.set(`Location captured with ${Math.round(position.coords.accuracy)} m accuracy. Save to apply it.`);
      this.locating.set(false);
    }, error => {
      this.locationError.set(true);
      this.locationMessage.set(error.code === error.PERMISSION_DENIED ? "Location permission was denied. Allow location access or enter exact coordinates." : "Current location could not be captured. Enter exact coordinates or try again.");
      this.locating.set(false);
    }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 });
  }

  async loadDevices(): Promise<void> {
    const branchId = this.branchId();
    if (!branchId) return;
    const request = ++this.devicesRequest;
    this.devicesLoading.set(true);
    this.devicesError.set("");
    try {
      const devices = await this.api.ownerAttendanceDevices({ branchId, status: this.deviceStatus() });
      if (request === this.devicesRequest && branchId === this.branchId()) this.devices.set(devices);
    } catch {
      if (request === this.devicesRequest) this.devicesError.set("Registered devices could not be loaded.");
    } finally {
      if (request === this.devicesRequest) this.devicesLoading.set(false);
    }
  }

  async changeDeviceStatus(device: OwnerAttendanceDevice, status: "trusted" | "revoked"): Promise<void> {
    const action = status === "trusted" ? "approve" : "revoke";
    if (!window.confirm(`${action === "approve" ? "Approve" : "Revoke"} ${device.deviceLabel || "this device"} for ${device.staffName}?`)) return;
    this.deviceBusy.set(device.id);
    this.deviceMessage.set("");
    try {
      const updated = await this.api.setOwnerAttendanceDeviceStatus(device.id, status, device.version);
      this.devices.update(items => this.deviceStatus() && this.deviceStatus() !== updated.status ? items.filter(item => item.id !== updated.id) : items.map(item => item.id === updated.id ? updated : item));
      this.deviceMessageError.set(false);
      this.deviceMessage.set(`Device ${status === "trusted" ? "approved" : "revoked"} for ${device.staffName}.`);
    } catch {
      this.deviceMessageError.set(true);
      this.deviceMessage.set("Device status was not changed. Refresh the device record and try again.");
    } finally {
      this.deviceBusy.set("");
    }
  }

  async loadEvidence(branchId = this.branchId(), from = this.context.periodRange().start, to = this.context.periodRange().end): Promise<void> {
    if (!branchId) return;
    const request = ++this.evidenceRequest;
    this.evidenceLoading.set(true);
    this.evidenceError.set("");
    try {
      const evidence = await this.api.ownerAttendanceEvidence({ branchId, staffId: this.evidenceStaffId(), from, to, decision: this.evidenceDecision() });
      if (request === this.evidenceRequest && branchId === this.branchId()) this.evidence.set(evidence);
    } catch {
      if (request === this.evidenceRequest) this.evidenceError.set("Punch evidence could not be loaded for this branch and period.");
    } finally {
      if (request === this.evidenceRequest) this.evidenceLoading.set(false);
    }
  }

  beginOverride(item: OwnerAttendanceEvidence): void { this.overrideId.set(item.id); this.overrideReasonDraft = ""; this.evidenceMessage.set(""); }
  cancelOverride(): void { this.overrideId.set(""); this.overrideReasonDraft = ""; }
  async submitOverride(item: OwnerAttendanceEvidence): Promise<void> {
    const reason = this.overrideReasonDraft.trim();
    if (item.decision !== "rejected" || !reason || this.overrideBusy()) return;
    this.overrideBusy.set(true);
    try {
      const updated = await this.api.overrideOwnerAttendanceEvidence(item.id, reason);
      this.evidence.update(items => this.evidenceDecision() === "rejected" ? items.filter(entry => entry.id !== item.id) : items.map(entry => entry.id === item.id ? updated : entry));
      this.cancelOverride();
      this.evidenceMessageError.set(false);
      this.evidenceMessage.set(`Rejected ${this.label(item.action)} attempt overridden for ${item.staffName}.`);
    } catch {
      this.evidenceMessageError.set(true);
      this.evidenceMessage.set("The override was not recorded. The attempt remains rejected.");
    } finally {
      this.overrideBusy.set(false);
    }
  }

  overrideReason(item: OwnerAttendanceEvidence): string { return item.override?.reason || item.overrideReason || item.reason || "Reason unavailable"; }
  osmUrl(latitude: number | null, longitude: number | null): string { return latitude === null || longitude === null ? "" : `https://www.openstreetmap.org/?mlat=${latitude}&mlon=${longitude}#map=18/${latitude}/${longitude}`; }
  dateTime(value: string): string { return this.context.formatDateTime(value); }
  label(value: string): string { return String(value || "Unavailable").replaceAll("_", " ").replace(/\b\w/g, letter => letter.toUpperCase()); }

  private resetBranchState(): void {
    this.policyRequest++;
    this.devicesRequest++;
    this.evidenceRequest++;
    this.policy.set({ ...DEFAULT_POLICY });
    this.devices.set([]);
    this.evidence.set([]);
    this.policyError.set("");
    this.devicesError.set("");
    this.evidenceError.set("");
    this.policyMessage.set("");
    this.policyMessageError.set(false);
    this.deviceMessage.set("");
    this.evidenceMessage.set("");
    this.cancelOverride();
  }
}
