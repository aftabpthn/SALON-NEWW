import { CommonModule } from '@angular/common';
import { Component, OnInit, signal } from '@angular/core';
import { FormsModule, ReactiveFormsModule, UntypedFormBuilder, Validators } from '@angular/forms';
import { ApiRecord, ApiService } from '../core/api.service';
import { StateComponent } from '../shared/ui/state/state.component';
import { AuraKpiCardComponent } from '../shared/ui/aura-kpi-card/aura-kpi-card.component';
import { AuraMoneyPipe } from '../shared/pipes/aura-money.pipe';
import { AuraDatePipe } from '../shared/pipes/aura-date.pipe';

type SmartBookingViewKey = 'overview' | 'recommend' | 'queue' | 'slots' | 'waitlist' | 'qr';

@Component({
  selector: 'app-smart-booking',
  standalone: true,
  imports: [AuraDatePipe, AuraMoneyPipe, CommonModule, FormsModule, ReactiveFormsModule, StateComponent, AuraKpiCardComponent],
  template: `
    <section class="page-stack">
      <div class="module-hero">
        <div>
          <h2>Slot recommendation, staff assignment, conflict prevention, waitlist, QR check-in and queue prediction</h2>
        </div>
        <button class="ghost-button" type="button" (click)="load()">Refresh</button>
      </div>

      <app-state [loading]="loading()" [error]="error()"></app-state>

      <div class="smart-booking-workspace">
        <aside class="smart-booking-side-nav" aria-label="Smart booking pages">
          <button
            *ngFor="let view of smartBookingViews"
            class="smart-booking-nav-card"
            type="button"
            [class.active]="activeSmartBookingView() === view.key"
            (click)="setSmartBookingView(view.key)"
          >
            <span class="smart-booking-nav-icon">{{ view.icon }}</span>
            <span>
              <strong>{{ view.label }}</strong>
              <small>{{ view.description }}</small>
            </span>
            <i>{{ view.badge }}</i>
          </button>
        </aside>

        <main class="smart-booking-detail">

      <div class="metrics-grid" *ngIf="visibleSmartBookingView('overview') && summary()?.metrics as metrics">
        <aura-kpi-card tone="neutral" target="/kpi-details/smart-booking/open-bookings"><span>Open bookings</span><strong>{{ metrics.openBookings }}</strong></aura-kpi-card>
        <aura-kpi-card tone="neutral" target="/kpi-details/smart-booking/waitlist"><span>Waitlist</span><strong>{{ metrics.waitlist }}</strong></aura-kpi-card>
        <aura-kpi-card tone="neutral" target="/kpi-details/smart-booking/online-requests"><span>Online requests</span><strong>{{ metrics.onlineRequests }}</strong></aura-kpi-card>
        <aura-kpi-card tone="neutral" target="/kpi-details/smart-booking/conflict-risks"><span>Conflict risks</span><strong>{{ metrics.conflictRisks }}</strong></aura-kpi-card>
        <aura-kpi-card tone="neutral" target="/kpi-details/smart-booking/qr-check-ins"><span>QR check-ins</span><strong>{{ metrics.qrCheckinsToday }}</strong></aura-kpi-card>
        <aura-kpi-card tone="neutral" target="/kpi-details/smart-booking/predicted-wait"><span>Predicted wait</span><strong>{{ metrics.predictedWaitMinutes }}m</strong></aura-kpi-card>
      </div>

      <div class="dashboard-grid">
        <section class="form-panel" *ngIf="visibleSmartBookingView('recommend')">
          <h3>Recommend smart slots</h3>
          <form [formGroup]="bookingForm" (ngSubmit)="recommend()">
            <label class="field">
              <span>Client</span>
              <select formControlName="clientId"><option *ngFor="let client of clients()" [value]="client.id">{{ client.name }}</option></select>
            </label>
            <label class="field">
              <span>Service</span>
              <select formControlName="serviceId"><option *ngFor="let service of services()" [value]="service.id">{{ service.name }}</option></select>
            </label>
            <label class="field">
              <span>Branch</span>
              <select formControlName="branchId"><option *ngFor="let branch of branches()" [value]="branch.id">{{ branch.name }}</option></select>
            </label>
            <label class="field">
              <span>Date</span>
              <input type="date" formControlName="date" />
            </label>
            <div class="form-actions">
              <button class="ghost-button" type="button" (click)="addWaitlist()">Add waitlist</button>
              <button class="ghost-button" type="button" (click)="onlineRequest()">Online request</button>
              <button class="primary-button" type="submit">Recommend</button>
            </div>
          </form>
        </section>

        <section class="panel" *ngIf="visibleSmartBookingView('queue')">
          <div class="section-title"><h2>Queue prediction</h2></div>
          <div class="summary-lines" *ngIf="summary()?.prediction as prediction">
            <div><span>Waiting</span><strong>{{ prediction.waiting }}</strong></div>
            <div><span>Capacity</span><strong>{{ prediction.staffOnlineCapacity }}</strong></div>
            <div><span>Pressure</span><strong>{{ prediction.queuePressure }}</strong></div>
            <div><span>Predicted wait</span><strong>{{ prediction.predictedWaitMinutes }} minutes</strong></div>
          </div>
          <div class="quick-grid">
            <article class="action-card" *ngFor="let action of summary()?.prediction?.nextActions || []">
              <strong>{{ action }}</strong>
              <span>Queue action</span>
            </article>
          </div>
        </section>
      </div>

      <section class="panel" *ngIf="recommendations().length && visibleSmartBookingView('slots')">
        <div class="section-title">
          <div><h2>Available slots</h2></div>
        </div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Slot</th><th>Staff</th><th>Chair</th><th>Score</th><th>Revenue</th><th></th></tr></thead>
            <tbody>
              <tr *ngFor="let slot of recommendations()">
                <td>{{ slot.startAt | auraDate:'date' }}</td>
                <td>{{ slot.staffName }}</td>
                <td>{{ slot.chair }}</td>
                <td>{{ slot.score }}</td>
                <td>{{ slot.estimatedRevenue | auraMoney:'1.0-0' }}</td>
                <td><button class="ghost-button mini" type="button" (click)="book(slot)">Book</button></td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <div class="dashboard-grid">
        <section class="panel" *ngIf="visibleSmartBookingView('waitlist')">
          <div class="section-title"><h2>Waitlist management</h2></div>
          <div class="rank-list">
            <article *ngFor="let item of summary()?.waitlist || []">
              <div><strong>{{ clientName(item.clientId) }}</strong><span>{{ item.status }} · {{ item.preferredDate || 'Flexible' }}</span></div>
              <button class="ghost-button mini" type="button" (click)="promote(item)" [disabled]="item.status !== 'waiting'">Promote</button>
            </article>
          </div>
        </section>

        <section class="panel" *ngIf="visibleSmartBookingView('qr')">
          <div class="section-title"><h2>QR check-in</h2></div>
          <form class="pos-form" [formGroup]="qrForm" (ngSubmit)="qrCheckIn()">
            <label class="field">
              <span>Appointment ID or QR code</span>
              <input formControlName="code" />
            </label>
            <label class="field">
              <span>Branch</span>
              <select formControlName="branchId"><option *ngFor="let branch of branches()" [value]="branch.id">{{ branch.name }}</option></select>
            </label>
            <div class="form-actions"><button class="primary-button" type="submit">Check in</button></div>
          </form>
          <pre class="result-json" *ngIf="result()">{{ result() | json }}</pre>
        </section>
      </div>
        </main>
      </div>
    </section>
  `,
  styles: [`
    .smart-booking-workspace {
      display: grid;
      grid-template-columns: 315px minmax(0, 1fr);
      gap: 12px;
      align-items: start;
    }

    .smart-booking-side-nav,
    .smart-booking-detail {
      display: grid;
      gap: 10px;
    }

    .smart-booking-side-nav {
      position: sticky;
      top: 82px;
      align-self: start;
    }

    .smart-booking-nav-card {
      display: grid;
      grid-template-columns: 48px minmax(0, 1fr) auto;
      align-items: center;
      gap: 10px;
      width: 100%;
      min-height: 88px;
      padding: 14px;
      border: 1px solid var(--line);
      border-left: 3px solid var(--color-primary);
      border-radius: 8px;
      color: var(--ink);
      background: var(--surface);
      box-shadow: 0 4px 12px rgba(12, 26, 43, 0.06);
      cursor: pointer;
      text-align: left;
      transition: transform 160ms ease, box-shadow 160ms ease, border-color 160ms ease, background 160ms ease;
    }

    .smart-booking-nav-card:hover {
      transform: translateY(-2px);
      border-color: var(--color-primary);
      box-shadow: 0 8px 22px rgba(12, 26, 43, 0.1);
    }

    .smart-booking-nav-card.active {
      border-color: var(--color-primary);
      background: linear-gradient(90deg, rgba(214, 79, 146, 0.18), rgba(99, 102, 241, 0.12), rgba(245, 158, 11, 0.12));
      box-shadow: 0 8px 22px rgba(12, 26, 43, 0.12);
    }

    .smart-booking-nav-card strong,
    .smart-booking-nav-card small,
    .smart-booking-nav-card i {
      display: block;
    }

    .smart-booking-nav-card strong {
      font-size: 0.96rem;
      line-height: 1.2;
    }

    .smart-booking-nav-card small {
      margin-top: 4px;
      color: var(--muted);
      font-size: 0.72rem;
      font-weight: 800;
      line-height: 1.25;
    }

    .smart-booking-nav-card i {
      padding: 3px 8px;
      border-radius: 999px;
      color: var(--color-primary-strong);
      background: var(--surface-2);
      font-size: 0.68rem;
      font-style: normal;
      font-weight: 900;
      text-transform: uppercase;
    }

    .smart-booking-nav-icon {
      display: inline-grid;
      place-items: center;
      width: 48px;
      height: 48px;
      border-radius: 8px;
      color: var(--color-primary-strong);
      background: rgba(214, 79, 146, 0.12);
      font-weight: 900;
    }


    :host .smart-booking-workspace,
    :host .smart-booking-nav-card,
    :host .smart-booking-detail,
    :host .panel,
    :host .form-panel,
    :host .metric-card,
    :host .summary-lines,
    :host .table-wrap {
      border-color: rgba(118, 85, 76, 0.13) !important;
      border-radius: 14px !important;
      background: #fff !important;
      background-image: none !important;
      box-shadow: 0 1px 2px rgba(41, 31, 28, 0.03), 0 10px 26px rgba(73, 51, 43, 0.045) !important;
    }

    :host .smart-booking-nav-card {
      border-left-color: rgba(154, 106, 96, 0.68) !important;
    }

    :host .smart-booking-nav-card.active,
    :host .smart-booking-nav-card:hover {
      background: #fff7f3 !important;
      border-color: rgba(154, 106, 96, 0.24) !important;
      transform: translateY(-1px);
    }

    :host .smart-booking-nav-icon,
    :host .smart-booking-nav-card i,
    :host .badge {
      background: #fff7f3 !important;
      color: #75524b !important;
    }

    :host h1,
    :host h2,
    :host h3,
    :host .smart-booking-nav-card strong {
      color: #302522 !important;
      font-weight: 630 !important;
    }

    :host .smart-booking-nav-card small,
    :host p,
    :host label span,
    :host th {
      color: #766763 !important;
      font-weight: 540 !important;
    }
    @media (max-width: 1180px) {
      .smart-booking-workspace {
        grid-template-columns: 1fr;
      }

      .smart-booking-side-nav {
        position: static;
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
    }

    @media (max-width: 760px) {
      .smart-booking-side-nav {
        grid-template-columns: 1fr;
      }
    }
  `]
})
export class SmartBookingComponent implements OnInit {
  readonly summary = signal<ApiRecord | null>(null);
  readonly clients = signal<ApiRecord[]>([]);
  readonly services = signal<ApiRecord[]>([]);
  readonly branches = signal<ApiRecord[]>([]);
  readonly recommendations = signal<ApiRecord[]>([]);
  readonly result = signal<ApiRecord | null>(null);
  readonly loading = signal(false);
  readonly error = signal('');
  readonly activeSmartBookingView = signal<SmartBookingViewKey>('overview');

