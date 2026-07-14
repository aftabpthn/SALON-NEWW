import { CommonModule } from '@angular/common';
import { Component, OnInit, computed, signal } from '@angular/core';
import { FormsModule, ReactiveFormsModule, UntypedFormBuilder, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ApiRecord, ApiService } from '../core/api.service';
import { StateComponent } from '../shared/ui/state/state.component';
import { AuraKpiCardComponent } from '../shared/ui/aura-kpi-card/aura-kpi-card.component';
import { AuraDatePipe } from '../shared/pipes/aura-date.pipe';

@Component({
  selector: 'app-offline-support',
  standalone: true,
  imports: [AuraDatePipe, CommonModule, FormsModule, ReactiveFormsModule, RouterLink, StateComponent, AuraKpiCardComponent],
  template: `
    <section class="page-stack">
      <div class="module-hero">
        <div>
          <h2>Run billing, appointments and recovery workflows even when internet is unstable</h2>
        </div>
        <button class="ghost-button" type="button" (click)="load()">Refresh</button>
      </div>

      <app-state [loading]="loading()" [error]="error()"></app-state>

      <div class="metrics-grid" *ngIf="summary()?.metrics as metrics">
        <aura-kpi-card tone="neutral" target="/kpi-details/offline/queued"><span>Queued</span><strong>{{ metrics.queued }}</strong></aura-kpi-card>
        <aura-kpi-card tone="neutral" target="/kpi-details/offline/synced"><span>Synced</span><strong>{{ metrics.synced }}</strong></aura-kpi-card>
        <aura-kpi-card tone="neutral" target="/kpi-details/offline/conflicts"><span>Conflicts</span><strong>{{ metrics.conflicts }}</strong></aura-kpi-card>
        <aura-kpi-card tone="neutral" target="/kpi-details/offline/cache-snapshots"><span>Cache snapshots</span><strong>{{ metrics.cacheSnapshots }}</strong></aura-kpi-card>
        <aura-kpi-card tone="neutral" target="/kpi-details/offline/offline-appointments"><span>Offline appointments</span><strong>{{ metrics.offlineAppointments }}</strong></aura-kpi-card>
        <aura-kpi-card tone="neutral" target="/kpi-details/offline/offline-bills"><span>Offline bills</span><strong>{{ metrics.offlineBills }}</strong></aura-kpi-card>
      </div>

      <section class="panel">
        <div class="section-title">
          <h2>Offline modules</h2>
          <span class="badge">Separated pages</span>
        </div>
        <div class="quick-grid">
          <a class="action-card aura-card aura-card--type-action" *ngFor="let module of modules" [routerLink]="module.path">
            <strong>{{ module.title }}</strong>
            <span>{{ module.detail }}</span>
            <small>{{ module.signal }}</small>
          </a>
        </div>
      </section>

      <div class="dashboard-grid">
        <section class="panel">
          <div class="section-title"><h2>Readiness snapshot</h2></div>
          <div class="quick-grid">
            <article class="action-card aura-card aura-card--type-action">
              <strong>{{ readinessScore() }}</strong>
              <span>{{ readinessLabel() }}</span>
            </article>
            <article class="action-card aura-card aura-card--type-action">
              <strong>{{ summary()?.snapshots?.[0]?.createdAt ? (summary()?.snapshots?.[0]?.createdAt | auraDate:'date') : 'No cache yet' }}</strong>
              <span>Latest cache snapshot</span>
            </article>
          </div>
        </section>
        <section class="panel">
          <div class="section-title"><h2>Offline guidance</h2></div>
          <div class="quick-grid">
            <article class="action-card aura-card aura-card--type-action" *ngFor="let item of guidance()"><strong>{{ item }}</strong><span>Operational rule</span></article>
          </div>
        </section>
      </div>

      <pre class="result-json" *ngIf="result()">{{ result() | json }}</pre>
    </section>
  `
})
export class OfflineSupportComponent implements OnInit {
  readonly summary = signal<ApiRecord | null>(null);
  readonly branches = signal<ApiRecord[]>([]);
  readonly clients = signal<ApiRecord[]>([]);
  readonly services = signal<ApiRecord[]>([]);
  readonly result = signal<ApiRecord | null>(null);
  readonly loading = signal(false);
  readonly error = signal('');
  readonly guidance = computed(() => this.summary()?.guidance || []);

