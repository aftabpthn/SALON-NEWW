import { CommonModule, DatePipe } from '@angular/common';
import { Component, OnInit, computed, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ApiRecord, ApiService } from '../core/api.service';
import { StateComponent } from '../shared/ui/state/state.component';

type LocationSharingOverview = {
  modules: ApiRecord[];
  modeKeys: string[];
  settings: ApiRecord[];
  rules: ApiRecord[];
  branches: ApiRecord[];
  conflicts: ApiRecord[];
  approvals: ApiRecord[];
  events: ApiRecord[];
  reports: ApiRecord;
  summary: ApiRecord;
};

@Component({
  selector: 'app-location-sharing-command-center',
  standalone: true,
  imports: [CommonModule, DatePipe, FormsModule, RouterLink, StateComponent],
  template: `
    <section class="location-sharing-page">
      <app-state [loading]="loading()" [error]="error()"></app-state>

      <div class="module-hero location-hero">
        <div>
          <span class="eyebrow">Multi-Branch / Governance</span>
          <h2>Location Sharing Command Center</h2>
          <p>Policy-first control for sharing customers, packages, memberships, products, services, vendors and staff across branches.</p>
        </div>
        <div class="hero-actions">
          <a class="ghost-button" routerLink="/branches">Branches</a>
          <button class="ghost-button" type="button" (click)="load()">Refresh</button>
          <button class="primary-button" type="button" (click)="saveSettings()">Save Settings</button>
        </div>
      </div>

      <section class="metric-strip" *ngIf="overview() as data">
        <article><span>Enabled Modules</span><strong>{{ data.summary?.enabledModules || 0 }}</strong><small>{{ data.modules?.length || 0 }} governed modules</small></article>
        <article><span>Branch Rules</span><strong>{{ data.summary?.rules || 0 }}</strong><small>source to target policies</small></article>
        <article><span>Open Conflicts</span><strong>{{ data.summary?.openConflicts || 0 }}</strong><small>duplicate or mismatch signals</small></article>
        <article><span>Pending Approvals</span><strong>{{ data.summary?.pendingApprovals || 0 }}</strong><small>owner action queue</small></article>
        <article><span>Sync Health</span><strong>{{ data.reports?.summary?.syncHealth || 'healthy' }}</strong><small>{{ data.reports?.summary?.failedSyncCount || 0 }} failed events</small></article>
      </section>

      <nav class="tab-rail" aria-label="Location sharing tabs">
        <button *ngFor="let tab of tabs" type="button" [class.active]="activeTab() === tab.key" (click)="activeTab.set(tab.key)">
          <span>{{ tab.label }}</span>
          <small>{{ tab.count() }}</small>
        </button>
      </nav>

      <section class="panel" *ngIf="activeTab() === 'settings'">
        <div class="section-title">
          <div>
            <h3>Sharing Settings</h3>
            <p>Tenant-wide module switches. Risky modes keep owner approval enabled by default.</p>
          </div>
          <button class="primary-button" type="button" (click)="saveSettings()">Save Settings</button>
        </div>
        <div class="settings-list">
          <article class="setting-row" *ngFor="let setting of settings()">
            <div class="setting-main">
              <span class="icon-box">{{ initials(setting.label || setting.module) }}</span>
              <div>
                <strong>Share {{ setting.label || setting.module }}</strong>
                <small>{{ settingDetail(setting.module) }}</small>
              </div>
            </div>
            <label class="switch">
              <input type="checkbox" [(ngModel)]="setting.enabled" />
              <span></span>
            </label>
            <div class="mode-grid">
              <label *ngFor="let mode of modeKeys()">
                <input type="checkbox" [ngModel]="setting.modes?.[mode]" (ngModelChange)="setSettingMode(setting, mode, $event)" />
                <span>{{ modeLabel(mode) }}</span>
              </label>
            </div>
          </article>
        </div>
      </section>

      <section class="panel" *ngIf="activeTab() === 'matrix'">
        <div class="section-title">
          <div>
            <h3>Branch Matrix</h3>
            <p>Choose exactly which source branch can share which module with which target branch.</p>
          </div>
          <button class="primary-button" type="button" (click)="saveRule()">Save Rule</button>
        </div>
        <div class="matrix-form">
          <label><span>Module</span><select [(ngModel)]="ruleForm.module"><option *ngFor="let module of modules()" [value]="module.key">{{ module.label }}</option></select></label>
          <label><span>Source branch</span><select [(ngModel)]="ruleForm.sourceBranchId"><option value="">Select source</option><option *ngFor="let branch of branches()" [value]="branch.id">{{ branch.name || branch.id }}</option></select></label>
          <label><span>Target branch</span><select [(ngModel)]="ruleForm.targetBranchId"><option value="">Select target</option><option *ngFor="let branch of branches()" [value]="branch.id">{{ branch.name || branch.id }}</option></select></label>
          <button class="primary-button" type="button" (click)="saveRule()">Apply Matrix Rule</button>
        </div>
        <div class="mode-grid matrix-modes">
          <label *ngFor="let mode of modeKeys()">
            <input type="checkbox" [ngModel]="ruleForm.modes[mode]" (ngModelChange)="setRuleMode(mode, $event)" />
            <span>{{ modeLabel(mode) }}</span>
          </label>
        </div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Module</th><th>Source</th><th>Target</th><th>Modes</th><th>Approval</th><th>Status</th></tr></thead>
            <tbody>
              <tr *ngFor="let rule of rules()">
                <td><strong>{{ labelFor(rule.module) }}</strong></td>
                <td>{{ branchName(rule.sourceBranchId) }}</td>
                <td>{{ branchName(rule.targetBranchId) }}</td>
                <td>{{ activeModes(rule.modes).join(', ') || 'None' }}</td>
                <td><span class="badge">{{ rule.approvalStatus }}</span></td>
                <td><span class="badge">{{ rule.status }}</span></td>
              </tr>
              <tr *ngIf="!rules().length"><td colspan="6">No branch matrix rules yet.</td></tr>
            </tbody>
          </table>
        </div>
      </section>

      <section class="panel" *ngIf="activeTab() === 'conflicts'">
        <div class="section-title">
          <div>
            <h3>Conflict Center</h3>
            <p>Duplicate customers, service price mismatch, product catalog mismatch and vendor mismatch signals.</p>
          </div>
          <button class="ghost-button" type="button" (click)="loadConflicts()">Scan Conflicts</button>
        </div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Module</th><th>Conflict</th><th>Branches</th><th>Status</th><th>Action</th></tr></thead>
            <tbody>
              <tr *ngFor="let conflict of conflicts()">
                <td>{{ labelFor(conflict.module) }}</td>
                <td><strong>{{ conflict.summary }}</strong><small>{{ conflict.conflictType }}</small></td>
                <td>{{ branchList(conflict.evidence?.branches) }}</td>
                <td><span class="badge">{{ conflict.status }}</span></td>
                <td>
                  <button class="ghost-button mini" type="button" (click)="resolveConflict(conflict, 'ignore')">Ignore</button>
                  <button class="primary-button mini" type="button" (click)="resolveConflict(conflict, 'merge')">Request Merge</button>
                </td>
              </tr>
              <tr *ngIf="!conflicts().length"><td colspan="5">No open conflicts found.</td></tr>
            </tbody>
          </table>
        </div>
      </section>

      <section class="panel" *ngIf="activeTab() === 'approvals'">
        <div class="section-title">
          <div>
            <h3>Approval Queue</h3>
            <p>Owner approval for risky cross-branch sharing, redemption, edit and conflict merge decisions.</p>
          </div>
          <button class="ghost-button" type="button" (click)="loadApprovals()">Refresh Queue</button>
        </div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Request</th><th>Module</th><th>Source</th><th>Target</th><th>Status</th><th>Decision</th></tr></thead>
            <tbody>
              <tr *ngFor="let approval of approvals()">
                <td><strong>{{ approval.requestType }}</strong><small>{{ approval.relatedType }}</small></td>
                <td>{{ labelFor(approval.module) }}</td>
                <td>{{ branchName(approval.sourceBranchId) }}</td>
                <td>{{ branchName(approval.targetBranchId) }}</td>
                <td><span class="badge">{{ approval.status }}</span></td>
                <td>
                  <button class="primary-button mini" type="button" (click)="decideApproval(approval, 'approve')" [disabled]="approval.status !== 'pending'">Approve</button>
                  <button class="ghost-button mini" type="button" (click)="decideApproval(approval, 'reject')" [disabled]="approval.status !== 'pending'">Reject</button>
                </td>
              </tr>
              <tr *ngIf="!approvals().length"><td colspan="6">No pending approvals.</td></tr>
            </tbody>
          </table>
        </div>
      </section>

      <section class="panel" *ngIf="activeTab() === 'sync'">
        <div class="section-title">
          <div>
            <h3>Sync Logs</h3>
            <p>Policy-first sync status, pending changes and failed event monitoring.</p>
          </div>
          <button class="ghost-button" type="button" (click)="loadEvents()">Refresh Logs</button>
        </div>
        <div class="quick-grid">
          <article class="action-card" *ngFor="let card of reportCards()">
            <small>{{ card.key }}</small>
            <strong>{{ card.value }}</strong>
            <span>{{ card.detail }}</span>
          </article>
        </div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Action</th><th>Module</th><th>Source</th><th>Target</th><th>Status</th><th>Created</th></tr></thead>
            <tbody>
              <tr *ngFor="let event of events()">
                <td>{{ event.action }}</td>
                <td>{{ labelFor(event.module) }}</td>
                <td>{{ branchName(event.sourceBranchId) }}</td>
                <td>{{ branchName(event.targetBranchId) }}</td>
                <td><span class="badge">{{ event.status }}</span></td>
                <td>{{ event.createdAt | date: 'short' }}</td>
              </tr>
              <tr *ngIf="!events().length"><td colspan="6">No sharing events yet.</td></tr>
            </tbody>
          </table>
        </div>
      </section>

      <section class="panel" *ngIf="activeTab() === 'audit'">
        <div class="section-title">
          <div>
            <h3>Audit Trail</h3>
            <p>Who changed what, when, source branch, target branch and status.</p>
          </div>
          <button class="ghost-button" type="button" (click)="loadEvents()">Refresh Audit</button>
        </div>
        <div class="audit-list">
          <article *ngFor="let event of events()">
            <strong>{{ event.action }}</strong>
            <span>{{ event.actorUserId || 'system' }} · {{ labelFor(event.module) }} · {{ event.createdAt | date: 'medium' }}</span>
            <small>{{ branchName(event.sourceBranchId) }} → {{ branchName(event.targetBranchId) }} · {{ event.status }}</small>
          </article>
          <article *ngIf="!events().length"><strong>No audit events yet.</strong></article>
        </div>
      </section>

      <section class="panel" *ngIf="activeTab() === 'reports'">
        <div class="section-title">
          <div>
            <h3>Reports</h3>
            <p>Cross-branch customer movement, membership redemption, package usage and sync health.</p>
          </div>
          <button class="ghost-button" type="button" (click)="loadReports()">Refresh Reports</button>
        </div>
        <div class="quick-grid">
          <article class="action-card report-card" *ngFor="let card of reportCards()">
            <small>{{ card.label }}</small>
            <strong>{{ card.value }}</strong>
            <span>{{ card.detail }}</span>
          </article>
        </div>
      </section>
    </section>
  `,
  styles: [`
    :host { display: block; color: var(--ink); }
    .location-sharing-page { display: grid; gap: 14px; min-width: 0; }
    .location-hero { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 16px; align-items: center; }
    .location-hero p { max-width: 820px; margin: 6px 0 0; color: var(--muted); font-weight: 650; }
    .hero-actions, .section-title, .matrix-form, .mode-grid, .tab-rail { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
    .hero-actions { justify-content: flex-end; }
    .metric-strip { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 10px; }
    .metric-strip article, .action-card { border: 1px solid var(--line); border-radius: 8px; background: var(--surface); padding: 14px; display: grid; gap: 6px; }
    .metric-strip span, .action-card small { color: var(--muted); font-size: 12px; font-weight: 900; text-transform: uppercase; }
    .metric-strip strong, .action-card strong { font-size: 22px; }
    .metric-strip small, .action-card span { color: var(--muted); font-weight: 650; }
    .tab-rail { padding: 8px; border: 1px solid var(--line); border-radius: 8px; background: var(--surface); }
    .tab-rail button { min-height: 42px; border: 1px solid transparent; border-radius: 8px; padding: 8px 12px; background: transparent; color: var(--ink); font-weight: 900; cursor: pointer; }
    .tab-rail button.active { border-color: color-mix(in srgb, var(--teal) 45%, var(--line)); background: color-mix(in srgb, var(--teal) 10%, var(--surface)); }
    .tab-rail small { margin-left: 6px; color: var(--muted); }
    .panel { display: grid; gap: 14px; padding: 16px; border: 1px solid var(--line); border-radius: 8px; background: var(--surface); }
    .section-title { justify-content: space-between; }
    .section-title h3 { margin: 0; }
    .section-title p { margin: 4px 0 0; color: var(--muted); font-weight: 650; }
    .settings-list { display: grid; border: 1px solid var(--line); border-radius: 8px; overflow: hidden; }
    .setting-row { display: grid; grid-template-columns: minmax(230px, 1fr) auto minmax(360px, 1.4fr); gap: 14px; align-items: center; padding: 14px; border-bottom: 1px solid var(--line); }
    .setting-row:last-child { border-bottom: 0; }
    .setting-main { display: flex; align-items: center; gap: 12px; min-width: 0; }
    .setting-main small { display: block; color: var(--muted); font-weight: 650; margin-top: 3px; }
    .icon-box { display: grid; place-items: center; width: 38px; height: 38px; border-radius: 8px; background: var(--surface-2); border: 1px solid var(--line); font-weight: 950; }
    .switch input { display: none; }
    .switch span { display: block; width: 54px; height: 30px; border-radius: 999px; background: #c7c7c7; position: relative; transition: 0.18s ease; }
    .switch span::after { content: ""; position: absolute; top: 5px; left: 5px; width: 20px; height: 20px; border-radius: 999px; background: white; transition: 0.18s ease; }
    .switch input:checked + span { background: var(--teal); }
    .switch input:checked + span::after { transform: translateX(24px); }
    .mode-grid { align-items: stretch; }
    .mode-grid label { display: inline-flex; align-items: center; gap: 7px; min-height: 34px; border: 1px solid var(--line); border-radius: 8px; padding: 6px 10px; background: var(--surface-2); font-weight: 750; }
    .matrix-form { align-items: end; }
    .matrix-form label { display: grid; gap: 5px; min-width: 190px; flex: 1; }
    .matrix-form span { color: var(--muted); font-size: 12px; font-weight: 900; text-transform: uppercase; }
    input, select { min-height: 42px; border: 1px solid var(--line); border-radius: 8px; padding: 0 11px; background: var(--surface); color: var(--ink); font: inherit; }
    .matrix-modes { padding: 10px; border: 1px solid var(--line); border-radius: 8px; background: var(--surface-2); }
    .quick-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 10px; }
    .table-wrap { width: 100%; overflow: auto; border: 1px solid var(--line); border-radius: 8px; }
    table { width: 100%; min-width: 860px; border-collapse: collapse; }
    th, td { padding: 12px; border-bottom: 1px solid var(--line); text-align: left; vertical-align: top; }
    th { background: var(--surface-2); color: var(--muted); font-size: 12px; text-transform: uppercase; }
    td small { display: block; color: var(--muted); margin-top: 3px; }
    .badge { display: inline-flex; border-radius: 999px; background: var(--surface-2); border: 1px solid var(--line); padding: 5px 9px; font-weight: 900; font-size: 12px; }
    .mini { min-height: 30px; padding: 0 9px; font-size: 12px; }
    .audit-list { display: grid; gap: 8px; }
    .audit-list article { display: grid; gap: 4px; padding: 12px; border: 1px solid var(--line); border-radius: 8px; background: var(--surface-2); }
    .audit-list span, .audit-list small { color: var(--muted); font-weight: 650; }
    @media (max-width: 1100px) {
      .location-hero, .setting-row { grid-template-columns: 1fr; }
      .hero-actions, .section-title { justify-content: flex-start; }
      .metric-strip, .quick-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    }
    @media (max-width: 680px) {
      .metric-strip, .quick-grid { grid-template-columns: 1fr; }
      .mode-grid label, .matrix-form label { width: 100%; }
    }
  `]
})
export class LocationSharingCommandCenterComponent implements OnInit {
  readonly loading = signal(false);
  readonly error = signal('');
  readonly overview = signal<LocationSharingOverview | null>(null);
  readonly activeTab = signal('settings');

