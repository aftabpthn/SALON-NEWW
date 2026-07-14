import { CommonModule } from '@angular/common';
import { Component, OnInit, signal } from '@angular/core';
import { ApiRecord, ApiService } from '../core/api.service';
import { StateComponent } from '../shared/ui/state/state.component';
import { AuraDatePipe } from '../shared/pipes/aura-date.pipe';

@Component({
  selector: 'app-offline-sync-queue',
  standalone: true,
  imports: [AuraDatePipe, CommonModule, StateComponent],
  template: `
    <section class="page-stack">
      <div class="module-hero">
        <div>
          <h2>Smart Sync Queue</h2>
        </div>
        <div class="form-actions">
          <button class="ghost-button" type="button" (click)="load()">Refresh</button>
          <button class="primary-button" type="button" (click)="sync()">Force sync queued</button>
        </div>
      </div>
      <app-state [loading]="loading()" [error]="error()"></app-state>
      <div class="dashboard-grid">
        <section class="panel">
          <div class="section-title">
            <h2>Retry dashboard</h2>
            <span class="badge">{{ retryDashboard()?.metrics?.retryCandidates || 0 }} retry candidates</span>
          </div>
          <div class="quick-grid">
            <article class="action-card">
              <strong>{{ retryDashboard()?.metrics?.priorityBilling || 0 }}</strong>
              <span>Billing priority</span>
            </article>
            <article class="action-card">
              <strong>{{ retryDashboard()?.metrics?.priorityAppointments || 0 }}</strong>
              <span>Appointment priority</span>
            </article>
            <article class="action-card">
              <strong>{{ retryDashboard()?.metrics?.oldestQueuedAt ? (retryDashboard()?.metrics?.oldestQueuedAt | auraDate:'date') : 'Clear' }}</strong>
              <span>Oldest queued</span>
              <small>{{ retryDashboard()?.conflictHandling?.policy }}</small>
            </article>
          </div>
        </section>
        <section class="panel">
          <div class="section-title">
            <h2>Device sync status</h2>
            <span class="badge">{{ deviceStatus()?.metrics?.devices || 0 }} devices</span>
          </div>
          <div class="quick-grid">
            <article class="action-card" *ngFor="let device of devices()">
              <strong>{{ device.deviceId }}</strong>
              <span>{{ device.status }} · {{ device.syncState }}</span>
              <small>{{ device.nextAction }}</small>
            </article>
            <article class="action-card" *ngIf="!devices().length">
              <strong>No device activity</strong>
              <span>Create a cache snapshot or enqueue offline work from a device.</span>
              <small>{{ deviceStatus()?.offlineFirstPwa?.installPrompt || 'Offline-first PWA status will appear here.' }}</small>
            </article>
          </div>
        </section>
      </div>
      <section class="panel">
        <div class="section-title"><h2>Priority queue</h2></div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Priority</th><th>Entity</th><th>Operation</th><th>Device</th><th>Status</th><th>Server</th><th>Failure / conflict preview</th><th>Created</th><th>Action</th></tr></thead>
            <tbody>
              <tr *ngFor="let item of queue()">
                <td>{{ priorityLabel(item) }}</td>
                <td>{{ item.entity }}</td>
                <td>{{ item.operation }}</td>
                <td>{{ item.deviceId }}</td>
                <td><span class="badge">{{ item.status }}</span></td>
                <td>{{ item.serverId || '-' }}</td>
                <td>{{ item.errorMessage || item.conflictReason || '-' }}</td>
                <td>{{ item.createdAt | auraDate:'date' }}</td>
                <td><button class="ghost-button" type="button" [disabled]="!canRetry(item)" (click)="retryItem(item)">Retry</button></td>
              </tr>
              <tr *ngIf="!queue().length"><td colspan="9">No sync queue items found.</td></tr>
            </tbody>
          </table>
        </div>
      </section>
      <pre class="result-json" *ngIf="result()">{{ result() | json }}</pre>
    </section>
  `
})
export class OfflineSyncQueueComponent implements OnInit {
  readonly summary = signal<ApiRecord | null>(null);
  readonly retryDashboard = signal<ApiRecord | null>(null);
  readonly deviceStatus = signal<ApiRecord | null>(null);
  readonly result = signal<ApiRecord | null>(null);
  readonly loading = signal(false);
  readonly error = signal('');

  constructor(private readonly api: ApiService) {}
  ngOnInit(): void { this.load(); }

  load(): void {
    this.loading.set(true);
    this.api.list<ApiRecord>('offline/summary').subscribe({
      next: (summary) => {
        this.summary.set(summary);
        this.loadRetryDashboard();
        this.loadDeviceStatus();
        this.loading.set(false);
      },
      error: (error) => { this.error.set(this.api.errorText(error)); this.loading.set(false); }
    });
  }

  loadRetryDashboard(): void {
    this.api.list<ApiRecord>('offline/retry-dashboard').subscribe({
      next: (dashboard) => this.retryDashboard.set(dashboard),
      error: (error) => this.error.set(this.api.errorText(error))
    });
  }

  loadDeviceStatus(): void {
    this.api.list<ApiRecord>('offline/device-sync-status').subscribe({
      next: (status) => this.deviceStatus.set(status),
      error: (error) => this.error.set(this.api.errorText(error))
    });
  }

  sync(): void {
    this.api.post<ApiRecord>('offline/sync', {}).subscribe({
      next: (result) => { this.result.set(result); this.load(); },
      error: (error) => this.error.set(this.api.errorText(error))
    });
  }

  retryItem(item: ApiRecord): void {
    if (!item.id) return;
    this.api.post<ApiRecord>(`offline/sync-items/${item.id}/retry`, { branchId: item.branchId }).subscribe({
      next: (result) => { this.result.set(result); this.load(); },
      error: (error) => this.error.set(this.api.errorText(error))
    });
  }

  queue(): ApiRecord[] {
    return [...(this.summary()?.syncItems || [])].sort((left, right) => this.priority(left) - this.priority(right));
  }

  priority(item: ApiRecord): number {
    if (item.entity === 'sales' || item.operation?.includes?.('billing')) return 1;
    if (item.entity === 'appointments') return 2;
    if (item.entity === 'inventory') return 3;
    return 4;
  }

  priorityLabel(item: ApiRecord): string {
    return `P${this.priority(item)}`;
  }

  canRetry(item: ApiRecord): boolean {
    return ['queued', 'conflict', 'failed'].includes(item.status);
  }

  devices(): ApiRecord[] {
    return this.deviceStatus()?.devices || [];
  }
}