  readonly smartBookingViews: Array<{ key: SmartBookingViewKey; label: string; description: string; icon: string; badge: string }> = [
    { key: 'overview', label: 'Overview', description: 'Smart booking KPIs and status', icon: 'OV', badge: 'Open' },
    { key: 'recommend', label: 'Smart slots', description: 'Recommend staff, chair and time', icon: 'RS', badge: 'AI' },
    { key: 'queue', label: 'Queue prediction', description: 'Wait pressure and next actions', icon: 'QP', badge: 'Live' },
    { key: 'slots', label: 'Available slots', description: 'Ranked slot recommendations', icon: 'AS', badge: 'Book' },
    { key: 'waitlist', label: 'Waitlist', description: 'Promote waiting clients', icon: 'WL', badge: 'Ops' },
    { key: 'qr', label: 'QR check-in', description: 'Check in by appointment or QR code', icon: 'QR', badge: 'Front' }
  ];

  readonly bookingForm = this.fb.group({
    clientId: ['', Validators.required],
    serviceId: ['', Validators.required],
    branchId: ['', Validators.required],
    date: [new Date().toISOString().slice(0, 10)]
  });
  readonly qrForm = this.fb.group({ code: ['', Validators.required], branchId: ['', Validators.required] });

  constructor(private readonly api: ApiService, private readonly fb: UntypedFormBuilder) {}

