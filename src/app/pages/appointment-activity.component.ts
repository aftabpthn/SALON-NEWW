import { CommonModule } from '@angular/common';
import { Component, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ApiRecord, ApiService } from '../core/api.service';
import { StateComponent } from '../shared/ui/state/state.component';

type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

interface AppointmentActivityRow {
  id: string;
  appointmentId: string;
  clientId: string;
  clientName: string;
  clientPhone: string;
  staffId: string;
  staffName: string;
  branchId: string;
  branchName: string;
  action: string;
  actionGroup: string;
  statusBefore: string;
  statusAfter: string;
  reason: string;
  source: string;
  changedBy: string;
  changedByRole: string;
  createdAt: string;
  appointmentStartAt: string;
  appointmentEndAt: string;
  appointmentStatus: string;
  serviceNames: string;
  changes: Array<{ category: string; field: string; oldValue: string; newValue: string }>;
  riskLevel: RiskLevel;
  riskScore: number;
  riskReasons: string[];
  riskReason: string;
  suggestedAction: string;
}

interface ClientHistory {
  client?: ApiRecord;
  stats?: ApiRecord;
  reliability?: { score?: number; riskLevel?: RiskLevel; label?: string };
  suggestions?: string[];
  timeline?: AppointmentActivityRow[];
}

interface AppointmentRegisterRow {
  id: string;
  appointmentId: string;
  bookingGroupId: string;
  clientId: string;
  clientName: string;
  clientPhone: string;
  branchId: string;
  branchName: string;
  staffId: string;
  staffName: string;
  bookingMode: string;
  bookedAt: string;
  appointmentStartAt: string;
  appointmentEndAt: string;
  durationMinutes: number;
  serviceNames: string;
  status: string;
  cancelReason: string;
  notes: string;
  createdBy: string;
  lastUpdatedBy: string;
  lastUpdatedAt: string;
  invoiceId: string;
  invoiceNumber: string;
  total: number;
  paid: number;
  balance: number;
  paymentStatus: string;
  invoiceStatus: string;
  messageStatus: { status: string; count: number; latestAt: string };
  timeline: AppointmentActivityRow[];
  timelineCount: number;
  problemFlags: string[];
}