  readonly cacheForm = this.fb.group({ deviceId: ['front-desk-terminal', Validators.required], branchId: ['', Validators.required] });
  readonly appointmentForm = this.fb.group({ clientId: ['', Validators.required], serviceId: ['', Validators.required], branchId: ['', Validators.required], startAt: [this.defaultLocalTime(), Validators.required] });
  readonly billingForm = this.fb.group({ clientId: ['', Validators.required], serviceId: ['', Validators.required], branchId: ['', Validators.required], mode: ['upi'] });
  readonly modules = [
    { path: '/offline/readiness', title: 'Offline Readiness Score', detail: 'Branch/device score, cache freshness, pending queue and conflict risk.', signal: 'Readiness / cache strategy' },
    { path: '/offline/devices', title: 'Device Sync Status', detail: 'Live device readiness from cache snapshots, queue load, retry state and blocked conflicts.', signal: 'PWA / tablet / staff app health' },
    { path: '/offline/sync-queue', title: 'Smart Sync Queue', detail: 'Priority sync board with retry dashboard for billing, appointments and inventory ordering.', signal: 'Retry dashboard / force sync' },
    { path: '/offline/conflicts', title: 'Conflict Resolution Center', detail: 'Server vs device conflict review and manager decision workflow.', signal: 'Keep server / device / merge' },
    { path: '/offline/billing', title: 'Offline Billing Protection', detail: 'Focused billing page with duplicate, payment and final sync safeguards.', signal: 'Invoice continuity' },
    { path: '/offline/appointments', title: 'Offline Appointment Protection', detail: 'Focused appointment queue with slot, staff and duplicate booking checks.', signal: 'Booking continuity' },
    { path: '/offline/risk-alerts', title: 'Offline Risk Alerts', detail: 'Old cache, high queue, failed sync and high-value offline billing warnings.', signal: 'Operational risk' }
  ];

  constructor(private readonly api: ApiService, private readonly fb: UntypedFormBuilder) {}

  ngOnInit(): void {
    this.loadLists();
    this.load();
  }

  loadLists(): void {
    this.api.list<ApiRecord[]>('branches').subscribe((rows) => {
      this.branches.set(rows);
      if (rows[0]) {
        this.cacheForm.patchValue({ branchId: rows[0].id });
        this.appointmentForm.patchValue({ branchId: rows[0].id });
        this.billingForm.patchValue({ branchId: rows[0].id });
      }
    });
    this.api.list<ApiRecord[]>('clients').subscribe((rows) => {
      this.clients.set(rows);
      if (rows[0]) {
        this.appointmentForm.patchValue({ clientId: rows[0].id });
        this.billingForm.patchValue({ clientId: rows[0].id });
      }
    });
    this.api.list<ApiRecord[]>('services').subscribe((rows) => {
      this.services.set(rows);
      if (rows[0]) {
        this.appointmentForm.patchValue({ serviceId: rows[0].id });
        this.billingForm.patchValue({ serviceId: rows[0].id });
      }
    });
  }

  load(): void {
    this.loading.set(true);
    this.api.list<ApiRecord>('offline/summary').subscribe({
      next: (summary) => {
        this.summary.set(summary);
        this.loading.set(false);
      },
      error: (error) => {
        this.error.set(error?.error?.error || 'Unable to load offline support');
        this.loading.set(false);
      }
    });
  }

  readinessScore(): string {
    const metrics = this.summary()?.metrics || {};
    const queued = Number(metrics.queued || 0);
    const conflicts = Number(metrics.conflicts || 0);
    const snapshots = Number(metrics.cacheSnapshots || 0);
    if (!snapshots || conflicts > 0 || queued > 50) return 'Risk';
    if (queued > 10) return 'Partial';
    return 'Ready';
  }

  readinessLabel(): string {
    const score = this.readinessScore();
    if (score === 'Ready') return 'Branch is ready for controlled offline operation.';
    if (score === 'Partial') return 'Offline operation is possible, but sync queue needs review.';
    return 'Offline operation needs attention before relying on it.';
  }

  createSnapshot(): void {
    this.api.post<ApiRecord>('offline/cache-snapshots', this.cacheForm.value).subscribe((response) => {
      this.result.set(response);
      this.load();
    });
  }

  offlineAppointment(): void {
    const value = this.appointmentForm.value;
    this.api.post<ApiRecord>('offline/appointments', {
      ...value,
      serviceIds: [value.serviceId],
      startAt: new Date(value.startAt).toISOString()
    }).subscribe((response) => {
      this.result.set(response);
      this.load();
    });
  }

  offlineBilling(): void {
    const service = this.services().find((item) => item.id === this.billingForm.value.serviceId);
    this.api.post<ApiRecord>('offline/billing', {
      clientId: this.billingForm.value.clientId,
      branchId: this.billingForm.value.branchId,
      items: [{ type: 'service', id: service?.id, quantity: 1, price: service?.price }],
      payments: [{ mode: this.billingForm.value.mode, amount: service?.price || 0 }]
    }).subscribe((response) => {
      this.result.set(response);
      this.load();
    });
  }

  sync(): void {
    this.api.post<ApiRecord>('offline/sync', {}).subscribe((response) => {
      this.result.set(response);
      this.load();
    });
  }

  defaultLocalTime(): string {
    const date = new Date(Date.now() + 3 * 60 * 60 * 1000);
    date.setMinutes(0, 0, 0);
    return date.toISOString().slice(0, 16);
  }
}
