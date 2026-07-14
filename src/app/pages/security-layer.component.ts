import { CommonModule } from '@angular/common';
import { Component, OnInit, computed, signal } from '@angular/core';
import { ReactiveFormsModule, UntypedFormBuilder, Validators } from '@angular/forms';
import { ApiRecord, ApiService } from '../core/api.service';
import { StateComponent } from '../shared/ui/state/state.component';
import { AuraDatePipe } from '../shared/pipes/aura-date.pipe';

@Component({
  selector: 'app-security-layer',
  standalone: true,
  imports: [AuraDatePipe, CommonModule, ReactiveFormsModule, StateComponent],
  template: `
    <section class="security-workspace">
      <app-state [loading]="loading()" [error]="error()"></app-state>

      <div class="page-heading">
        <div>
          <h1>Enterprise security</h1>
          <span>Security events, API protection, audit logs, permissions, sessions, encryption, backups and activity tracking</span>
        </div>
        <button class="primary-button" type="button" (click)="createBackup()">Create backup</button>
      </div>

      <div class="metric-strip" *ngIf="summary()?.metrics as metrics">
        <article><span>Audit logs</span><strong>{{ metrics.auditLogs }}</strong></article>
        <article><span>Active sessions</span><strong>{{ metrics.activeSessions }}</strong></article>
        <article><span>Backups</span><strong>{{ metrics.backups }}</strong></article>
        <article><span>Permissions</span><strong>{{ metrics.permissions }}</strong></article>
        <article><span>Secrets</span><strong>{{ metrics.encryptedSecrets }}</strong></article>
        <article><span>Risk score</span><strong>{{ metrics.riskScore }}</strong></article>
      </div>

      <div class="workdesk">
        <section class="form-panel">
          <h3>Permission system</h3>
          <form [formGroup]="permissionForm" (ngSubmit)="savePermission()">
            <label class="field"><span>Role</span><input formControlName="role" /></label>
            <label class="field"><span>Resource</span><input formControlName="resource" /></label>
            <label class="field full"><span>Actions CSV</span><input formControlName="actions" /></label>
            <div class="form-actions"><button class="primary-button" type="submit">Save permission</button></div>
          </form>
        </section>

        <section class="form-panel">
          <h3>Session management</h3>
          <form [formGroup]="sessionForm" (ngSubmit)="createSession()">
            <label class="field"><span>User ID</span><input formControlName="userId" /></label>
            <label class="field"><span>Device ID</span><input formControlName="deviceId" /></label>
            <div class="form-actions"><button class="primary-button" type="submit">Create session</button></div>
          </form>
        </section>

        <section class="form-panel">
          <h3>Encryption and backup</h3>
          <form [formGroup]="secretForm" (ngSubmit)="encryptSecret()">
            <label class="field"><span>Name</span><input formControlName="name" /></label>
            <label class="field"><span>Value</span><input formControlName="value" type="password" /></label>
            <div class="form-actions">
              <button class="ghost-button" type="button" (click)="createBackup()">Create backup</button>
              <button class="primary-button" type="submit">Encrypt</button>
            </div>
          </form>
        </section>
      </div>

      <section class="panel">
        <div class="section-title"><h2>Protection controls</h2><span>{{ controlEntries().length }} controls</span></div>
        <div class="quick-grid">
          <article class="action-card" *ngFor="let control of controlEntries()">
            <strong>{{ control[0] }}</strong>
            <span>{{ control[1] }}</span>
          </article>
        </div>
      </section>

      <div class="dashboard-grid">
        <section class="panel">
          <div class="section-title"><h2>Audit logs</h2></div>
          <div class="table-wrap">
            <table>
              <thead><tr><th>Action</th><th>Actor</th><th>Target</th><th>Severity</th><th>Created</th></tr></thead>
              <tbody>
                <tr *ngFor="let log of auditLogs()">
                  <td>{{ log.action }}</td>
                  <td>{{ log.actorRole }} · {{ log.actorUserId }}</td>
                  <td>{{ log.targetType }} {{ log.targetId }}</td>
                  <td><span class="badge">{{ log.severity }}</span></td>
                  <td>{{ log.createdAt | auraDate:'date' }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <section class="panel">
          <div class="section-title"><h2>Sessions and backups</h2></div>
          <div class="rank-list">
            <article *ngFor="let session of sessions()">
              <div><strong>{{ session.userId }}</strong><span>{{ session.status }} · {{ session.deviceId || 'no device' }}</span></div>
              <button class="ghost-button mini" type="button" (click)="revoke(session)" [disabled]="session.status !== 'active'">Revoke</button>
            </article>
            <article *ngFor="let backup of backups()">
              <div><strong>{{ backup.type }}</strong><span>{{ backup.fileSizeBytes }} bytes · {{ backup.status }}</span></div>
              <small>{{ backup.createdAt | auraDate:'date' }}</small>
            </article>
          </div>
        </section>
      </div>

      <section class="panel">
        <div class="section-title"><h2>Activity tracking</h2></div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Method</th><th>Path</th><th>Status</th><th>Duration</th><th>Created</th></tr></thead>
            <tbody>
              <tr *ngFor="let event of activities()">
                <td>{{ event.method }}</td>
                <td>{{ event.path }}</td>
                <td>{{ event.statusCode }}</td>
                <td>{{ event.durationMs }}ms</td>
                <td>{{ event.createdAt | auraDate:'date' }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <pre class="result-json" *ngIf="result()">{{ result() | json }}</pre>
    </section>
  `,
  styles: [`
    .security-workspace { background: #f0f2f5; color: #111827; min-height: 100vh; gap: 8px; padding: 8px; }
    .command-bar { background: #111827; color: #fff; display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 12px 18px; box-shadow: 0 2px 10px rgba(15, 23, 42, 0.16); }
    .brand-block, .command-actions, .header-actions, .page-heading, .section-title, .form-actions { display: flex; align-items: center; gap: 10px; }
    .brand-mark { width: 34px; height: 34px; border-radius: 8px; display: grid; place-items: center; background: #635bff; font-weight: 900; }
    .brand-block small { display: block; color: #94a3b8; font-size: 10px; font-weight: 800; letter-spacing: 0; }
    .brand-block strong { display: block; font-size: 16px; }
    .zenoti-button, .primary-button, .ghost-button { border: 1px solid #E7DDD6; background: #fff; color: #8B5E7C; border-radius: 4px; padding: 8px 13px; font-weight: 800; cursor: pointer; text-decoration: none; }
    .zenoti-button.primary, .primary-button { background: #5A153F; border-color: #5A153F; color: #fff; }
    .zenoti-button:disabled, .ghost-button:disabled { opacity: 0.6; cursor: not-allowed; }
    .zenoti-header { display: grid; grid-template-columns: 1fr auto; gap: 10px; align-items: center; padding: 26px 16px 12px; border: 1px solid #d7e2ea; }
    .zenoti-header select { grid-column: 2; width: min(620px, 100%); border: 1px solid #E7DDD6; border-radius: 4px; padding: 9px 12px; font-weight: 800; background: #fff; }
    .page-heading { justify-content: space-between; padding: 14px 16px; border: 1px solid #d7e2ea; }
    .page-heading h1 { margin: 0 0 4px; font-size: 24px; }
    .page-heading span, .section-title span, small, td, .field span { color: #64748b; }
    .metric-strip { display: grid; grid-template-columns: repeat(6, minmax(150px, 1fr)); border-left: 1px solid #d7e2ea; border-right: 1px solid #d7e2ea; border-bottom: 1px solid #d7e2ea; background: #f8fafc; }
    .metric-strip article { padding: 14px 16px; border-right: 1px solid #d7e2ea; border-top: 4px solid #5A153F; min-height: 86px; }
    .metric-strip article:nth-child(2) { border-top-color: #4B1238; }
    .metric-strip article:nth-child(3) { border-top-color: #b7791f; }
    .metric-strip article:nth-child(4) { border-top-color: #C87D4B; }
    .metric-strip article:nth-child(5) { border-top-color: #7c3aed; }
    .metric-strip article:nth-child(6) { border-top-color: #b91c1c; }
    .metric-strip span { display: block; color: #64748b; font-size: 12px; font-weight: 900; }
    .metric-strip strong { display: block; margin-top: 6px; font-size: 25px; }
    .workdesk { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; padding: 16px; border: 1px solid #d7e2ea; }
    .form-panel, .panel { background: #fff; border: 1px solid #d7e2ea; border-radius: 4px; padding: 14px; }
    .form-panel h3, .section-title h2 { margin: 0; font-size: 16px; }
    form { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; margin-top: 14px; }
    .field { display: grid; gap: 6px; font-weight: 800; }
    .field.full, .form-actions { grid-column: 1 / -1; }
    input { border: 1px solid #d7e2ea; border-radius: 4px; min-height: 38px; padding: 8px 10px; color: #111827; background: #fff; }
    .form-actions { justify-content: flex-end; }
    .panel { margin: 16px; }
    .section-title { justify-content: space-between; margin-bottom: 12px; }
    .quick-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; }
    .action-card { border: 1px solid #d7e2ea; border-radius: 4px; padding: 12px; min-height: 74px; }
    .action-card strong, .action-card span { display: block; }
    .action-card span { margin-top: 7px; color: #64748b; font-size: 12px; }
    .dashboard-grid { display: grid; grid-template-columns: minmax(0, 1.45fr) minmax(360px, 0.75fr); gap: 0; }
    .dashboard-grid .panel { margin-top: 0; }
    .table-wrap { overflow: auto; border: 1px solid #d7e2ea; border-radius: 4px; }
    table { width: 100%; border-collapse: collapse; min-width: 760px; }
    th { background: #f1f5f9; color: #475569; font-size: 12px; text-align: left; text-transform: uppercase; }
    th, td { border-bottom: 1px solid #d7e2ea; padding: 12px; vertical-align: top; }
    .badge { display: inline-block; border-radius: 999px; background: #F5EEF2; color: #8B5E7C; padding: 5px 9px; font-weight: 800; font-size: 12px; }
    .rank-list { display: grid; gap: 10px; }
    .rank-list article { display: flex; align-items: center; justify-content: space-between; gap: 10px; border: 1px solid #d7e2ea; border-radius: 4px; padding: 11px; }
    .rank-list strong, .rank-list span { display: block; }
    .rank-list span { color: #64748b; font-size: 12px; margin-top: 4px; }
    .mini { padding: 6px 10px; }
    .result-json { margin: 16px; border: 1px solid #d7e2ea; border-radius: 4px; padding: 12px; background: #f8fafc; overflow: auto; }
    @media (max-width: 1100px) {
      .metric-strip { grid-template-columns: repeat(3, 1fr); }
      .workdesk, .dashboard-grid, .quick-grid { grid-template-columns: 1fr; }
      .zenoti-header { grid-template-columns: 1fr; }
      .zenoti-header select { grid-column: auto; }
    }
    @media (max-width: 720px) {
      .command-bar, .page-heading, .rank-list article { align-items: stretch; flex-direction: column; }
      .metric-strip, form { grid-template-columns: 1fr; }
      .header-actions { flex-wrap: wrap; }
    }
  `]
})
export class SecurityLayerComponent implements OnInit {
  readonly summary = signal<ApiRecord | null>(null);
  readonly result = signal<ApiRecord | null>(null);
  readonly loading = signal(false);
  readonly error = signal('');
  readonly controlEntries = computed(() => Object.entries(this.summary()?.controls || {}) as [string, string][]);
  readonly auditLogs = computed(() => this.summary()?.auditLogs || []);
  readonly sessions = computed(() => this.summary()?.sessions || []);
  readonly backups = computed(() => this.summary()?.backups || []);
  readonly activities = computed(() => this.summary()?.activities || []);