@Component({
  selector: 'app-appointment-activity',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, StateComponent],
  template: `
    <section class="appointment-activity-page">
      <div class="module-hero">
        <div>
          <span class="eyebrow">Appointments / register</span>
          <h2>Appointment Report & Full History Register</h2>
          <p>Every appointment, booking time, status change, cancellation reason, POS invoice, payment balance and timeline in one page.</p>
        </div>
        <div class="hero-actions">
          <a class="ghost-button" routerLink="/appointments">Back to calendar</a>
          <a class="ghost-button" routerLink="/appointment-reports">Appointment reports</a>
          <button class="primary-button" type="button" (click)="refreshAll()">Refresh</button>
        </div>
      </div>

      <app-state [loading]="loading()" [error]="error()"></app-state>

      <div class="metric-grid" *ngIf="!loading()">
        <article class="metric-card" *ngFor="let card of kpiCards" [ngClass]="card.tone">
          <span>{{ card.label }}</span>
          <strong>{{ card.value }}</strong>
          <small>{{ card.hint }}</small>
        </article>
      </div>

      <section class="panel filter-panel" *ngIf="!loading()">
        <div class="section-title activity-title">
          <div>
            <span class="eyebrow">Filters</span>
            <h3>Search appointment audit trail</h3>
          </div>
          <div class="action-row">
            <span>{{ filteredRows().length }} shown</span>
            <button class="ghost-button mini" type="button" (click)="resetFilters()">Reset</button>
            <button class="ghost-button mini" type="button" (click)="applyServerFilters()">Apply server filter</button>
          </div>
        </div>

        <div class="filter-grid">
          <label class="field span-2">
            <span>Search client, phone, appointment, staff or reason</span>
            <input [(ngModel)]="search" (ngModelChange)="applyFilters()" placeholder="Client name, phone, appointment id, reason" />
          </label>
          <label class="field">
            <span>Client</span>
            <select [(ngModel)]="clientId" (ngModelChange)="loadClientHistory(); applyFilters()">
              <option value="">All clients</option>
              <option *ngFor="let client of clients()" [value]="client.id">{{ client.name }} {{ client.phone ? '- ' + client.phone : '' }}</option>
            </select>
          </label>
          <label class="field">
            <span>Staff</span>
            <select [(ngModel)]="staffId" (ngModelChange)="applyFilters()">
              <option value="">All staff</option>
              <option *ngFor="let person of staff()" [value]="person.id">{{ person.name }}</option>
            </select>
          </label>
          <label class="field">
            <span>Action</span>
            <select [(ngModel)]="action" (ngModelChange)="applyFilters()">
              <option value="">All actions</option>
              <option value="BOOKED">Booked</option>
              <option value="MODIFIED">Modified</option>
              <option value="RESCHEDULED">Rescheduled</option>
              <option value="CANCELLED">Cancelled</option>
              <option value="NO_SHOW">No-show</option>
              <option value="COMPLETED">Completed</option>
              <option value="BILLED">Billed</option>
            </select>
          </label>
          <label class="field">
            <span>Appointment status</span>
            <select [(ngModel)]="statusFilter" (ngModelChange)="applyFilters()">
              <option value="">All status</option>
              <option value="booked">Booked</option>
              <option value="confirmed">Confirmed</option>
              <option value="arrived">Arrived</option>
              <option value="in-service">In service</option>
              <option value="completed">Completed</option>
              <option value="cancelled">Cancelled</option>
              <option value="no-show">No-show</option>
              <option value="billed">Billed</option>
            </select>
          </label>
          <label class="field">
            <span>Payment status</span>
            <select [(ngModel)]="paymentStatus" (ngModelChange)="applyFilters()">
              <option value="">All payment</option>
              <option value="not_billed">Not billed</option>
              <option value="paid">Paid</option>
              <option value="partial">Partial</option>
              <option value="unpaid">Unpaid</option>
            </select>
          </label>
          <label class="field">
            <span>Risk</span>
            <select [(ngModel)]="riskLevel" (ngModelChange)="applyFilters()">
              <option value="">All risk</option>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="critical">Critical</option>
            </select>
          </label>
          <label class="field">
            <span>Branch</span>
            <select [(ngModel)]="branchId" (ngModelChange)="applyFilters()">
              <option value="">All branches</option>
              <option *ngFor="let branch of branches()" [value]="branch.id">{{ branch.name }}</option>
            </select>
          </label>
          <label class="field">
            <span>From</span>
            <input type="date" [(ngModel)]="fromDate" (ngModelChange)="applyFilters()" />
          </label>
          <label class="field">
            <span>To</span>
            <input type="date" [(ngModel)]="toDate" (ngModelChange)="applyFilters()" />
          </label>
        </div>
      </section>

      <section class="report-panel" *ngIf="!loading()">
        <div class="section-title activity-title">
          <div>
            <span class="eyebrow">Advanced reports</span>
            <h3>Cancellation, reschedule and no-show review</h3>
          </div>
          <div class="action-row">
            <span>Generated {{ formatDateTime(report()?.generatedAt || '') }}</span>
            <button class="ghost-button mini" type="button" (click)="exportCsv()" [disabled]="!exportRows.length">Export CSV</button>
            <button class="ghost-button mini" type="button" (click)="exportPdf()" [disabled]="!report()">Export PDF</button>
          </div>
        </div>

        <div class="report-grid">
          <article>
            <span>Daily change summary</span>
            <strong>{{ dailySummary.length }}</strong>
            <small>{{ report()?.summary?.cancellations || 0 }} cancellations, {{ report()?.summary?.reschedules || 0 }} reschedules</small>
          </article>
          <article>
            <span>Client watchlist</span>
            <strong>{{ clientReliability.length }}</strong>
            <small>Sorted by lowest reliability score</small>
          </article>
          <article>
            <span>Staff change risk</span>
            <strong>{{ staffRisk.length }}</strong>
            <small>Repeated edit/cancel/reschedule signals</small>
          </article>
          <article>
            <span>Top reasons</span>
            <strong>{{ cancellationReasons.length }}</strong>
            <small>Reason capture for coaching and follow-up</small>
          </article>
        </div>
      </section>

      <section class="client-reliability-panel" *ngIf="clientHistory() as history">
        <div class="section-title activity-title">
          <div>
            <span class="eyebrow">Client reliability</span>
            <h3>{{ history.client?.name || 'Selected client' }}</h3>
          </div>
          <span class="risk-pill" [ngClass]="riskClass(history.reliability?.riskLevel || 'low')">
            {{ history.reliability?.score || 100 }}% {{ history.reliability?.label || 'Reliable' }}
          </span>
        </div>
        <div class="client-stats-grid">
          <article><span>Total appointments</span><strong>{{ history.stats?.totalAppointments || 0 }}</strong></article>
          <article><span>Cancelled</span><strong>{{ history.stats?.cancellations || 0 }}</strong></article>
          <article><span>Rescheduled</span><strong>{{ history.stats?.reschedules || 0 }}</strong></article>
          <article><span>No-shows</span><strong>{{ history.stats?.noShows || 0 }}</strong></article>
          <article><span>Completed</span><strong>{{ history.stats?.completed || 0 }}</strong></article>
        </div>
        <div class="suggestion-row">
          <span *ngFor="let suggestion of history.suggestions || []">{{ suggestion }}</span>
        </div>
      </section>

      <section class="panel table-panel register-panel" *ngIf="!loading()">
        <div class="section-title activity-title">
          <div>
            <span class="eyebrow">Appointment register</span>
            <h3>Full appointment history</h3>
          </div>
          <div class="action-row">
            <span>{{ filteredRegisterRows().length }} appointment(s)</span>
            <button class="ghost-button mini" type="button" (click)="exportCsv()" [disabled]="!filteredRegisterRows().length">Export CSV</button>
            <button class="ghost-button mini" type="button" (click)="exportPdf()" [disabled]="!filteredRegisterRows().length">Export PDF</button>
          </div>
        </div>
        <div class="table-wrap" *ngIf="filteredRegisterRows().length; else emptyRegisterState">
          <table class="register-table">
            <thead>
              <tr>
                <th>Booked / appointment</th>
                <th>Client</th>
                <th>Staff / service</th>
                <th>Status</th>
                <th>Invoice / payment</th>
                <th>SMS/WA</th>
                <th>Problems</th>
                <th>View</th>
              </tr>
            </thead>
            <tbody>
              <tr *ngFor="let row of filteredRegisterRows(); trackBy: trackByRegister" [class.selected]="selectedRegister()?.id === row.id">
                <td>
                  <strong>{{ formatDateTime(row.appointmentStartAt) }}</strong>
                  <small>Booked {{ formatDateTime(row.bookedAt) }} · {{ label(row.bookingMode) }}</small>
                </td>
                <td>
                  <a [routerLink]="['/clients', row.clientId]" *ngIf="row.clientId; else plainClient">{{ row.clientName }}</a>
                  <ng-template #plainClient><strong>{{ row.clientName }}</strong></ng-template>
                  <small>{{ row.clientPhone || row.clientId }}</small>
                </td>
                <td>
                  <strong>{{ row.staffName }}</strong>
                  <small>{{ row.serviceNames || row.appointmentId }} · {{ row.durationMinutes }} min</small>
                </td>
                <td>
                  <span class="badge" [ngClass]="statusClass(row.status)">{{ label(row.status) }}</span>
                  <small>{{ row.cancelReason || row.notes || 'No note' }}</small>
                </td>
                <td>
                  <a [routerLink]="['/pos/invoices']" [queryParams]="{ search: row.invoiceNumber }" *ngIf="row.invoiceNumber; else noInvoice">{{ row.invoiceNumber }}</a>
                  <ng-template #noInvoice><strong>No invoice</strong></ng-template>
                  <small>{{ label(row.paymentStatus) }} · {{ row.total | currency: 'INR':'symbol':'1.0-0' }} / {{ row.paid | currency: 'INR':'symbol':'1.0-0' }} / {{ row.balance | currency: 'INR':'symbol':'1.0-0' }}</small>
                </td>
                <td>
                  <strong>{{ label(row.messageStatus.status) }}</strong>
                  <small>{{ row.messageStatus.count }} message(s)</small>
                </td>
                <td>
                  <span class="problem-pill" *ngFor="let flag of row.problemFlags">{{ flag }}</span>
                  <small *ngIf="!row.problemFlags.length">Clear</small>
                </td>
                <td><button class="ghost-button mini" type="button" (click)="openRegisterDetail(row)">Timeline</button></td>
              </tr>
            </tbody>
          </table>
        </div>
        <ng-template #emptyRegisterState>
          <div class="empty-state">
            <strong>No appointments found</strong>
            <span>Book an appointment or change the date/status filters.</span>
          </div>
        </ng-template>
      </section>

      <section class="panel table-panel" *ngIf="!loading()">
        <div class="section-title activity-title">
          <div>
            <span class="eyebrow">Audit trail</span>
            <h3>Status and edit activity</h3>
          </div>
          <span>{{ filteredRows().length }} activity row(s)</span>
        </div>
        <div class="table-wrap" *ngIf="filteredRows().length; else emptyState">
          <table>
            <thead>
              <tr>
                <th>Time</th>
                <th>Client</th>
                <th>Appointment</th>
                <th>Staff</th>
                <th>Action</th>
                <th>Status</th>
                <th>Reason</th>
                <th>Risk</th>
                <th>View</th>
              </tr>
            </thead>
            <tbody>
              <tr *ngFor="let row of filteredRows(); trackBy: trackByRow" [class.selected]="selected()?.id === row.id">
                <td>
                  <strong>{{ formatDate(row.createdAt) }}</strong>
                  <small>{{ formatTime(row.createdAt) }}</small>
                </td>
                <td>
                  <strong>{{ row.clientName }}</strong>
                  <small>{{ row.clientPhone || row.clientId }}</small>
                </td>
                <td>
                  <strong>{{ row.serviceNames || row.appointmentId }}</strong>
                  <small>{{ formatDateTime(row.appointmentStartAt) }}</small>
                </td>
                <td>{{ row.staffName }}</td>
                <td><span class="badge" [ngClass]="actionClass(row.action)">{{ actionLabel(row.action) }}</span></td>
                <td>
                  <strong>{{ label(row.statusAfter || row.appointmentStatus) }}</strong>
                  <small>{{ row.statusBefore ? label(row.statusBefore) + ' -> ' + label(row.statusAfter) : row.source }}</small>
                </td>
                <td>{{ row.reason || '-' }}</td>
                <td>
                  <span class="risk-pill" [ngClass]="riskClass(row.riskLevel)">{{ label(row.riskLevel) }} {{ row.riskScore }}</span>
                  <small>{{ row.riskReason }}</small>
                </td>
                <td><button class="ghost-button mini" type="button" (click)="openDetail(row)">Review</button></td>
              </tr>
            </tbody>
          </table>
        </div>
        <ng-template #emptyState>
          <div class="empty-state">
            <strong>No appointment activity found</strong>
            <span>Create, cancel, reschedule, complete or update appointments to build the timeline.</span>
          </div>
        </ng-template>
      </section>

      <aside class="detail-drawer" *ngIf="selectedRegister() as register">
        <header>
          <div>
            <span class="eyebrow">Appointment full history</span>
            <h3>{{ register.clientName }} - {{ label(register.status) }}</h3>
            <p>{{ register.serviceNames || register.appointmentId }} with {{ register.staffName }} at {{ formatDateTime(register.appointmentStartAt) }}</p>
          </div>
          <button class="ghost-button mini" type="button" (click)="selectedRegister.set(null)">Close</button>
        </header>

        <div class="detail-grid">
          <article><span>Booked</span><strong>{{ formatDateTime(register.bookedAt) }}</strong><small>{{ label(register.bookingMode) }} · {{ register.createdBy }}</small></article>
          <article><span>Appointment</span><strong>{{ formatDateTime(register.appointmentStartAt) }}</strong><small>{{ register.durationMinutes }} minutes</small></article>
          <article><span>Invoice</span><strong>{{ register.invoiceNumber || 'No invoice' }}</strong><small>{{ label(register.paymentStatus) }} · Due {{ register.balance | currency: 'INR':'symbol':'1.0-0' }}</small></article>
          <article><span>Last update</span><strong>{{ register.lastUpdatedBy }}</strong><small>{{ formatDateTime(register.lastUpdatedAt) }}</small></article>
        </div>

        <section>
          <div class="section-title activity-title">
            <div>
              <span class="eyebrow">Timeline</span>
              <h3>Booked to current status</h3>
            </div>
            <span>{{ register.timelineCount }} event(s)</span>
          </div>
          <div class="timeline-list" *ngIf="register.timeline.length; else noTimeline">
            <article *ngFor="let event of register.timeline">
              <span class="badge" [ngClass]="actionClass(event.action)">{{ actionLabel(event.action) }}</span>
              <div>
                <strong>{{ formatDateTime(event.createdAt) }}</strong>
                <p>{{ event.reason || event.riskReason || 'Routine appointment update' }}</p>
                <small>{{ event.changedBy }} · {{ event.changedByRole }} · {{ label(event.source) }}</small>
              </div>
            </article>
          </div>
          <ng-template #noTimeline><div class="empty-state compact"><strong>No timeline events captured yet</strong></div></ng-template>
        </section>

        <section>
          <div class="section-title activity-title">
            <div>
              <span class="eyebrow">Problem finder</span>
              <h3>Attention points</h3>
            </div>
          </div>
          <div class="risk-reasons" *ngIf="register.problemFlags.length; else noProblems">
            <span *ngFor="let flag of register.problemFlags">{{ flag }}</span>
          </div>
          <ng-template #noProblems><div class="empty-state compact"><strong>No problem found</strong></div></ng-template>
        </section>
      </aside>

      <aside class="detail-drawer" *ngIf="!selectedRegister() && selected() as row">
        <header>
          <div>
            <span class="eyebrow">Activity detail</span>
            <h3>{{ actionLabel(row.action) }} - {{ row.clientName }}</h3>
            <p>{{ row.serviceNames || row.appointmentId }} with {{ row.staffName }} at {{ formatDateTime(row.appointmentStartAt) }}</p>
          </div>
          <button class="ghost-button mini" type="button" (click)="selected.set(null)">Close</button>
        </header>

        <div class="detail-grid">
          <article><span>Changed by</span><strong>{{ row.changedBy }}</strong><small>{{ row.changedByRole }}</small></article>
          <article><span>Branch</span><strong>{{ row.branchName }}</strong><small>{{ row.branchId }}</small></article>
          <article><span>Source</span><strong>{{ label(row.source) }}</strong><small>{{ row.reason || 'No reason captured' }}</small></article>
          <article><span>Risk</span><strong>{{ label(row.riskLevel) }} {{ row.riskScore }}</strong><small>{{ row.suggestedAction }}</small></article>
        </div>

        <section>
          <div class="section-title activity-title">
            <div>
              <span class="eyebrow">Before / after</span>
              <h3>Changed fields</h3>
            </div>
          </div>
          <div class="change-list" *ngIf="row.changes.length; else noChanges">
            <article *ngFor="let change of row.changes">
              <span>{{ change.category }}</span>
              <strong>{{ change.field }}</strong>
              <p><em>{{ change.oldValue || '-' }}</em><b>-></b><em>{{ change.newValue || '-' }}</em></p>
            </article>
          </div>
          <ng-template #noChanges><div class="empty-state compact"><strong>No field-level changes captured</strong></div></ng-template>
        </section>

        <section>
          <div class="section-title activity-title">
            <div>
              <span class="eyebrow">Risk reasons</span>
              <h3>Smart detection signals</h3>
            </div>
          </div>
          <div class="risk-reasons">
            <span *ngFor="let reason of row.riskReasons">{{ reason }}</span>
          </div>
        </section>
      </aside>
    </section>
  `,
  styles: [`
    .appointment-activity-page {
      display: grid;
      gap: 18px;
    }

    .module-hero,
    .panel,
    .report-panel,
    .client-reliability-panel,
    .detail-drawer {
      border: 1px solid var(--line);
      border-radius: var(--radius-md);
      background: var(--surface);
      box-shadow: 0 12px 26px rgba(15, 23, 42, 0.05);
    }

    .module-hero,
    .section-title,
    .detail-drawer header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 14px;
    }

    .module-hero {
      padding: 20px 22px;
    }

    .module-hero h2,
    .section-title h3,
    .detail-drawer h3 {
      margin: 0;
      color: var(--ink);
    }

    .module-hero p,
    .detail-drawer p,
    small {
      color: var(--muted);
    }

    .hero-actions,
    .action-row,
    .suggestion-row {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: 10px;
      flex-wrap: wrap;
    }

    .metric-grid {
      display: grid;
      grid-template-columns: repeat(6, minmax(150px, 1fr));
      gap: 12px;
    }

    .metric-card,
    .report-grid article,
    .client-stats-grid article,
    .detail-grid article,
    .change-list article {
      border: 1px solid var(--line);
      border-radius: 8px;
      background: #fff;
      padding: 14px;
    }

    .metric-card {
      border-top: 4px solid var(--teal);
    }

    .metric-card.red { border-top-color: var(--danger); }
    .metric-card.amber { border-top-color: #b7791f; }
    .metric-card.blue { border-top-color: #2563eb; }
    .metric-card.green { border-top-color: #15803d; }

    .metric-card span,
    .report-grid span,
    .client-stats-grid span,
    .detail-grid span,
    .change-list span,
    .field span {
      color: var(--muted);
      font-size: 0.74rem;
      font-weight: 800;
      text-transform: uppercase;
    }

    .metric-card strong {
      display: block;
      margin: 8px 0 4px;
      color: var(--ink);
      font-size: 1.5rem;
    }

    .filter-panel,
    .table-panel,
    .report-panel,
    .client-reliability-panel,
    .detail-drawer {
      padding: 18px;
    }

    .activity-title {
      margin-bottom: 14px;
    }

    .filter-grid {
      display: grid;
      grid-template-columns: repeat(6, minmax(0, 1fr));
      gap: 12px;
    }

    .span-2 {
      grid-column: span 2;
    }

    .field {
      display: grid;
      gap: 5px;
    }

    input,
    select {
      min-height: 38px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: #fff;
      padding: 0 10px;
      color: var(--ink);
    }

    .report-grid,
    .client-stats-grid,
    .detail-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
      gap: 12px;
    }

    .suggestion-row {
      justify-content: flex-start;
      margin-top: 12px;
    }

    .suggestion-row span,
    .risk-reasons span {
      border: 1px solid #cfe3df;
      border-radius: 999px;
      background: #f1fbf8;
      color: #0f766e;
      padding: 6px 10px;
      font-weight: 800;
      font-size: 0.82rem;
    }

    .table-wrap {
      overflow-x: auto;
    }

    table {
      width: 100%;
      border-collapse: collapse;
      min-width: 1080px;
    }

    th,
    td {
      border-bottom: 1px solid var(--line);
      padding: 12px 10px;
      text-align: left;
      vertical-align: top;
    }

    th {
      color: var(--muted);
      font-size: 0.75rem;
      text-transform: uppercase;
    }

    td strong,
    td small {
      display: block;
    }

    tr.selected {
      background: #f8fbff;
    }

    .badge,
    .risk-pill,
    .problem-pill {
      display: inline-flex;
      align-items: center;
      min-height: 24px;
      border-radius: 999px;
      padding: 3px 9px;
      font-size: 0.75rem;
      font-weight: 900;
    }

    .problem-pill {
      margin: 2px 4px 2px 0;
      background: #fff0ec;
      color: #b42318;
    }

    .badge.booking,
    .risk-pill.low {
      background: #e7f7f2;
      color: #0f766e;
    }

    .badge.change,
    .risk-pill.medium {
      background: #fff7dc;
      color: #9a5b00;
    }

    .badge.cancellation,
    .risk-pill.high,
    .risk-pill.critical {
      background: #fff0ec;
      color: #b42318;
    }

    .badge.service,
    .badge.billing {
      background: #ecf3ff;
      color: #2f5fbd;
    }

    .detail-drawer {
      display: grid;
      gap: 16px;
    }

    .change-list {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 12px;
    }

    .timeline-list {
      display: grid;
      gap: 10px;
    }

    .timeline-list article {
      display: grid;
      grid-template-columns: auto 1fr;
      align-items: start;
      gap: 12px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: #fff;
      padding: 12px;
    }

    .timeline-list p {
      margin: 4px 0;
      color: var(--ink);
    }

    .change-list p {
      display: flex;
      align-items: center;
      gap: 8px;
      margin: 8px 0 0;
    }

    .change-list em {
      color: var(--ink);
      font-style: normal;
    }

    .risk-reasons {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
    }

    .empty-state {
      display: grid;
      place-items: center;
      min-height: 160px;
      color: var(--muted);
      text-align: center;
      gap: 6px;
    }

    .empty-state.compact {
      min-height: 80px;
      border: 1px dashed var(--line);
      border-radius: 8px;
    }

    @media (max-width: 980px) {
      .module-hero,
      .section-title,
      .detail-drawer header {
        align-items: flex-start;
        flex-direction: column;
      }

      .metric-grid,
      .filter-grid {
        grid-template-columns: 1fr;
      }

      .span-2 {
        grid-column: span 1;
      }
    }
  `]
})
export class AppointmentActivityComponent implements OnInit {
  loading = signal(false);
  error = signal('');
  rows = signal<AppointmentActivityRow[]>([]);
  filteredRows = signal<AppointmentActivityRow[]>([]);
  selected = signal<AppointmentActivityRow | null>(null);
  registerRows = signal<AppointmentRegisterRow[]>([]);
  filteredRegisterRows = signal<AppointmentRegisterRow[]>([]);
  selectedRegister = signal<AppointmentRegisterRow | null>(null);
  report = signal<ApiRecord | null>(null);
  registerReport = signal<ApiRecord | null>(null);
  clientHistory = signal<ClientHistory | null>(null);
  clients = signal<ApiRecord[]>([]);
  staff = signal<ApiRecord[]>([]);
  branches = signal<ApiRecord[]>([]);

