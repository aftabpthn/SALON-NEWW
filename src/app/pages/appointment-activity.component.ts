import { CommonModule } from '@angular/common';
import { Component, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { AuthSessionService } from '../core/auth-session.service';
import { grantsAllow, staticGrantsForRole } from '../core/permission.guard';
import { routePermissionForPath } from '../core/access-rules';
import { AppStateService } from '../core/state/app-state.service';
import { ApiRecord, ApiService } from '../core/api.service';
import { StateComponent } from '../shared/ui/state/state.component';
import { AuraMoneyPipe } from '../shared/pipes/aura-money.pipe';

type RiskLevel = 'low' | 'medium' | 'high' | 'critical';
type ActivityViewKey = 'overview' | 'alerts' | 'insights' | 'filters' | 'review' | 'client' | 'register' | 'activity';

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

interface SmartAlert {
  level: 'high' | 'medium' | 'low';
  title: string;
  detail: string;
  action: string;
  appointmentId: string;
  clientName: string;
}

interface StaffPerformanceRow {
  staffId: string;
  staffName: string;
  appointments: number;
  completed: number;
  cancelled: number;
  noShows: number;
  notBilled: number;
  revenue: number;
  due: number;
  averageDuration: number;
  completionRate: number;
}

interface ClientScoreRow {
  clientId: string;
  clientName: string;
  clientPhone: string;
  appointments: number;
  completed: number;
  cancelled: number;
  noShows: number;
  due: number;
  score: number;
  label: string;
  suggestion: string;
}

@Component({
  selector: 'app-appointment-activity',
  standalone: true,
  imports: [AuraMoneyPipe, CommonModule, FormsModule, RouterLink, StateComponent],
  template: `
    <section class="appointment-activity-page inner-page-shell">
      <div class="module-hero inner-page-header">
        <div>
          <h2>Appointment Report & Full History Register</h2>
        </div>
        <div class="hero-actions">
          <a class="ghost-button" routerLink="/appointments">Back to calendar</a>
          <a class="ghost-button" routerLink="/appointment-reports">Appointment reports</a>
          <button class="primary-button" type="button" (click)="refreshAll()">Refresh</button>
        </div>
      </div>

      <app-state [loading]="loading()" [error]="error()"></app-state>

      <div class="activity-workspace">
        <aside class="activity-side-nav" aria-label="Appointment activity pages">
          <button
            *ngFor="let view of activityViews"
            class="activity-nav-card"
            type="button"
            [class.active]="activeActivityView() === view.key"
            (click)="setActivityView(view.key)"
          >
            <span class="activity-nav-icon">{{ view.icon }}</span>
            <span>
              <strong>{{ view.label }}</strong>
              <small>{{ view.description }}</small>
            </span>
            <i>{{ view.badge }}</i>
          </button>
        </aside>

        <main class="activity-detail">

      <div class="metric-grid inner-stats-grid" *ngIf="!loading() && visibleActivityView('overview')">
        <article class="metric-card" *ngFor="let card of kpiCards" [ngClass]="card.tone">
          <span>{{ card.label }}</span>
          <strong>{{ card.value }}</strong>
          <small>{{ card.hint }}</small>
        </article>
      </div>

      <section class="owner-command-grid inner-action-bar" *ngIf="!loading() && visibleActivityView('overview')">
        <article class="panel owner-summary-panel">
          <div class="section-title activity-title">
            <div>
              <h3>Live appointment control</h3>
            </div>
            <span>{{ filteredRegisterRows().length }} appointment(s)</span>
          </div>
          <div class="owner-summary-grid">
            <article *ngFor="let card of ownerCards" [ngClass]="card.tone">
              <span>{{ card.label }}</span>
              <strong>{{ card.value }}</strong>
              <small>{{ card.hint }}</small>
            </article>
          </div>
        </article>

        <article class="panel whatsapp-report-panel">
          <div class="section-title activity-title">
            <div>
              <h3>Owner summary ready</h3>
            </div>
            <button class="ghost-button mini" type="button" (click)="copyWhatsappSummary()">Copy</button>
          </div>
          <textarea readonly [value]="whatsappSummary"></textarea>
          <small *ngIf="copyMessage()">{{ copyMessage() }}</small>
        </article>
      </section>

      <section class="panel smart-alert-panel" *ngIf="!loading() && smartAlerts.length && visibleActivityView('alerts')">
        <div class="section-title activity-title">
          <div>
            <h3>Live alerts to fix today</h3>
          </div>
          <span>{{ smartAlerts.length }} alert(s)</span>
        </div>
        <div class="alert-grid">
          <article *ngFor="let alert of smartAlerts" [ngClass]="alert.level">
            <span>{{ alert.title }}</span>
            <strong>{{ alert.clientName }}</strong>
            <p>{{ alert.detail }}</p>
            <small>{{ alert.action }}</small>
            <button class="ghost-button mini" type="button" (click)="openRegisterByAppointment(alert.appointmentId)">Open timeline</button>
          </article>
        </div>
      </section>

      <section class="insight-grid" *ngIf="!loading() && visibleActivityView('insights')">
        <article class="panel insight-panel">
          <div class="section-title activity-title">
            <div>
              <h3>Staff-wise live appointment view</h3>
            </div>
          </div>
          <div class="compact-table-wrap">
            <table class="compact-table">
              <thead>
                <tr>
                  <th>Staff</th>
                  <th>Appt</th>
                  <th>Done</th>
                  <th>Cancel</th>
                  <th>Not billed</th>
                  <th>Revenue</th>
                </tr>
              </thead>
              <tbody>
                <tr *ngFor="let row of staffPerformance">
                  <td><strong>{{ row.staffName }}</strong><small>{{ row.completionRate }}% completion · {{ row.averageDuration }} min avg</small></td>
                  <td>{{ row.appointments }}</td>
                  <td>{{ row.completed }}</td>
                  <td>{{ row.cancelled }}</td>
                  <td>{{ row.notBilled }}</td>
                  <td>{{ row.revenue | auraMoney:'1.0-0' }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </article>

        <article class="panel insight-panel">
          <div class="section-title activity-title">
            <div>
              <h3>Risky clients and follow-up</h3>
            </div>
          </div>
          <div class="client-score-list">
            <article *ngFor="let client of clientScores">
              <div>
                <strong>{{ client.clientName }}</strong>
                <small>{{ client.clientPhone || client.clientId }} · {{ client.appointments }} appointment(s)</small>
              </div>
              <span class="risk-pill" [ngClass]="client.score < 55 ? 'high' : client.score < 75 ? 'medium' : 'low'">{{ client.score }}% {{ client.label }}</span>
              <small>{{ client.suggestion }}</small>
            </article>
          </div>
        </article>
      </section>

      <section class="panel filter-panel" *ngIf="!loading() && visibleActivityView('filters')">
        <div class="section-title activity-title">
          <div>
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

      <section class="report-panel" *ngIf="!loading() && visibleActivityView('review')">
        <div class="section-title activity-title">
          <div>
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
          </article>
          <article>
            <span>Staff change risk</span>
            <strong>{{ staffRisk.length }}</strong>
          </article>
          <article>
            <span>Top reasons</span>
            <strong>{{ cancellationReasons.length }}</strong>
          </article>
        </div>
      </section>

      <section class="client-reliability-panel" *ngIf="visibleActivityView('client') && clientHistory() as history">
        <div class="section-title activity-title">
          <div>
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

      <section class="panel table-panel register-panel" *ngIf="!loading() && visibleActivityView('register')">
        <div class="section-title activity-title">
          <div>
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
                  <ng-container *ngIf="canAccessPath('/pos/invoices')">
                    <a [routerLink]="['/pos/invoices']" [queryParams]="{ search: row.invoiceNumber }" *ngIf="row.invoiceNumber; else noInvoice">{{ row.invoiceNumber }}</a>
                  </ng-container>
                  <ng-template #noInvoice><strong>No invoice</strong></ng-template>
                  <small>{{ label(row.paymentStatus) }} · {{ row.total | auraMoney:'1.0-0' }} / {{ row.paid | auraMoney:'1.0-0' }} / {{ row.balance | auraMoney:'1.0-0' }}</small>
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

      <section class="panel table-panel" *ngIf="!loading() && visibleActivityView('activity')">
        <div class="section-title activity-title">
          <div>
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

        </main>
      </div>

      <aside class="detail-drawer" *ngIf="selectedRegister() as register">
        <header>
          <div>
            <h3>{{ register.clientName }} - {{ label(register.status) }}</h3>
            <p>{{ register.serviceNames || register.appointmentId }} with {{ register.staffName }} at {{ formatDateTime(register.appointmentStartAt) }}</p>
          </div>
          <button class="ghost-button mini" type="button" (click)="selectedRegister.set(null)">Close</button>
        </header>

        <div class="detail-grid">
          <article><span>Booked</span><strong>{{ formatDateTime(register.bookedAt) }}</strong><small>{{ label(register.bookingMode) }} · {{ register.createdBy }}</small></article>
          <article><span>Appointment</span><strong>{{ formatDateTime(register.appointmentStartAt) }}</strong><small>{{ register.durationMinutes }} minutes</small></article>
          <article><span>Invoice</span><strong>{{ register.invoiceNumber || 'No invoice' }}</strong><small>{{ label(register.paymentStatus) }} · Due {{ register.balance | auraMoney:'1.0-0' }}</small></article>
          <article><span>Last update</span><strong>{{ register.lastUpdatedBy }}</strong><small>{{ formatDateTime(register.lastUpdatedAt) }}</small></article>
        </div>
        <div class="drawer-actions">
          <a class="ghost-button mini" routerLink="/appointments">Open calendar</a>
          <a class="ghost-button mini" [routerLink]="['/clients', register.clientId]" *ngIf="register.clientId">Open client</a>
          <ng-container *ngIf="canAccessPath('/pos/invoices')">
            <a class="ghost-button mini" routerLink="/pos/invoices" [queryParams]="{ search: register.invoiceNumber }" *ngIf="register.invoiceNumber">Open invoice</a>
          </ng-container>
          <a class="ghost-button mini" routerLink="/pos" [queryParams]="{ appointmentId: register.appointmentId }" *ngIf="!register.invoiceNumber && canAccessPath('/pos')">Open POS</a>
        </div>

        <section>
          <div class="section-title activity-title">
            <div>
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
      gap: 12px;
      color: var(--ink);
      background: var(--bg);
    }

    .module-hero,
    .panel,
    .report-panel,
    .client-reliability-panel,
    .detail-drawer {
      border: 1px solid var(--line);
      border-radius: var(--radius-md);
      background: var(--surface);
      box-shadow: 0 4px 12px rgba(12, 26, 43, 0.06);
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
      padding: 16px 18px;
      border-left: 0;
      border-right: 0;
      border-radius: 0;
      box-shadow: none;
    }

    .module-hero h2,
    .section-title h3,
    .detail-drawer h3 {
      margin: 0;
      color: var(--ink);
    }

    .module-hero h2 {
      font-size: 1.35rem;
      line-height: 1.18;
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

    .hero-actions .ghost-button,
    .hero-actions .primary-button,
    .action-row .ghost-button {
      min-height: 34px;
      border-radius: 6px;
      padding: 0 12px;
      box-shadow: none;
    }

    .activity-workspace {
      display: grid;
      grid-template-columns: 315px minmax(0, 1fr);
      gap: 12px;
      align-items: start;
      min-width: 0;
    }

    .activity-side-nav,
    .activity-detail {
      display: grid;
      gap: 10px;
      min-width: 0;
    }

    .activity-side-nav {
      position: sticky;
      top: 82px;
      align-self: start;
    }

    .activity-nav-card {
      display: grid;
      grid-template-columns: 48px minmax(0, 1fr) auto;
      align-items: center;
      gap: 10px;
      width: 100%;
      min-height: 88px;
      padding: 14px;
      border: 1px solid var(--line);
      border-left: 3px solid var(--teal);
      border-radius: 8px;
      color: var(--ink);
      background: var(--surface);
      box-shadow: 0 4px 12px rgba(12, 26, 43, 0.06);
      cursor: pointer;
      text-align: left;
      transition: transform 160ms ease, box-shadow 160ms ease, border-color 160ms ease, background 160ms ease;
    }

    .activity-nav-card:hover {
      transform: translateY(-2px);
      border-color: var(--teal);
      box-shadow: 0 8px 22px rgba(12, 26, 43, 0.1);
    }

    .activity-nav-card.active {
      border-color: var(--teal);
      background: linear-gradient(90deg, rgba(75,18,56,0.04), rgba(75,18,56,0.03), rgba(75,18,56,0.03));
      box-shadow: 0 8px 22px rgba(12, 26, 43, 0.12);
    }

    .activity-nav-card strong,
    .activity-nav-card small,
    .activity-nav-card i {
      display: block;
    }

    .activity-nav-card strong {
      font-size: 0.96rem;
      line-height: 1.2;
    }

    .activity-nav-card small {
      margin-top: 4px;
      color: var(--muted);
      font-size: 0.72rem;
      font-weight: 800;
      line-height: 1.25;
    }

    .activity-nav-card i {
      padding: 3px 8px;
      border-radius: 999px;
      color: var(--teal);
      background: var(--surface-2);
      font-size: 0.68rem;
      font-style: normal;
      font-weight: 900;
      text-transform: uppercase;
    }

    .activity-nav-icon {
      display: inline-grid;
      place-items: center;
      width: 48px;
      height: 48px;
      border-radius: 8px;
      color: var(--teal);
      background: rgba(214, 79, 146, 0.12);
      font-weight: 900;
    }

    .metric-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
      gap: 10px;
    }

    .metric-card,
    .owner-summary-grid article,
    .alert-grid article,
    .client-score-list article,
    .report-grid article,
    .client-stats-grid article,
    .detail-grid article,
    .change-list article {
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--surface);
      padding: 12px;
    }

    .metric-card {
      min-height: 94px;
      border-top: 3px solid var(--teal);
    }

    .metric-card.red { border-top-color: var(--danger); }
    .metric-card.amber { border-top-color: #b7791f; }
    .metric-card.blue { border-top-color: #4B1238; }
    .metric-card.green { border-top-color: #C87D4B; }

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
      margin: 6px 0 3px;
      color: var(--ink);
      font-size: 1.35rem;
    }

    .filter-panel,
    .table-panel,
    .report-panel,
    .owner-summary-panel,
    .whatsapp-report-panel,
    .smart-alert-panel,
    .insight-panel,
    .client-reliability-panel,
    .detail-drawer {
      padding: 14px;
    }

    .owner-command-grid,
    .insight-grid {
      display: grid;
      grid-template-columns: minmax(0, 1.45fr) minmax(320px, 0.8fr);
      gap: 12px;
      align-items: stretch;
      min-width: 0;
    }

    .insight-panel {
      display: flex;
      flex-direction: column;
      min-width: 0;
      min-height: 0;
    }

    .owner-summary-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
      gap: 10px;
    }

    .owner-summary-grid article {
      min-height: 82px;
      border-top: 3px solid var(--teal);
    }

    .owner-summary-grid article.red,
    .alert-grid article.high {
      border-top-color: var(--danger);
    }

    .owner-summary-grid article.amber,
    .alert-grid article.medium {
      border-top-color: #b7791f;
    }

    .whatsapp-report-panel {
      align-content: start;
      display: grid;
      gap: 10px;
    }

    .whatsapp-report-panel textarea {
      min-height: 168px;
      resize: vertical;
      line-height: 1.45;
    }

    .alert-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
      gap: 10px;
    }

    .alert-grid article {
      display: grid;
      gap: 6px;
      border-top: 3px solid var(--teal);
    }

    .alert-grid p {
      margin: 0;
      color: var(--ink);
    }

    .compact-table-wrap {
      overflow-x: auto;
      min-width: 0;
    }

    .compact-table {
      min-width: 720px;
    }

    .client-score-list {
      display: grid;
      gap: 10px;
      align-content: start;
      min-width: 0;
      min-height: 0;
      overflow: visible;
    }

    .client-score-list article {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 6px 10px;
      align-items: center;
      min-width: 0;
    }

    .client-score-list article > div {
      min-width: 0;
    }

    .client-score-list strong,
    .client-score-list small {
      overflow-wrap: anywhere;
    }

    .client-score-list article > small {
      grid-column: 1 / -1;
    }

    .drawer-actions {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
    }

    .activity-title {
      margin-bottom: 10px;
    }

    .filter-grid {
      display: grid;
      grid-template-columns: repeat(6, minmax(0, 1fr));
      gap: 10px;
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
      min-height: 34px;
      border: 1px solid var(--line);
      border-radius: 6px;
      background: var(--surface);
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
      border: 1px solid var(--success-border, #DCC4D4);
      border-radius: 999px;
      background: var(--success-bg, #F3EAF0);
      color: var(--success-text, #7A4A28);
      padding: 6px 10px;
      font-weight: 800;
      font-size: 0.82rem;
    }

    .table-wrap {
      overflow-x: auto;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--surface);
    }

    table {
      width: 100%;
      border-collapse: collapse;
      min-width: 1080px;
    }

    th,
    td {
      border-bottom: 1px solid var(--line);
      padding: 9px 10px;
      text-align: left;
      vertical-align: top;
    }

    th {
      color: var(--muted);
      font-size: 0.75rem;
      text-transform: uppercase;
      background: var(--surface-2);
      position: sticky;
      top: 0;
      z-index: 1;
    }

    td strong,
    td small {
      display: block;
    }

    tr.selected {
      background: var(--surface-2);
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
      background: var(--danger-bg, #FEF2F2);
      color: var(--danger-text, #991B1B);
    }

    .badge.booking,
    .risk-pill.low {
      background: var(--success-bg, #F3EAF0);
      color: var(--success-text, #7A4A28);
    }

    .badge.change,
    .risk-pill.medium {
      background: #fff7dc;
      color: #9a5b00;
    }

    .badge.cancellation,
    .risk-pill.high,
    .risk-pill.critical {
      background: var(--danger-bg, #FEF2F2);
      color: var(--danger-text, #991B1B);
    }

    .badge.service,
    .badge.billing {
      background: #F5EEF2;
      color: #6B1E4B;
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

    @media (max-width: 1180px) {
      .activity-workspace {
        grid-template-columns: 1fr;
      }

      .activity-side-nav {
        position: static;
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }
    }

    @media (max-width: 980px) {
      .module-hero,
      .section-title,
      .detail-drawer header {
        align-items: flex-start;
        flex-direction: column;
      }

      .metric-grid,
      .filter-grid,
      .owner-command-grid,
      .insight-grid,
      .activity-side-nav {
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
  activeActivityView = signal<ActivityViewKey>('overview');

  readonly activityViews: Array<{ key: ActivityViewKey; label: string; description: string; icon: string; badge: string }> = [
    { key: 'overview', label: 'Overview', description: 'KPIs and owner command summary', icon: 'OV', badge: 'Open' },
    { key: 'alerts', label: 'Live alerts', description: 'No-show, due and follow-up fixes', icon: 'AL', badge: 'Today' },
    { key: 'insights', label: 'Staff & clients', description: 'Staff performance and risky clients', icon: 'SC', badge: 'Ops' },
    { key: 'filters', label: 'Audit filters', description: 'Search and server filter controls', icon: 'FT', badge: 'Find' },
    { key: 'review', label: 'Review summary', description: 'Cancellation, reschedule and no-show report', icon: 'RV', badge: 'Report' },
    { key: 'client', label: 'Client reliability', description: 'Selected client score and suggestions', icon: 'CL', badge: 'CRM' },
    { key: 'register', label: 'Full register', description: 'Booked-to-billed appointment history', icon: 'RG', badge: 'Audit' },
    { key: 'activity', label: 'Status activity', description: 'Edit, status and risk timeline rows', icon: 'AC', badge: 'Log' }
  ];
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
  copyMessage = signal('');

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
  ownerCards: Array<{ label: string; value: string | number; hint: string; tone: string }> = [];
  smartAlerts: SmartAlert[] = [];
  staffPerformance: StaffPerformanceRow[] = [];
  clientScores: ClientScoreRow[] = [];
  whatsappSummary = '';
  dailySummary: ApiRecord[] = [];
  staffRisk: ApiRecord[] = [];
  clientReliability: ApiRecord[] = [];
  cancellationReasons: ApiRecord[] = [];
  exportRows: ApiRecord[] = [];

  constructor(
    private readonly api: ApiService,
    private readonly state: AppStateService,
    private readonly session: AuthSessionService
  ) {}

  canAccessPath(path: string): boolean {
    const permission = routePermissionForPath(path);
    if (!permission || (Array.isArray(permission) && !permission.length)) return true;
    const permissions = Array.isArray(permission) ? permission : [permission];
    const dynamicGrants = this.session.currentUser()?.permissions || [];
    const grants = Array.from(new Set([...staticGrantsForRole(this.state.userRole()), ...dynamicGrants]));
    return permissions.some((item) => grantsAllow(grants, item));
  }

  setActivityView(view: ActivityViewKey): void {
    this.activeActivityView.set(view);
  }

  visibleActivityView(view: ActivityViewKey): boolean {
    const active = this.activeActivityView();
    return active === 'overview' || active === view;
  }

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
    this.rebuildAdvancedInsights(registerRows);
  }

  private rebuildAdvancedInsights(registerRows: AppointmentRegisterRow[]): void {
    const completedRows = registerRows.filter((row) => this.isCompletedStatus(row.status));
    const cancelledRows = registerRows.filter((row) => this.isCancelledStatus(row.status));
    const notBilledRows = registerRows.filter((row) => this.isCompletedStatus(row.status) && !row.invoiceNumber);
    const paymentPendingRows = registerRows.filter((row) => row.balance > 0 || ['partial', 'unpaid'].includes(row.paymentStatus));
    const expectedRevenue = registerRows.reduce((sum, row) => sum + row.total, 0);
    const billedRevenue = registerRows.filter((row) => row.invoiceNumber).reduce((sum, row) => sum + row.total, 0);
    const staffCount = new Set(registerRows.map((row) => row.staffId || row.staffName).filter(Boolean)).size;
    this.ownerCards = [
      { label: 'Today booked', value: registerRows.length, hint: 'Filtered live appointments', tone: 'blue' },
      { label: 'Completed', value: completedRows.length, hint: 'Ready or already billed', tone: 'green' },
      { label: 'Cancel / no-show', value: cancelledRows.length, hint: 'Needs reason and recovery', tone: cancelledRows.length ? 'red' : 'green' },
      { label: 'Not billed', value: notBilledRows.length, hint: 'Completed but POS missing', tone: notBilledRows.length ? 'red' : 'green' },
      { label: 'Payment pending', value: this.formatMoney(paymentPendingRows.reduce((sum, row) => sum + row.balance, 0)), hint: `${paymentPendingRows.length} invoice(s)`, tone: paymentPendingRows.length ? 'amber' : 'green' },
      { label: 'Staff coverage', value: staffCount, hint: 'Staff with appointments', tone: 'blue' },
      { label: 'Expected revenue', value: this.formatMoney(expectedRevenue), hint: 'From live invoice/register rows', tone: 'blue' },
      { label: 'Billed revenue', value: this.formatMoney(billedRevenue), hint: 'Invoice linked value', tone: 'green' }
    ];

    this.staffPerformance = this.buildStaffPerformance(registerRows);
    this.clientScores = this.buildClientScores(registerRows);
    this.smartAlerts = this.buildSmartAlerts(registerRows);
    this.whatsappSummary = this.buildWhatsappSummary(registerRows, notBilledRows, paymentPendingRows);
  }

  private buildStaffPerformance(rows: AppointmentRegisterRow[]): StaffPerformanceRow[] {
    const byStaff = new Map<string, StaffPerformanceRow>();
    for (const row of rows) {
      const key = row.staffId || row.staffName || 'unassigned';
      const current = byStaff.get(key) || {
        staffId: row.staffId || key,
        staffName: row.staffName || 'Unassigned',
        appointments: 0,
        completed: 0,
        cancelled: 0,
        noShows: 0,
        notBilled: 0,
        revenue: 0,
        due: 0,
        averageDuration: 0,
        completionRate: 0
      };
      current.appointments += 1;
      if (this.isCompletedStatus(row.status)) current.completed += 1;
      if (this.isCancelledStatus(row.status)) current.cancelled += 1;
      if (String(row.status || '').toLowerCase() === 'no-show') current.noShows += 1;
      if (this.isCompletedStatus(row.status) && !row.invoiceNumber) current.notBilled += 1;
      current.revenue += row.total;
      current.due += row.balance;
      current.averageDuration += row.durationMinutes || 0;
      byStaff.set(key, current);
    }
    return [...byStaff.values()].map((row) => ({
      ...row,
      averageDuration: row.appointments ? Math.round(row.averageDuration / row.appointments) : 0,
      completionRate: row.appointments ? Math.round((row.completed / row.appointments) * 100) : 0
    })).sort((a, b) => b.appointments - a.appointments || b.revenue - a.revenue);
  }

  private buildClientScores(rows: AppointmentRegisterRow[]): ClientScoreRow[] {
    const byClient = new Map<string, ClientScoreRow>();
    for (const row of rows) {
      const key = row.clientId || row.clientPhone || row.clientName || 'unknown';
      const current = byClient.get(key) || {
        clientId: row.clientId || key,
        clientName: row.clientName || 'Unknown client',
        clientPhone: row.clientPhone || '',
        appointments: 0,
        completed: 0,
        cancelled: 0,
        noShows: 0,
        due: 0,
        score: 100,
        label: 'Good',
        suggestion: 'Normal confirmation is enough.'
      };
      current.appointments += 1;
      if (this.isCompletedStatus(row.status)) current.completed += 1;
      if (this.isCancelledStatus(row.status)) current.cancelled += 1;
      if (String(row.status || '').toLowerCase() === 'no-show') current.noShows += 1;
      current.due += row.balance;
      byClient.set(key, current);
    }
    return [...byClient.values()].map((client) => {
      const score = Math.max(0, Math.min(100, 100 - client.cancelled * 18 - client.noShows * 28 - (client.due > 0 ? 12 : 0)));
      const label = score < 55 ? 'Risky' : score < 75 ? 'Watch' : 'Good';
      const suggestion = score < 55
        ? 'Deposit/confirmation required before next slot.'
        : score < 75
          ? 'Call or WhatsApp confirmation recommended.'
          : 'Normal confirmation is enough.';
      return { ...client, score, label, suggestion };
    }).sort((a, b) => a.score - b.score || b.due - a.due).slice(0, 12);
  }

  private buildSmartAlerts(rows: AppointmentRegisterRow[]): SmartAlert[] {
    const alerts: SmartAlert[] = [];
    const clientNoShows = new Map<string, number>();
    for (const row of rows) {
      if (String(row.status || '').toLowerCase() === 'no-show') {
        const key = row.clientId || row.clientName;
        clientNoShows.set(key, (clientNoShows.get(key) || 0) + 1);
      }
    }
    for (const row of rows) {
      if (this.isCompletedStatus(row.status) && !row.invoiceNumber) {
        alerts.push(this.alertFor(row, 'high', 'Completed but not billed', 'POS invoice is missing for this completed appointment.', 'Open POS and generate invoice.'));
      }
      if (row.balance > 0 || ['partial', 'unpaid'].includes(row.paymentStatus)) {
        alerts.push(this.alertFor(row, 'medium', 'Payment pending', `${this.formatMoney(row.balance)} balance is pending.`, 'Collect balance or send payment reminder.'));
      }
      if (this.isCancelledStatus(row.status) && !row.cancelReason) {
        alerts.push(this.alertFor(row, 'high', 'Cancel reason blank', 'Cancelled/no-show appointment has no reason captured.', 'Update reason for audit protection.'));
      }
      if (row.timelineCount <= 0) {
        alerts.push(this.alertFor(row, 'medium', 'Timeline missing', 'No lifecycle activity captured for this appointment.', 'Review booking source and activity logging.'));
      }
      if (row.durationMinutes <= 0 || row.durationMinutes > 360) {
        alerts.push(this.alertFor(row, 'medium', 'Duration mismatch', `${row.durationMinutes || 0} minute duration looks unusual.`, 'Check AM/PM, service duration and staff slot.'));
      }
      if ((clientNoShows.get(row.clientId || row.clientName) || 0) >= 2) {
        alerts.push(this.alertFor(row, 'high', 'Repeat no-show client', 'Same client has repeated no-show activity in this view.', 'Require confirmation or advance before next booking.'));
      }
      if (row.messageStatus.count <= 0 && !this.isCompletedStatus(row.status) && !this.isCancelledStatus(row.status)) {
        alerts.push(this.alertFor(row, 'low', 'Message not sent', 'No SMS/WhatsApp log found for this open appointment.', 'Send reminder or confirmation message.'));
      }
    }
    return alerts.slice(0, 18);
  }

  private alertFor(row: AppointmentRegisterRow, level: SmartAlert['level'], title: string, detail: string, action: string): SmartAlert {
    return {
      level,
      title,
      detail,
      action,
      appointmentId: row.appointmentId,
      clientName: row.clientName || 'Unknown client'
    };
  }

  private buildWhatsappSummary(rows: AppointmentRegisterRow[], notBilledRows: AppointmentRegisterRow[], paymentPendingRows: AppointmentRegisterRow[]): string {
    const completed = rows.filter((row) => this.isCompletedStatus(row.status)).length;
    const cancelled = rows.filter((row) => this.isCancelledStatus(row.status)).length;
    const due = paymentPendingRows.reduce((sum, row) => sum + row.balance, 0);
    const revenue = rows.filter((row) => row.invoiceNumber).reduce((sum, row) => sum + row.total, 0);
    const topStaff = this.staffPerformance.slice(0, 3).map((row) => `${row.staffName}: ${row.appointments}`).join(', ') || 'No staff data';
    return [
      `Appointment Register ${this.todayKey()}`,
      `Booked: ${rows.length} | Completed: ${completed} | Cancel/no-show: ${cancelled}`,
      `Not billed: ${notBilledRows.length} | Payment pending: ${this.formatMoney(due)}`,
      `Billed revenue: ${this.formatMoney(revenue)}`,
      `Staff count: ${this.staffPerformance.length} | ${topStaff}`,
      `Problem alerts: ${this.smartAlerts.length}`
    ].join('\n');
  }

  openRegisterByAppointment(appointmentId: string): void {
    const row = this.filteredRegisterRows().find((item) => item.appointmentId === appointmentId);
    if (row) this.openRegisterDetail(row);
  }

  copyWhatsappSummary(): void {
    this.copyMessage.set('');
    const write = navigator.clipboard?.writeText(this.whatsappSummary);
    if (!write) {
      this.copyMessage.set('Copy blocked by browser. Select text and copy manually.');
      return;
    }
    write.then(
      () => this.copyMessage.set('WhatsApp summary copied.'),
      () => this.copyMessage.set('Copy blocked by browser. Select text and copy manually.')
    );
  }

  private isCompletedStatus(status: string): boolean {
    return ['completed', 'billed', 'paid'].includes(String(status || '').toLowerCase());
  }

  private isCancelledStatus(status: string): boolean {
    return ['cancelled', 'canceled', 'no-show', 'deleted'].includes(String(status || '').toLowerCase());
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
