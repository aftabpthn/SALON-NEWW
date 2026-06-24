import { CommonModule, DatePipe } from '@angular/common';
import { Component, OnInit, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { ApiRecord, ApiService } from '../core/api.service';
import { StateComponent } from '../shared/ui/state/state.component';

@Component({
  selector: 'app-security-alerts',
  standalone: true,
  imports: [CommonModule, DatePipe, RouterLink, StateComponent],
  template: `
    <section class="alerts-workspace">
      <app-state [loading]="loading()" [error]="error()"></app-state>

      <div class="page-heading">
        <div>
          <h1>Security alerts</h1>
          <span>Monitor suspicious login, probing, sensitive-access and active-defense events across the tenant</span>
        </div>
        <a class="primary-button" routerLink="/security-policy-center">Review policies</a>
      </div>

      <div class="metric-strip">
        <article><span>Open</span><strong>{{ summary().open || 0 }}</strong><small>Needs review</small></article>
        <article><span>Critical</span><strong>{{ summary().critical || 0 }}</strong><small>Immediate attention</small></article>
        <article><span>Warning</span><strong>{{ summary().warning || 0 }}</strong><small>Suspicious activity</small></article>
        <article><span>Resolved</span><strong>{{ summary().resolved || 0 }}</strong><small>Closed items</small></article>
        <article><span>Total loaded</span><strong>{{ alerts().length }}</strong><small>Current queue</small></article>
        <article><span>Active defense</span><strong>On</strong><small>Alert + block ready</small></article>
      </div>

      <section class="panel">
        <div class="section-title"><h2>Alert queue</h2><span>{{ alerts().length }} alert(s)</span></div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Severity</th><th>Type</th><th>Summary</th><th>IP</th><th>User</th><th>Created</th><th>Status</th><th></th></tr></thead>
            <tbody>
              <tr *ngFor="let alert of alerts()">
                <td><span class="badge" [class.danger]="alert.severity === 'critical'" [class.warning]="alert.severity === 'warning'">{{ alert.severity }}</span></td>
                <td>{{ alert.alertType }}</td>
                <td>{{ alert.summary }}</td>
                <td>{{ alert.ipAddress || '-' }}</td>
                <td>{{ alert.userId || '-' }}</td>
                <td>{{ alert.createdAt | date: 'short' }}</td>
                <td>{{ alert.status }}</td>
                <td><button class="ghost-button mini" type="button" [disabled]="alert.status === 'resolved'" (click)="resolve(alert)">Resolve</button></td>
              </tr>
              <tr *ngIf="!alerts().length"><td colspan="8">No security alerts found.</td></tr>
            </tbody>
          </table>
        </div>
      </section>
    </section>
  `,
  styles: [`
    .alerts-workspace { background: #fff; color: #111827; min-height: 100vh; }
    .command-bar { background: #111827; color: #fff; display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 12px 18px; box-shadow: 0 2px 10px rgba(15, 23, 42, 0.16); }
    .brand-block, .command-actions, .header-actions, .page-heading, .section-title { display: flex; align-items: center; gap: 10px; }
    .brand-mark { width: 34px; height: 34px; border-radius: 8px; display: grid; place-items: center; background: #635bff; font-weight: 900; }
    .brand-block small { display: block; color: #94a3b8; font-size: 10px; font-weight: 800; letter-spacing: 0; }
    .brand-block strong { display: block; font-size: 16px; }
    .zenoti-button, .primary-button, .ghost-button { border: 1px solid #bfdbfe; background: #fff; color: #075985; border-radius: 4px; padding: 8px 13px; font-weight: 800; cursor: pointer; text-decoration: none; }
    .zenoti-button.primary, .primary-button { background: #0f8f7f; border-color: #0f8f7f; color: #fff; }
    .zenoti-button:disabled, .ghost-button:disabled { opacity: 0.6; cursor: not-allowed; }
    .zenoti-header { display: grid; grid-template-columns: 1fr auto; gap: 10px; align-items: center; padding: 26px 16px 12px; border-bottom: 1px solid #d7e2ea; }
    .zenoti-header select { grid-column: 2; width: min(620px, 100%); border: 1px solid #bfdbfe; border-radius: 4px; padding: 9px 12px; font-weight: 800; background: #fff; }
    .page-heading { justify-content: space-between; padding: 14px 16px; border-bottom: 1px solid #d7e2ea; }
    .page-heading h1 { margin: 0 0 4px; font-size: 24px; }
    .page-heading span, .section-title span, small, td { color: #64748b; }
    .metric-strip { display: grid; grid-template-columns: repeat(6, minmax(150px, 1fr)); border-bottom: 1px solid #d7e2ea; background: #f8fafc; }
    .metric-strip article { padding: 14px 16px; border-right: 1px solid #d7e2ea; border-top: 4px solid #0f8f7f; min-height: 86px; }
    .metric-strip article:nth-child(2) { border-top-color: #b91c1c; }
    .metric-strip article:nth-child(3) { border-top-color: #b7791f; }
    .metric-strip article:nth-child(4) { border-top-color: #15803d; }
    .metric-strip article:nth-child(5) { border-top-color: #2563eb; }
    .metric-strip article:nth-child(6) { border-top-color: #7c3aed; }
    .metric-strip span { display: block; color: #64748b; font-size: 12px; font-weight: 900; }
    .metric-strip strong { display: block; margin-top: 6px; font-size: 25px; }
    .panel { margin: 16px; background: #fff; border: 1px solid #d7e2ea; border-radius: 4px; padding: 14px; }
    .section-title { justify-content: space-between; margin-bottom: 12px; }
    .section-title h2 { margin: 0; font-size: 16px; }
    .table-wrap { overflow: auto; border: 1px solid #d7e2ea; border-radius: 4px; }
    table { width: 100%; border-collapse: collapse; min-width: 980px; }
    th { background: #f1f5f9; color: #475569; font-size: 12px; text-align: left; text-transform: uppercase; }
    th, td { border-bottom: 1px solid #d7e2ea; padding: 12px; vertical-align: top; }
    .badge { display: inline-block; border-radius: 999px; background: #e0f2fe; color: #075985; padding: 5px 9px; font-weight: 800; font-size: 12px; text-transform: uppercase; }
    .badge.danger { background: #fee2e2; color: #991b1b; }
    .badge.warning { background: #fef3c7; color: #92400e; }
    .mini { padding: 6px 10px; }
    @media (max-width: 1100px) {
      .metric-strip { grid-template-columns: repeat(3, 1fr); }
      .zenoti-header { grid-template-columns: 1fr; }
      .zenoti-header select { grid-column: auto; }
    }
    @media (max-width: 720px) {
      .command-bar, .page-heading { align-items: stretch; flex-direction: column; }
      .metric-strip { grid-template-columns: 1fr; }
      .header-actions { flex-wrap: wrap; }
    }
  `]
})
export class SecurityAlertsComponent implements OnInit {
  readonly alerts = signal<ApiRecord[]>([]);
  readonly summary = signal<ApiRecord>({});
  readonly loading = signal(false);
  readonly error = signal('');

  constructor(private readonly api: ApiService, private readonly router: Router) {}

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.error.set('');
    this.api.list<{ alerts: ApiRecord[] }>('security/alerts').subscribe({
      next: (result) => {
        this.alerts.set(result.alerts || []);
        this.loadSummary();
      },
      error: (error) => { this.error.set(this.api.errorText(error)); this.loading.set(false); }
    });
  }

  loadSummary(): void {
    this.api.list<ApiRecord>('security/alerts/summary').subscribe({
      next: (summary) => { this.summary.set(summary || {}); this.loading.set(false); },
      error: (error) => { this.error.set(this.api.errorText(error)); this.loading.set(false); }
    });
  }

  resolve(alert: ApiRecord): void {
    this.api.post(`security/alerts/${alert.id}/resolve`, {}).subscribe({
      next: () => this.load(),
      error: (error) => this.error.set(this.api.errorText(error))
    });
  }

  runQuickAction(event: Event): void {
    const select = event.target as HTMLSelectElement;
    if (select.value === 'refresh') this.load();
    if (select.value === 'critical') {
      this.alerts.update((items) => [...items].sort((first, second) => Number(second.severity === 'critical') - Number(first.severity === 'critical')));
    }
    if (select.value === 'policy') this.router.navigate(['/security-policy-center']);
    if (select.value === 'blocklist') this.router.navigate(['/security-blocklist']);
    select.selectedIndex = 0;
  }
}