  search = '';
  clientId = '';
  staffId = '';
  branchId = '';
  action = '';
  riskLevel = '';
  statusFilter = '';
  paymentStatus = '';
  fromDate = '';
  toDate = '';

  kpiCards: Array<{ label: string; value: string | number; hint: string; tone: string }> = [];
  dailySummary: ApiRecord[] = [];
  staffRisk: ApiRecord[] = [];
  clientReliability: ApiRecord[] = [];
  cancellationReasons: ApiRecord[] = [];
  exportRows: ApiRecord[] = [];

  constructor(private readonly api: ApiService) {}

  ngOnInit(): void {
    this.refreshAll();
  }

  refreshAll(): void {
    this.loadLookups();
    this.loadRegister();
    this.loadActivity();
    this.loadReport();
  }

  loadLookups(): void {
    this.api.list<ApiRecord[]>('clients', { limit: 1000 }).subscribe({ next: (rows) => this.clients.set(rows || []), error: () => this.clients.set([]) });
    this.api.list<ApiRecord[]>('staff-os/staff', { limit: 1000, status: 'active' }).subscribe({ next: (rows) => this.staff.set(rows || []), error: () => this.staff.set([]) });
    this.api.list<ApiRecord[]>('branches', { limit: 1000 }).subscribe({ next: (rows) => this.branches.set(rows || []), error: () => this.branches.set([]) });
  }

