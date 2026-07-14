import { CommonModule } from '@angular/common';
import { Component, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiRecord, ApiService } from '../core/api.service';
import { StateComponent } from '../shared/ui/state/state.component';
import { AuraDatePipe } from '../shared/pipes/aura-date.pipe';

@Component({
  selector: 'app-security-blocklist',
  standalone: true,
  imports: [AuraDatePipe, CommonModule, FormsModule, StateComponent],
  template: `
    <section class="page-stack">
      <div class="module-hero">
        <div>
          <h2>Security Blocklist</h2>
        </div>
        <button class="ghost-button" type="button" (click)="load()">Refresh</button>
      </div>

      <app-state [loading]="loading()" [error]="error()"></app-state>

      <section class="panel">
        <div class="section-title">
          <h2>Blocked IPs and users</h2>
          <label class="select-label">
            <span>Status</span>
            <select [(ngModel)]="statusFilter" (ngModelChange)="load()">
              <option value="active">Active</option>
              <option value="expired">Expired</option>
              <option value="unblocked">Unblocked</option>
            </select>
          </label>
        </div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Severity</th><th>IP</th><th>User</th><th>Reason</th><th>Blocked until</th><th>Status</th><th></th></tr></thead>
            <tbody>
              <tr *ngFor="let block of blocks()">
                <td><span class="badge">{{ block.severity }}</span></td>
                <td>{{ block.ipAddress || '-' }}</td>
                <td>{{ block.userId || '-' }}</td>
                <td>{{ block.reason }}</td>
                <td>{{ block.blockedUntil | auraDate:'date' }}</td>
                <td>{{ block.status }}</td>
                <td><button class="ghost-button mini" type="button" [disabled]="block.status !== 'active'" (click)="unblock(block)">Unblock</button></td>
              </tr>
              <tr *ngIf="!blocks().length"><td colspan="7">No blocklist records found.</td></tr>
            </tbody>
          </table>
        </div>
      </section>
    </section>
  `
})
export class SecurityBlocklistComponent implements OnInit {
  readonly blocks = signal<ApiRecord[]>([]);
  readonly loading = signal(false);
  readonly error = signal('');
  statusFilter = 'active';

  constructor(private readonly api: ApiService) {}

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.error.set('');
    this.api.list<{ blocks: ApiRecord[] }>('security/blocklist', { status: this.statusFilter }).subscribe({
      next: (result) => { this.blocks.set(result.blocks || []); this.loading.set(false); },
      error: (error) => { this.error.set(this.api.errorText(error)); this.loading.set(false); }
    });
  }

  unblock(block: ApiRecord): void {
    this.api.post(`security/blocklist/${block.id}/unblock`, {}).subscribe({
      next: () => this.load(),
      error: (error) => this.error.set(this.api.errorText(error))
    });
  }
}