  setSmartBookingView(view: SmartBookingViewKey): void {
    this.activeSmartBookingView.set(view);
  }

  visibleSmartBookingView(view: SmartBookingViewKey): boolean {
    const active = this.activeSmartBookingView();
    return active === 'overview' || active === view;
  }

  ngOnInit(): void {
    this.loadLists();
    this.load();
  }

  loadLists(): void {
    this.api.list<ApiRecord[]>('clients').subscribe((rows) => {
      this.clients.set(rows);
      if (rows[0] && !this.bookingForm.value.clientId) this.bookingForm.patchValue({ clientId: rows[0].id });
    });
    this.api.list<ApiRecord[]>('services').subscribe((rows) => {
      this.services.set(rows);
      if (rows[0] && !this.bookingForm.value.serviceId) this.bookingForm.patchValue({ serviceId: rows[0].id });
    });
    this.api.list<ApiRecord[]>('branches').subscribe((rows) => {
      this.branches.set(rows);
      if (rows[0] && !this.bookingForm.value.branchId) {
        this.bookingForm.patchValue({ branchId: rows[0].id });
        this.qrForm.patchValue({ branchId: rows[0].id });
      }
    });
  }

  load(): void {
    this.loading.set(true);
    this.api.list<ApiRecord>('smart-booking/summary').subscribe({
      next: (summary) => {
        this.summary.set(summary);
        this.loading.set(false);
      },
      error: (error) => {
        this.error.set(error?.error?.error || 'Unable to load smart booking engine');
        this.loading.set(false);
      }
    });
  }