  loadRegister(params: ApiRecord = {}): void {
    this.api.list<ApiRecord>('appointment-activity/register', { limit: 1000, ...params }).subscribe({
      next: (response) => {
        this.registerReport.set(response || {});
        const rows = Array.isArray(response?.rows) ? response.rows : [];
        this.registerRows.set(rows.map((row) => this.normalizeRegisterRow(row)));
        this.applyFilters();
        this.rebuildKpis();
      },
      error: () => {
        this.registerReport.set(null);
        this.registerRows.set([]);
        this.filteredRegisterRows.set([]);
      }
    });
  }

  loadActivity(params: ApiRecord = {}): void {
    this.loading.set(true);
    this.error.set('');
    this.api.list<{ rows?: ApiRecord[] }>('appointment-activity', { limit: 1000, ...params }).subscribe({
      next: (response) => {
        this.rows.set((response.rows || []).map((row) => this.normalizeRow(row)));
        this.applyFilters();
        this.rebuildKpis();
        this.loading.set(false);
      },
      error: (error) => {
        this.error.set(error?.error?.error || error?.message || 'Unable to load appointment activity');
        this.loading.set(false);
      }
    });
  }

  loadReport(params: ApiRecord = {}): void {
    this.api.list<ApiRecord>('appointment-activity/reports', { limit: 1000, ...params }).subscribe({
      next: (report) => {
        this.report.set(report || {});
        this.dailySummary = Array.isArray(report?.dailySummary) ? report.dailySummary : [];
        this.staffRisk = Array.isArray(report?.staffRisk) ? report.staffRisk : [];
        this.clientReliability = Array.isArray(report?.clientReliability) ? report.clientReliability : [];
        this.cancellationReasons = Array.isArray(report?.cancellationReasons) ? report.cancellationReasons : [];
        this.exportRows = Array.isArray(report?.exportRows) ? report.exportRows : [];
        this.rebuildKpis();
      },
      error: () => {
        this.report.set(null);
        this.exportRows = [];
      }
    });
  }

