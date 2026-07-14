import { CommonModule } from '@angular/common';
import { Component, OnInit, computed, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ApiRecord, ApiService } from '../core/api.service';
import { StateComponent } from '../shared/ui/state/state.component';
import { AuraDatePipe } from '../shared/pipes/aura-date.pipe';

@Component({
  selector: 'app-offline-readiness',
  standalone: true,
  imports: [AuraDatePipe, CommonModule, RouterLink, StateComponent],
  template: `
    <section class="page-stack">
      <div class="module-hero">
        <div>
          <h2>Offline Readiness Score</h2>
        </div>
        <button class="ghost-button" type="button" (click)="load()">Refresh</button>
      </div>
      <app-state [loading]="loading()" [error]="error()"></app-state>

      <div class="metrics-grid" *ngIf="summary()?.metrics as metrics">
        <article class="metric-card"><span>Score</span><strong>{{ score() }}</strong><small>{{ scoreDetail() }}</small></article>
        <article class="metric-card"><span>Cached packs</span><strong>{{ metrics.cacheSnapshots || 0 }}</strong></article>
        <article class="metric-card"><span>Pending queue</span><strong>{{ metrics.queued || 0 }}</strong></article>
        <article class="metric-card"><span>Conflict risk</span><strong>{{ metrics.conflicts || 0 }}</strong></article>
      </div>

      <section class="panel">
        <div class="section-title">
          <h2>Auto cache strategy</h2>
          <a class="ghost-button" routerLink="/offline/sync-queue">Open sync queue</a>
        </div>
        <div class="quick-grid">
          <article class="action-card aura-card aura-card--type-action" *ngFor="let item of cacheStrategy"><strong>{{ item }}</strong><span>Recommended for every branch device before network drops.</span></article>
        </div>
      </section>

      <section class="panel">
        <div class="section-title"><h2>Latest cache snapshots</h2></div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Resource</th><th>Device</th><th>Version</th><th>Created</th></tr></thead>
            <tbody>
              <tr *ngFor="let snapshot of snapshots()">
                <td>{{ snapshot.resource }}</td><td>{{ snapshot.deviceId }}</td><td>{{ snapshot.version }}</td><td>{{ snapshot.createdAt | auraDate:'date' }}</td>
              </tr>
              <tr *ngIf="!snapshots().length"><td colspan="4">No cache snapshots yet.</td></tr>
            </tbody>
          </table>
        </div>
      </section>
    </section>
  `
})
export class OfflineReadinessComponent implements OnInit {
  readonly summary = signal<ApiRecord | null>(null);
  readonly loading = signal(false);
  readonly error = signal('');
  readonly snapshots = computed(() => this.summary()?.snapshots || []);
  readonly cacheStrategy = ['Today and tomorrow appointments', 'Active clients', 'Services and price list', 'Products and stock snapshot', 'Staff roster', 'Memberships/packages', 'GST/tax settings'];

  constructor(private readonly api: ApiService) {}

  ngOnInit(): void { this.load(); }

  load(): void {
    this.loading.set(true);
    this.api.list<ApiRecord>('offline/summary').subscribe({
      next: (summary) => { this.summary.set(summary); this.loading.set(false); },
      error: (error) => { this.error.set(this.api.errorText(error)); this.loading.set(false); }
    });
  }

  score(): string {
    const metrics = this.summary()?.metrics || {};
    if (!Number(metrics.cacheSnapshots || 0) || Number(metrics.conflicts || 0) > 0 || Number(metrics.queued || 0) > 50) return 'Risk';
    if (Number(metrics.queued || 0) > 10) return 'Partial';
    return 'Ready';
  }

  scoreDetail(): string {
    if (this.score() === 'Ready') return 'Safe for controlled offline work';
    if (this.score() === 'Partial') return 'Cache available, queue needs attention';
    return 'Refresh cache or resolve sync risks';
  }
}