  readonly modules = computed(() => this.overview()?.modules || []);
  readonly modeKeys = computed(() => this.overview()?.modeKeys || []);
  readonly settings = computed(() => this.overview()?.settings || []);
  readonly rules = computed(() => this.overview()?.rules || []);
  readonly branches = computed(() => this.overview()?.branches || []);
  readonly conflicts = computed(() => this.overview()?.conflicts || []);
  readonly approvals = computed(() => this.overview()?.approvals || []);
  readonly events = computed(() => this.overview()?.events || []);
  readonly reportCards = computed(() => (this.overview()?.reports?.['cards'] as ApiRecord[] | undefined) || []);

  readonly tabs = [
    { key: 'settings', label: 'Sharing Settings', count: () => this.settings().filter((item) => item.enabled).length },
    { key: 'matrix', label: 'Branch Matrix', count: () => this.rules().length },
    { key: 'conflicts', label: 'Conflict Center', count: () => this.conflicts().length },
    { key: 'approvals', label: 'Approval Queue', count: () => this.approvals().filter((item) => item.status === 'pending').length },
    { key: 'sync', label: 'Sync Logs', count: () => this.events().length },
    { key: 'audit', label: 'Audit Trail', count: () => this.events().length },
    { key: 'reports', label: 'Reports', count: () => this.reportCards().length }
  ];