  applyServerFilters(): void {
    const params = this.filterParams();
    this.loadRegister(params);
    this.loadActivity(params);
    this.loadReport(params);
  }

  applyFilters(): void {
    const query = this.search.trim().toLowerCase();
    const from = this.fromDate ? new Date(`${this.fromDate}T00:00:00`).getTime() : 0;
    const to = this.toDate ? new Date(`${this.toDate}T23:59:59`).getTime() : 0;
    this.filteredRegisterRows.set(this.registerRows().filter((row) => {
      const haystack = [
        row.appointmentId,
        row.clientName,
        row.clientPhone,
        row.staffName,
        row.branchName,
        row.serviceNames,
        row.bookingMode,
        row.status,
        row.cancelReason,
        row.notes,
        row.invoiceNumber,
        row.paymentStatus,
        row.problemFlags.join(' ')
      ].join(' ').toLowerCase();
      const appointmentTime = new Date(row.appointmentStartAt || row.bookedAt).getTime();
      return (!query || haystack.includes(query))
        && (!this.clientId || row.clientId === this.clientId)
        && (!this.staffId || row.staffId === this.staffId)
        && (!this.branchId || row.branchId === this.branchId)
        && (!this.statusFilter || row.status.toLowerCase() === this.statusFilter)
        && (!this.paymentStatus || row.paymentStatus === this.paymentStatus)
        && (!from || appointmentTime >= from)
        && (!to || appointmentTime <= to);
    }));
    this.filteredRows.set(this.rows().filter((row) => {
      const haystack = [
        row.appointmentId,
        row.clientName,
        row.clientPhone,
        row.staffName,
        row.branchName,
        row.action,
        row.reason,
        row.riskReason,
        row.suggestedAction
      ].join(' ').toLowerCase();
      const created = new Date(row.createdAt).getTime();
      return (!query || haystack.includes(query))
        && (!this.clientId || row.clientId === this.clientId)
        && (!this.staffId || row.staffId === this.staffId)
        && (!this.branchId || row.branchId === this.branchId)
        && (!this.action || row.action === this.action)
        && (!this.riskLevel || row.riskLevel === this.riskLevel)
        && (!from || created >= from)
        && (!to || created <= to);
    }));
    this.rebuildKpis();
  }

