import { CommonModule } from '@angular/common';
import { Component, OnInit, signal } from '@angular/core';
import { ApiRecord, ApiService } from '../core/api.service';
import { StateComponent } from '../shared/ui/state/state.component';
import { AuraDatePipe } from '../shared/pipes/aura-date.pipe';

@Component({
  selector: 'app-offline-device-health',
  standalone: true,
  imports: [AuraDatePipe, CommonModule, StateComponent],
  template: `
    <section class="page-stack">
      <div class="module-hero">
        <div>
          <h2>Device Sync Health</h2>
        </div>
        <button class="ghost-button" type="button" (click)="load()">Refresh</button>
      </div>
      <app-state [loading]="loading()" [error]="error()"></app-state>
      <div class="metrics-grid" *ngIf="status()?.metrics as metrics">
        <article class="metric-card"><span>Devices</span><strong>{{ metrics.devices || 0 }}</strong></article>
        <article class="metric-card"><span>Ready</span><strong>{{ metrics.ready || 0 }}</strong></article>
        <article class="metric-card"><span>Pending</span><strong>{{ metrics.pending || 0 }}</strong></article>
        <article class="metric-card"><span>Blocked</span><strong>{{ metrics.blocked || 0 }}</strong></article>
      </div>
      <section class="panel">
        <div class="section-title">
          <h2>Offline-first PWA</h2>
          <span class="badge">{{ status()?.offlineFirstPwa?.ready ? 'Ready' : 'Needs cache' }}</span>
        </div>
        <div class="quick-grid">
          <article class="action-card">
            <strong>{{ status()?.offlineFirstPwa?.installPrompt }}</strong>
            <span>{{ status()?.offlineFirstPwa?.queuePolicy }}</span>
            <small>{{ status()?.offlineFirstPwa?.conflictPolicy }}</small>
          </article>
        </div>
      </section>
      <section class="panel">
        <div class="section-title"><h2>Devices</h2></div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Status</th><th>Device ID</th><th>Pending</th><th>Conflicts</th><th>Cache packs</th><th>Last seen</th><th>Next action</th></tr></thead>
            <tbody>
              <tr *ngFor="let device of devices()">
                <td><span class="badge">{{ device.status }}</span></td>
                <td>{{ device.deviceId }}</td>
                <td>{{ device.queued }}</td>
                <td>{{ device.conflicts }}</td>
                <td>{{ device.cacheSnapshots }}</td>
                <td>{{ device.lastSeen | auraDate:'date' }}</td>
                <td>{{ device.nextAction }}</td>
              </tr>
              <tr *ngIf="!devices().length"><td colspan="7">No device sync activity yet.</td></tr>
            </tbody>
          </table>
        </div>
      </section>
    </section>
  `
})
export class OfflineDeviceHealthComponent implements OnInit {
  readonly status = signal<ApiRecord | null>(null);
  readonly loading = signal(false);
  readonly error = signal('');

  constructor(private readonly api: ApiService) {}
  ngOnInit(): void { this.load(); }

  load(): void {
    this.loading.set(true);
    this.api.list<ApiRecord>('offline/device-sync-status').subscribe({
      next: (status) => { this.status.set(status); this.loading.set(false); },
      error: (error) => { this.error.set(this.api.errorText(error)); this.loading.set(false); }
    });
  }

  devices(): ApiRecord[] {
    return this.status()?.devices || [];
  }
}
