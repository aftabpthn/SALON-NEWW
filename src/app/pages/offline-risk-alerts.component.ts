import { CommonModule } from '@angular/common';
import { Component, OnInit, signal } from '@angular/core';
import { ApiRecord, ApiService } from '../core/api.service';
import { StateComponent } from '../shared/ui/state/state.component';

@Component({
  selector: 'app-offline-risk-alerts',
  standalone: true,
  imports: [CommonModule, StateComponent],
  template: `
    <section class="page-stack">
      <div class="module-hero">
        <div>
          <h2>Offline Risk Alerts</h2>
        </div>
        <button class="ghost-button" type="button" (click)="load()">Refresh</button>
      </div>
      <app-state [loading]="loading()" [error]="error()"></app-state>
      <section class="panel">
        <div class="section-title"><h2>Risk signals</h2></div>
        <div class="quick-grid">
          <article class="action-card" *ngFor="let alert of alerts()">
            <strong>{{ alert.title }}</strong>
            <span>{{ alert.detail }}</span>
            <small>{{ alert.severity }}</small>
          </article>
        </div>
      </section>
    </section>
  `
})
export class OfflineRiskAlertsComponent implements OnInit {
  readonly summary = signal<ApiRecord | null>(null);
  readonly loading = signal(false);
  readonly error = signal('');

  constructor(private readonly api: ApiService) {}
  ngOnInit(): void { this.load(); }

  load(): void {
    this.loading.set(true);
    this.api.list<ApiRecord>('offline/summary').subscribe({
      next: (summary) => { this.summary.set(summary); this.loading.set(false); },
      error: (error) => { this.error.set(this.api.errorText(error)); this.loading.set(false); }
    });
  }

  alerts(): ApiRecord[] {
    const metrics = this.summary()?.metrics || {};
    const syncItems = this.summary()?.syncItems || [];
    const snapshots = this.summary()?.snapshots || [];
    const latest = snapshots[0]?.createdAt ? new Date(snapshots[0].createdAt).getTime() : 0;
    const staleCache = !latest || Date.now() - latest > 24 * 60 * 60 * 1000;
    const failed = syncItems.filter((item: ApiRecord) => item.status === 'failed' || item.status === 'conflict').length;
    const billing = Number(metrics.offlineBills || 0);
    const alerts = [
      { title: 'Cache freshness', severity: staleCache ? 'warning' : 'healthy', detail: staleCache ? 'Cache is older than 24 hours or missing.' : 'Latest cache is fresh enough for controlled offline work.' },
      { title: 'Unsynced queue load', severity: Number(metrics.queued || 0) > 50 ? 'critical' : 'normal', detail: `${metrics.queued || 0} queued records pending sync.` },
      { title: 'Failed sync / conflict', severity: failed ? 'warning' : 'normal', detail: `${failed} failed or conflict records need review.` },
      { title: 'Device inactivity', severity: snapshots.length ? 'normal' : 'warning', detail: snapshots.length ? 'Device cache activity exists.' : 'No device cache activity found.' },
      { title: 'Offline billing exposure', severity: billing > 20 ? 'warning' : 'normal', detail: `${billing} offline bill records are visible in current summary.` }
    ];
    return alerts;
  }
}