  readonly permissionForm = this.fb.group({
    role: ['frontDesk', Validators.required],
    resource: ['smart-booking', Validators.required],
    actions: ['read,write', Validators.required]
  });
  readonly sessionForm = this.fb.group({ userId: ['system-user', Validators.required], deviceId: ['front-desk-terminal'] });
  readonly secretForm = this.fb.group({ name: ['whatsapp-provider-token', Validators.required], value: ['demo-secret', Validators.required] });

  constructor(private readonly api: ApiService, private readonly fb: UntypedFormBuilder) {}

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.api.list<ApiRecord>('security/summary').subscribe({
      next: (summary) => {
        this.summary.set(summary);
        this.loading.set(false);
      },
      error: (error) => {
        this.error.set(error?.error?.error || 'Unable to load security layer');
        this.loading.set(false);
      }
    });
  }

  savePermission(): void {
    this.api.post<ApiRecord>('security/permissions', {
      role: this.permissionForm.value.role,
      resource: this.permissionForm.value.resource,
      actions: String(this.permissionForm.value.actions || '').split(',').map((item) => item.trim()).filter(Boolean)
    }).subscribe((response) => {
      this.result.set(response);
      this.load();
    });
  }

  createSession(): void {
    this.api.post<ApiRecord>('security/sessions', this.sessionForm.value).subscribe((response) => {
      this.result.set(response);
      this.load();
    });
  }

  revoke(session: ApiRecord): void {
    this.api.patch<ApiRecord>(`security/sessions/${session.id}/revoke`, {}).subscribe((response) => {
      this.result.set(response);
      this.load();
    });
  }

  encryptSecret(): void {
    this.api.post<ApiRecord>('security/encrypt', this.secretForm.value).subscribe((response) => {
      this.result.set(response);
      this.load();
    });
  }

  createBackup(): void {
    this.api.post<ApiRecord>('security/backups', { type: 'manual-snapshot', reason: 'admin-console' }).subscribe((response) => {
      this.result.set(response);
      this.load();
    });
  }

  runQuickAction(event: Event): void {
    const select = event.target as HTMLSelectElement;
    const action = select.value;
    if (action === 'refresh') this.load();
    if (action === 'permission') this.permissionForm.patchValue({ role: 'owner', resource: 'security', actions: 'read,write,approve' });
    if (action === 'session') this.sessionForm.patchValue({ userId: 'front-desk-user', deviceId: 'front-desk-terminal' });
    if (action === 'backup') this.createBackup();
    select.selectedIndex = 0;
  }
}