  ruleForm: ApiRecord = {
    module: 'customer',
    sourceBranchId: '',
    targetBranchId: '',
    modes: {
      viewOnly: true,
      syncMasterData: false,
      allowRedemption: false,
      allowEdit: false,
      ownerApprovalRequired: true
    }
  };

  constructor(private readonly api: ApiService) {}

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.error.set('');
    this.api.list<LocationSharingOverview>('location-sharing/overview', { limit: 200 }).subscribe({
      next: (overview) => {
        this.overview.set(overview);
        this.hydrateRuleDefaults();
        this.loading.set(false);
      },
      error: (error) => {
        this.error.set(this.api.errorText(error, 'Unable to load location sharing controls'));
        this.loading.set(false);
      }
    });
  }

  saveSettings(): void {
    this.loading.set(true);
    this.error.set('');
    this.api.patch<{ settings: ApiRecord[] }>('location-sharing/settings', { settings: this.settings() }).subscribe({
      next: (result) => {
        this.mergeOverview({ settings: result.settings || [] });
        this.loading.set(false);
        this.loadEvents();
      },
      error: (error) => {
        this.error.set(this.api.errorText(error, 'Unable to save sharing settings'));
        this.loading.set(false);
      }
    });
  }

  saveRule(): void {
    this.loading.set(true);
    this.error.set('');
    this.api.put<{ rules: ApiRecord[]; approvals: ApiRecord[] }>('location-sharing/rules', this.ruleForm).subscribe({
      next: (result) => {
        this.mergeOverview({
          rules: [...(result.rules || []), ...this.rules().filter((rule) => !(result.rules || []).some((saved) => saved.id === rule.id))],
          approvals: result.approvals || this.approvals()
        });
        this.loading.set(false);
        this.loadEvents();
      },
      error: (error) => {
        this.error.set(this.api.errorText(error, 'Unable to save branch matrix rule'));
        this.loading.set(false);
      }
    });
  }

  loadConflicts(): void {
    this.api.list<{ conflicts: ApiRecord[] }>('location-sharing/conflicts', { limit: 200 }).subscribe({
      next: (result) => this.mergeOverview({ conflicts: result.conflicts || [] }),
      error: (error) => this.error.set(this.api.errorText(error, 'Unable to scan conflicts'))
    });
  }

  loadApprovals(): void {
    this.api.list<{ approvals: ApiRecord[] }>('location-sharing/approvals', { limit: 200 }).subscribe({
      next: (result) => this.mergeOverview({ approvals: result.approvals || [] }),
      error: (error) => this.error.set(this.api.errorText(error, 'Unable to load approvals'))
    });
  }

  loadEvents(): void {
    this.api.list<{ events: ApiRecord[] }>('location-sharing/events', { limit: 200 }).subscribe({
      next: (result) => this.mergeOverview({ events: result.events || [] }),
      error: (error) => this.error.set(this.api.errorText(error, 'Unable to load sharing events'))
    });
  }

  loadReports(): void {
    this.api.list<ApiRecord>('location-sharing/reports', {}).subscribe({
      next: (reports) => this.mergeOverview({ reports }),
      error: (error) => this.error.set(this.api.errorText(error, 'Unable to load sharing reports'))
    });
  }

  resolveConflict(conflict: ApiRecord, action: string): void {
    this.api.post<{ conflict: ApiRecord; approval?: ApiRecord }>(`location-sharing/conflicts/${conflict.id}/resolve`, { action }).subscribe({
      next: (result) => {
        const conflicts = this.conflicts().map((item) => item.id === result.conflict?.id ? result.conflict : item);
        const approvals = result.approval ? [result.approval, ...this.approvals()] : this.approvals();
        this.mergeOverview({ conflicts, approvals });
        this.loadEvents();
      },
      error: (error) => this.error.set(this.api.errorText(error, 'Unable to resolve conflict'))
    });
  }

  decideApproval(approval: ApiRecord, decision: 'approve' | 'reject'): void {
    this.api.post<{ approval: ApiRecord }>(`location-sharing/approvals/${approval.id}/${decision}`, {}).subscribe({
      next: (result) => {
        this.mergeOverview({
          approvals: this.approvals().map((item) => item.id === result.approval?.id ? result.approval : item)
        });
        this.loadEvents();
      },
      error: (error) => this.error.set(this.api.errorText(error, 'Unable to update approval'))
    });
  }

  setSettingMode(setting: ApiRecord, mode: string, enabled: boolean): void {
    setting.modes = { ...(setting.modes || {}), [mode]: enabled };
    if (['syncMasterData', 'allowRedemption', 'allowEdit'].includes(mode) && enabled) {
      setting.modes.ownerApprovalRequired = true;
    }
  }

  setRuleMode(mode: string, enabled: boolean): void {
    this.ruleForm.modes = { ...(this.ruleForm.modes || {}), [mode]: enabled };
    if (['syncMasterData', 'allowRedemption', 'allowEdit'].includes(mode) && enabled) {
      this.ruleForm.modes.ownerApprovalRequired = true;
    }
  }

  settingDetail(module: string): string {
    const details: ApiRecord = {
      customer: 'Sync client profiles across selected branches',
      package: 'Make package catalog available under branch rules',
      membership: 'Allow policy-gated redemption across branches',
      product: 'Share catalog while stock stays branch-wise',
      service: 'Share service catalog while price can be overridden',
      vendor: 'Centralise supplier/vendor relationships',
      staff: 'Share staff identity for multi-branch operations'
    };
    return details[module] || 'Policy-first sharing control';
  }

  modeLabel(mode: string): string {
    const labels: ApiRecord = {
      viewOnly: 'View only',
      syncMasterData: 'Sync master data',
      allowRedemption: 'Allow redemption',
      allowEdit: 'Allow edit',
      ownerApprovalRequired: 'Owner approval'
    };
    return labels[mode] || mode;
  }

  labelFor(module: string): string {
    return this.modules().find((item) => item.key === module)?.label || module || '-';
  }

  branchName(branchId: string): string {
    if (!branchId) return '-';
    return this.branches().find((branch) => branch.id === branchId)?.name || branchId;
  }

  branchList(branchIds: string[] | undefined): string {
    return (branchIds || []).map((id) => this.branchName(id)).join(', ') || '-';
  }

  activeModes(modes: ApiRecord = {}): string[] {
    return this.modeKeys().filter((mode) => modes?.[mode]).map((mode) => this.modeLabel(mode));
  }

  initials(value = ''): string {
    const parts = String(value || 'LS').trim().split(/\s+/).filter(Boolean);
    return ((parts[0]?.[0] || 'L') + (parts.length > 1 ? parts.at(-1)?.[0] || '' : '')).toUpperCase();
  }

  private hydrateRuleDefaults(): void {
    const branches = this.branches();
    if (!this.ruleForm.sourceBranchId && branches[0]) this.ruleForm.sourceBranchId = branches[0].id;
    if (!this.ruleForm.targetBranchId && branches[1]) this.ruleForm.targetBranchId = branches[1].id;
  }

  private mergeOverview(patch: Partial<LocationSharingOverview>): void {
    this.overview.set({ ...(this.overview() || this.emptyOverview()), ...patch });
  }

  private emptyOverview(): LocationSharingOverview {
    return {
      modules: [],
      modeKeys: [],
      settings: [],
      rules: [],
      branches: [],
      conflicts: [],
      approvals: [],
      events: [],
      reports: { summary: {}, cards: [] },
      summary: {}
    };
  }
}