  recommend(): void {
    this.api.post<ApiRecord>('smart-booking/recommend-slots', {
      ...this.bookingForm.value,
      serviceIds: [this.bookingForm.value.serviceId]
    }).subscribe((response) => {
      this.recommendations.set(response.recommendations || []);
      this.result.set(response.record);
      this.load();
    });
  }

  book(slot: ApiRecord): void {
    this.api.post<ApiRecord>('smart-booking/bookings', {
      clientId: this.bookingForm.value.clientId,
      branchId: this.bookingForm.value.branchId,
      serviceIds: [this.bookingForm.value.serviceId],
      staffId: slot.staffId,
      startAt: slot.startAt,
      endAt: slot.endAt,
      chair: slot.chair
    }).subscribe((response) => {
      this.result.set(response);
      this.load();
    });
  }

  addWaitlist(): void {
    this.api.post<ApiRecord>('smart-booking/waitlist', {
      clientId: this.bookingForm.value.clientId,
      branchId: this.bookingForm.value.branchId,
      serviceIds: [this.bookingForm.value.serviceId],
      preferredDate: this.bookingForm.value.date
    }).subscribe((response) => {
      this.result.set(response);
      this.load();
    });
  }

  onlineRequest(): void {
    const client = this.clients().find((item) => item.id === this.bookingForm.value.clientId);
    this.api.post<ApiRecord>('smart-booking/online-request', {
      clientId: client?.id,
      branchId: this.bookingForm.value.branchId,
      serviceIds: [this.bookingForm.value.serviceId],
      clientInfo: { name: client?.name, phone: client?.phone },
      preferences: { date: this.bookingForm.value.date }
    }).subscribe((response) => {
      this.result.set(response);
      this.load();
    });
  }

  promote(item: ApiRecord): void {
    this.api.post<ApiRecord>(`smart-booking/waitlist/${item.id}/promote`, {}).subscribe((response) => {
      this.result.set(response);
      this.load();
    });
  }

  qrCheckIn(): void {
    this.api.post<ApiRecord>('smart-booking/qr-check-in', this.qrForm.value).subscribe((response) => {
      this.result.set(response);
      this.load();
    });
  }

  clientName(id: string): string {
    return this.clients().find((item) => item.id === id)?.name || id;
  }
}