  resetFilters(): void {
    this.search = '';
    this.clientId = '';
    this.staffId = '';
    this.branchId = '';
    this.action = '';
    this.riskLevel = '';
    this.statusFilter = '';
    this.paymentStatus = '';
    this.fromDate = '';
    this.toDate = '';
    this.clientHistory.set(null);
    this.applyFilters();
  }

  loadClientHistory(): void {
    if (!this.clientId) {
      this.clientHistory.set(null);
      return;
    }
    this.api.list<ClientHistory>(`appointment-activity/clients/${this.clientId}`, { limit: 500 }).subscribe({
      next: (history) => this.clientHistory.set(history),
      error: () => this.clientHistory.set(null)
    });
  }

  openDetail(row: AppointmentActivityRow): void {
    this.selectedRegister.set(null);
    this.selected.set(row);
    if (!this.clientId && row.clientId) {
      this.clientId = row.clientId;
      this.loadClientHistory();
    }
  }

  openRegisterDetail(row: AppointmentRegisterRow): void {
    this.selected.set(null);
    this.selectedRegister.set(row);
    if (!this.clientId && row.clientId) {
      this.clientId = row.clientId;
      this.loadClientHistory();
    }
  }

  exportCsv(): void {
    const registerRows = this.filteredRegisterRows();
    if (registerRows.length) {
      const headers = ['bookedAt', 'appointmentStartAt', 'clientName', 'clientPhone', 'staffName', 'serviceNames', 'status', 'cancelReason', 'paymentStatus', 'invoiceNumber', 'total', 'paid', 'balance', 'bookingMode', 'createdBy', 'lastUpdatedBy', 'problemFlags'];
      const csv = [
        headers.join(','),
        ...registerRows.map((row) => headers.map((header) => this.csvCell(header === 'problemFlags' ? row.problemFlags.join('; ') : (row as unknown as ApiRecord)[header])).join(','))
      ].join('\n');
      this.downloadFile(`appointment-register-${this.todayKey()}.csv`, csv, 'text/csv;charset=utf-8');
      return;
    }
    if (!this.exportRows.length) return;
    const headers = Object.keys(this.exportRows[0]);
    const csv = [
      headers.join(','),
      ...this.exportRows.map((row) => headers.map((header) => this.csvCell(row[header])).join(','))
    ].join('\n');
    this.downloadFile(`appointment-register-${this.todayKey()}.csv`, csv, 'text/csv;charset=utf-8');
  }

