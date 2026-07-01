import { CommonModule } from '@angular/common';
import { Component, OnInit, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ApiRecord, ApiService } from '../../../core/api.service';
import { StateComponent } from '../../../shared/ui/state/state.component';
import { StaffOsSectionComponent } from '../ui/staff-os-section.component';

@Component({
  standalone: true,
  imports: [CommonModule, RouterLink, StaffOsSectionComponent, StateComponent],
  template: `
    <section class="page-stack">
      <div class="module-hero">
        <div>
          <h2>Mobile Staff Dashboard</h2>
        </div>
        <button class="ghost-button" type="button" (click)="load()">Refresh</button>
      </div>

      <app-state [loading]="loading()" [error]="error()"></app-state>

      <div class="dashboard-grid">
        <section class="panel">
          <div class="section-title">
            <h2>Live staff mobile view</h2>
            <a class="ghost-button" routerLink="/staff-os/face-punch">Open face punch</a>
          </div>
          <div class="quick-grid">
            <article class="action-card">
              <strong>{{ mobileDashboard()?.['today']?.['attendance']?.length || 0 }} attendance events</strong>
              <span>{{ mobileDashboard()?.['today']?.['schedules']?.length || 0 }} shifts · {{ mobileDashboard()?.['today']?.['tasks']?.length || 0 }} tasks</span>
            </article>
            <article class="action-card">
              <strong>{{ mobileDashboard()?.['targets']?.length || 0 }} targets</strong>
              <span>{{ mobileDashboard()?.['payroll']?.length || 0 }} payroll rows visible by role</span>
            </article>
          </div>
        </section>

        <section class="panel">
          <div class="section-title">
            <h2>Device sync status</h2>
            <a class="ghost-button" routerLink="/offline/devices">Open device health</a>
          </div>
          <div class="quick-grid">
            <article class="action-card">
              <strong>{{ deviceStatus()?.metrics?.ready || 0 }} ready</strong>
              <span>{{ deviceStatus()?.metrics?.pending || 0 }} pending · {{ deviceStatus()?.metrics?.blocked || 0 }} blocked</span>
              <small>{{ deviceStatus()?.offlineFirstPwa?.queuePolicy || 'Offline queue status will appear after sync activity.' }}</small>
            </article>
            <article class="action-card">
              <strong>Offline-first PWA</strong>
              <span>{{ deviceStatus()?.offlineFirstPwa?.ready ? 'Install/cache ready' : 'Needs first cache snapshot' }}</span>
              <small>{{ deviceStatus()?.offlineFirstPwa?.installPrompt }}</small>
            </article>
          </div>
        </section>

        <section class="panel">
          <div class="section-title">
            <h2>Staff mobile conflicts</h2>
            <a class="ghost-button" routerLink="/offline/conflicts">Open conflict center</a>
          </div>
          <div class="quick-grid">
            <article class="action-card" *ngFor="let conflict of conflicts()">
              <strong>{{ conflict.conflictType || conflict.conflict_type || 'Mobile conflict' }}</strong>
              <span>{{ conflict.status || 'open' }}</span>
              <small>{{ conflict.resolution || 'Manager decision pending' }}</small>
            </article>
            <article class="action-card" *ngIf="!conflicts().length">
              <strong>No staff mobile conflicts</strong>
              <span>Offline staff mutations are clear or not synced yet.</span>
            </article>
          </div>
        </section>
      </div>

      <app-staff-os-section title="Mobile Staff Dashboard" section="mobile-staff-dashboard-preview" />
    </section>
  `
})
export class MobileStaffDashboardPreviewPage implements OnInit {
  readonly deviceStatus = signal<ApiRecord | null>(null);
  readonly mobileDashboard = signal<ApiRecord | null>(null);
  readonly mobileConflicts = signal<ApiRecord[]>([]);
  readonly loading = signal(false);
  readonly error = signal('');

  constructor(private readonly api: ApiService) {}

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.api.list<ApiRecord>('offline/device-sync-status').subscribe({
      next: (status) => {
        this.deviceStatus.set(status);
        this.loadMobileDashboard();
        this.loadConflicts();
        this.loading.set(false);
      },
      error: (error) => {
        this.error.set(this.api.errorText(error));
        this.loading.set(false);
      }
    });
  }

  loadMobileDashboard(): void {
    this.api.list<ApiRecord>('staff-os/mobile/dashboard').subscribe({
      next: (dashboard) => this.mobileDashboard.set(dashboard || null),
      error: () => this.mobileDashboard.set(null)
    });
  }

  loadConflicts(): void {
    this.api.list<ApiRecord[]>('staff-os/mobile/conflicts').subscribe({
      next: (rows) => this.mobileConflicts.set(rows),
      error: () => this.mobileConflicts.set([])
    });
  }

  conflicts(): ApiRecord[] {
    return this.mobileConflicts();
  }
}
