import { CommonModule } from '@angular/common';
import { Component, OnInit, signal } from '@angular/core';
import { ApiRecord, ApiService } from '../core/api.service';
import { StateComponent } from '../shared/ui/state/state.component';
import { AuraDatePipe } from '../shared/pipes/aura-date.pipe';

@Component({
  selector: 'app-offline-conflict-center',
  standalone: true,
  imports: [AuraDatePipe, CommonModule, StateComponent],
  template: `
    <section class="page-stack">
      <div class="module-hero">
        <div>
          <h2>Conflict Resolution Center</h2>
        </div>
        <button class="ghost-button" type="button" (click)="load()">Refresh</button>
      </div>
      <app-state [loading]="loading()" [error]="error()"></app-state>
      <section class="panel">
        <div class="section-title"><h2>Conflict queue</h2></div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Entity</th><th>Operation</th><th>Device</th><th>Reason</th><th>Created</th><th>Actions</th></tr></thead>
            <tbody>
              <tr *ngFor="let item of conflicts()">
                <td>{{ item.entity }}</td>
                <td>{{ item.operation }}</td>
                <td>{{ item.deviceId }}</td>
                <td>{{ item.errorMessage || item.conflictReason || 'Needs review' }}</td>
                <td>{{ item.createdAt | auraDate:'date' }}</td>
                <td><span class="badge">Keep server</span> <span class="badge">Keep device</span> <span class="badge">Merge</span></td>
              </tr>
              <tr *ngIf="!conflicts().length"><td colspan="6">No offline conflicts found.</td></tr>
            </tbody>
          </table>
        </div>
      </section>
    </section>
  `
})
export class OfflineConflictCenterComponent implements OnInit {
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
  conflicts(): ApiRecord[] {
    return (this.summary()?.syncItems || []).filter((item: ApiRecord) => item.status === 'conflict' || item.status === 'failed');
  }
}