  exportPdf(): void {
    const report = this.report();
    if (!report) return;
    const lines = [
      'Aura Salon OS - Appointment Activity Report',
      `Generated: ${this.formatDateTime(report.generatedAt || new Date().toISOString())}`,
      `Appointments: ${this.filteredRegisterRows().length}`,
      `Unpaid amount: ${this.formatMoney(this.filteredRegisterRows().reduce((sum, row) => sum + row.balance, 0))}`,
      `Activities: ${report.summary?.totalActivities || 0}`,
      `Cancellations: ${report.summary?.cancellations || 0} | Reschedules: ${report.summary?.reschedules || 0} | No-shows: ${report.summary?.noShows || 0}`,
      '',
      'Lowest reliability clients',
      ...this.clientReliability.slice(0, 15).map((row) => `${row.clientName}: ${row.reliabilityScore}% (${row.cancellations} cancel, ${row.reschedules} reschedule, ${row.noShows} no-show)`),
      '',
      'Daily activity',
      ...this.dailySummary.slice(0, 15).map((row) => `${row.date}: ${row.total} activity, ${row.cancellations} cancel, ${row.reschedules} reschedule`)
    ];
    this.downloadFile(`appointment-register-${this.todayKey()}.pdf`, this.simplePdf(lines), 'application/pdf');
  }

  private filterParams(): ApiRecord {
    return {
      q: this.search.trim(),
      clientId: this.clientId,
      staffId: this.staffId,
      branchId: this.branchId,
      action: this.action,
      riskLevel: this.riskLevel,
      status: this.statusFilter,
      paymentStatus: this.paymentStatus,
      from: this.fromDate,
      to: this.toDate
    };
  }

  private rebuildKpis(): void {
    const rows = this.filteredRows();
    const registerRows = this.filteredRegisterRows();
    const report = this.report();
    const completed = registerRows.filter((row) => ['completed', 'billed', 'paid'].includes(row.status.toLowerCase())).length;
    const cancelled = registerRows.filter((row) => ['cancelled', 'canceled', 'no-show'].includes(row.status.toLowerCase())).length;
    const pending = registerRows.filter((row) => !['completed', 'billed', 'paid', 'cancelled', 'canceled', 'no-show', 'deleted'].includes(row.status.toLowerCase())).length;
    this.kpiCards = [
      { label: 'Appointments', value: registerRows.length, hint: 'One row per appointment', tone: 'blue' },
      { label: 'Completed', value: completed, hint: 'Ready or already billed', tone: 'green' },
      { label: 'Cancelled', value: cancelled, hint: 'Cancelled and no-show cases', tone: 'red' },
      { label: 'Pending', value: pending, hint: 'Open appointments', tone: 'amber' },
      { label: 'Unpaid', value: this.formatMoney(registerRows.reduce((sum, row) => sum + row.balance, 0)), hint: 'Pending invoice balance', tone: 'red' },
      { label: 'Problems', value: registerRows.filter((row) => row.problemFlags.length).length || report?.summary?.highRiskActivities || rows.filter((row) => ['high', 'critical'].includes(row.riskLevel)).length, hint: 'Review recommended', tone: 'red' }
    ];
  }

  private normalizeRow(row: ApiRecord): AppointmentActivityRow {
    const riskLevel = String(row.riskLevel || 'low').toLowerCase() as RiskLevel;
    return {
      id: String(row.id || ''),
      appointmentId: String(row.appointmentId || ''),
      clientId: String(row.clientId || ''),
      clientName: String(row.clientName || 'Unknown client'),
      clientPhone: String(row.clientPhone || ''),
      staffId: String(row.staffId || ''),
      staffName: String(row.staffName || 'Unassigned'),
      branchId: String(row.branchId || ''),
      branchName: String(row.branchName || row.branchId || ''),
      action: String(row.action || 'MODIFIED'),
      actionGroup: String(row.actionGroup || ''),
      statusBefore: String(row.statusBefore || ''),
      statusAfter: String(row.statusAfter || ''),
      reason: String(row.reason || ''),
      source: String(row.source || ''),
      changedBy: String(row.changedBy || 'system'),
      changedByRole: String(row.changedByRole || 'system'),
      createdAt: this.dateValue(row.createdAt),
      appointmentStartAt: String(row.appointmentStartAt || row.newData?.startAt || ''),
      appointmentEndAt: String(row.appointmentEndAt || row.newData?.endAt || ''),
      appointmentStatus: String(row.appointmentStatus || row.statusAfter || ''),
      serviceNames: String(row.serviceNames || ''),
      changes: Array.isArray(row.changes) ? row.changes : [],
      riskLevel: ['low', 'medium', 'high', 'critical'].includes(riskLevel) ? riskLevel : 'low',
      riskScore: Number(row.riskScore || 0),
      riskReasons: Array.isArray(row.riskReasons) ? row.riskReasons.map((item: unknown) => String(item)) : [String(row.riskReason || 'Routine appointment activity.')],
      riskReason: String(row.riskReason || row.riskReasons?.[0] || 'Routine appointment activity.'),
      suggestedAction: String(row.suggestedAction || 'Monitor during routine booking review.')
    };
  }

