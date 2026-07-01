import { CommonModule, CurrencyPipe, DatePipe } from '@angular/common';
import { Component, OnInit, signal } from '@angular/core';
import { FormsModule, ReactiveFormsModule, UntypedFormBuilder, Validators } from '@angular/forms';
import { ApiRecord, ApiService } from '../core/api.service';
import { StateComponent } from '../shared/ui/state/state.component';
import { AuraKpiCardComponent } from '../shared/ui/aura-kpi-card/aura-kpi-card.component';

@Component({
  selector: 'app-smart-booking',
  standalone: true,
  imports: [CommonModule, FormsModule, ReactiveFormsModule, CurrencyPipe, DatePipe, StateComponent, AuraKpiCardComponent],
  template: `
    <section class="page-stack">
      <div class="module-hero">
        <div>
          <span class="eyebrow">Level 12 · Smart booking system</span>
          <h2>Slot recommendation, staff assignment, conflict prevention, waitlist, QR check-in and queue prediction</h2>
        </div>
        <button class="ghost-button" type="button" (click)="load()">Refresh</button>
      </div>

      <app-state [loading]="loading()" [error]="error()"></app-state>

      <div class="metrics-grid" *ngIf="summary()?.metrics as metrics">
        <aura-kpi-card tone="teal" target="/kpi-details/smart-booking/open-bookings"><span>Open bookings</span><strong>{{ metrics.openBookings }}</strong></aura-kpi-card>
        <aura-kpi-card tone="amber" target="/kpi-details/smart-booking/waitlist"><span>Waitlist</span><strong>{{ metrics.waitlist }}</strong></aura-kpi-card>
        <aura-kpi-card tone="blue" target="/kpi-details/smart-booking/online-requests"><span>Online requests</span><strong>{{ metrics.onlineRequests }}</strong></aura-kpi-card>
        <aura-kpi-card tone="red" target="/kpi-details/smart-booking/conflict-risks"><span>Conflict risks</span><strong>{{ metrics.conflictRisks }}</strong></aura-kpi-card>
        <aura-kpi-card tone="green" target="/kpi-details/smart-booking/qr-check-ins"><span>QR check-ins</span><strong>{{ metrics.qrCheckinsToday }}</strong></aura-kpi-card>
        <aura-kpi-card tone="violet" target="/kpi-details/smart-booking/predicted-wait"><span>Predicted wait</span><strong>{{ metrics.predictedWaitMinutes }}m</strong></aura-kpi-card>
      </div>

      <div class="dashboard-grid">
        <section class="form-panel">
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

        <section class="panel">
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

      <section class="panel" *ngIf="recommendations().length">
        <div class="section-title">
          <div><span class="eyebrow">Smart recommendations</span><h2>Available slots</h2></div>
        </div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Slot</th><th>Staff</th><th>Chair</th><th>Score</th><th>Revenue</th><th></th></tr></thead>
            <tbody>
              <tr *ngFor="let slot of recommendations()">
                <td>{{ slot.startAt | date: 'medium' }}</td>
                <td>{{ slot.staffName }}</td>
                <td>{{ slot.chair }}</td>
                <td>{{ slot.score }}</td>
                <td>{{ slot.estimatedRevenue | currency: 'INR':'symbol':'1.0-0' }}</td>
                <td><button class="ghost-button mini" type="button" (click)="book(slot)">Book</button></td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      <div class="dashboard-grid">
        <section class="panel">
          <div class="section-title"><h2>Waitlist management</h2></div>
          <div class="rank-list">
            <article *ngFor="let item of summary()?.waitlist || []">
              <div><strong>{{ clientName(item.clientId) }}</strong><span>{{ item.status }} · {{ item.preferredDate || 'Flexible' }}</span></div>
              <button class="ghost-button mini" type="button" (click)="promote(item)" [disabled]="item.status !== 'waiting'">Promote</button>
            </article>
          </div>
        </section>

        <section class="panel">
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
    </section>
  `
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

  readonly bookingForm = this.fb.group({
    clientId: ['', Validators.required],
    serviceId: ['', Validators.required],
    branchId: ['', Validators.required],
    date: [new Date().toISOString().slice(0, 10)]
  });
  readonly qrForm = this.fb.group({ code: ['', Validators.required], branchId: ['', Validators.required] });

  constructor(private readonly api: ApiService, private readonly fb: UntypedFormBuilder) {}

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