  private normalizeRegisterRow(row: ApiRecord): AppointmentRegisterRow {
    const timeline = Array.isArray(row.timeline) ? row.timeline.map((event) => this.normalizeRow(event)) : [];
    return {
      id: String(row.id || row.appointmentId || ''),
      appointmentId: String(row.appointmentId || row.id || ''),
      bookingGroupId: String(row.bookingGroupId || ''),
      clientId: String(row.clientId || ''),
      clientName: String(row.clientName || 'Unknown client'),
      clientPhone: String(row.clientPhone || ''),
      branchId: String(row.branchId || ''),
      branchName: String(row.branchName || row.branchId || ''),
      staffId: String(row.staffId || ''),
      staffName: String(row.staffName || 'Unassigned'),
      bookingMode: String(row.bookingMode || 'manual'),
      bookedAt: this.dateValue(row.bookedAt || row.createdAt),
      appointmentStartAt: this.dateValue(row.appointmentStartAt || row.startAt),
      appointmentEndAt: this.dateValue(row.appointmentEndAt || row.endAt),
      durationMinutes: Number(row.durationMinutes || 0),
      serviceNames: String(row.serviceNames || ''),
      status: String(row.status || 'booked'),
      cancelReason: String(row.cancelReason || ''),
      notes: String(row.notes || ''),
      createdBy: String(row.createdBy || 'system'),
      lastUpdatedBy: String(row.lastUpdatedBy || 'system'),
      lastUpdatedAt: this.dateValue(row.lastUpdatedAt || row.updatedAt),
      invoiceId: String(row.invoiceId || ''),
      invoiceNumber: String(row.invoiceNumber || ''),
      total: Number(row.total || 0),
      paid: Number(row.paid || 0),
      balance: Number(row.balance || 0),
      paymentStatus: String(row.paymentStatus || 'not_billed'),
      invoiceStatus: String(row.invoiceStatus || ''),
      messageStatus: {
        status: String(row.messageStatus?.status || 'not_sent'),
        count: Number(row.messageStatus?.count || 0),
        latestAt: String(row.messageStatus?.latestAt || '')
      },
      timeline,
      timelineCount: Number(row.timelineCount || timeline.length),
      problemFlags: Array.isArray(row.problemFlags) ? row.problemFlags.map((item: unknown) => String(item)) : []
    };
  }

  trackByRow(_index: number, row: AppointmentActivityRow): string {
    return row.id;
  }

  trackByRegister(_index: number, row: AppointmentRegisterRow): string {
    return row.id;
  }

  actionLabel(action: string): string {
    const labels: Record<string, string> = {
      BOOKED: 'Booked',
      MODIFIED: 'Modified',
      RESCHEDULED: 'Rescheduled',
      CANCELLED: 'Cancelled',
      NO_SHOW: 'No-show',
      COMPLETED: 'Completed',
      ARRIVED: 'Arrived',
      STARTED: 'Started',
      BILLED: 'Billed',
      DUPLICATED: 'Duplicated',
      STATUS_CHANGED: 'Status changed',
      DELETED: 'Deleted'
    };
    return labels[action] || this.label(action);
  }

  actionClass(action: string): string {
    if (['CANCELLED', 'NO_SHOW', 'DELETED'].includes(action)) return 'cancellation';
    if (['RESCHEDULED', 'MODIFIED', 'STATUS_CHANGED'].includes(action)) return 'change';
    if (['COMPLETED', 'ARRIVED', 'STARTED'].includes(action)) return 'service';
    if (action === 'BILLED') return 'billing';
    return 'booking';
  }

  statusClass(status: string): string {
    const normalized = String(status || '').toLowerCase();
    if (['cancelled', 'canceled', 'no-show', 'deleted'].includes(normalized)) return 'cancellation';
    if (['completed', 'billed', 'paid'].includes(normalized)) return 'service';
    if (['arrived', 'in-service', 'started'].includes(normalized)) return 'billing';
    return 'booking';
  }

  riskClass(level: string): string {
    return ['low', 'medium', 'high', 'critical'].includes(level) ? level : 'low';
  }

  label(value = ''): string {
    return String(value || '-').replace(/[_-]/g, ' ').replace(/\b\w/g, (match) => match.toUpperCase());
  }

  formatDate(value: string): string {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '-';
    return new Intl.DateTimeFormat('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }).format(date);
  }

  formatTime(value: string): string {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '-';
    return new Intl.DateTimeFormat('en-IN', { hour: '2-digit', minute: '2-digit' }).format(date);
  }

  formatDateTime(value: string): string {
    if (!value) return '-';
    return `${this.formatDate(value)} ${this.formatTime(value)}`;
  }

  formatMoney(value: number): string {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(Number(value || 0));
  }

  private dateValue(value: unknown): string {
    const date = new Date(String(value || ''));
    return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
  }

  private csvCell(value: unknown): string {
    return `"${String(value ?? '').replace(/"/g, '""')}"`;
  }

  private downloadFile(filename: string, content: BlobPart, type: string): void {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  private todayKey(): string {
    return new Date().toISOString().slice(0, 10);
  }

  private simplePdf(lines: string[]): string {
    const stream = [
      'BT',
      '/F1 10 Tf',
      '50 780 Td',
      '14 TL',
      ...lines.slice(0, 75).flatMap((line) => [`(${this.pdfText(line).slice(0, 110)}) Tj`, 'T*']),
      'ET'
    ].join('\n');
    const objects = [
      '1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n',
      '2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n',
      '3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>\nendobj\n',
      '4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n',
      `5 0 obj\n<< /Length ${stream.length} >>\nstream\n${stream}\nendstream\nendobj\n`
    ];
    let pdf = '%PDF-1.4\n';
    const offsets: number[] = [];
    objects.forEach((object) => {
      offsets.push(pdf.length);
      pdf += object;
    });
    const xrefOffset = pdf.length;
    pdf += `xref\n0 ${objects.length + 1}\n`;
    pdf += '0000000000 65535 f \n';
    pdf += offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
    pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
    return pdf;
  }

  private pdfText(value: unknown): string {
    return String(value ?? '')
      .replace(/[^\x09\x0A\x0D\x20-\x7E]/g, ' ')
      .replace(/[\\()]/g, '\\$&')
      .replace(/[\r\n]+/g, ' ');
  }
}
