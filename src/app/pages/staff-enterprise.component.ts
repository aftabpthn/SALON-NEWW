import { CommonModule } from '@angular/common';
import { Component, OnInit, computed, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterModule } from '@angular/router';
import { forkJoin, finalize } from 'rxjs';
import { ApiRecord, ApiService } from '../core/api.service';
import { AuraMoneyPipe } from '../shared/pipes/aura-money.pipe';

type RiskLevel = 'low' | 'medium' | 'high' | 'critical' | string;

interface StaffEnterprisePeriod {
  periodStart?: string;
  periodEnd?: string;
}

interface StaffEnterpriseKpis {
  staffCount?: number;
  scheduledShifts?: number;
  presentDays?: number;
  totalRevenue?: number;
  totalCommission?: number;
  highRiskSignals?: number;
  pendingApprovals?: number;
  trainingDue?: number;
}

interface StaffEnterpriseCommandCenter {
  period?: StaffEnterprisePeriod;
  branchId?: string;
  generatedAt?: string;
  empty?: boolean;
  sourceCounts?: Record<string, number>;
  kpis?: StaffEnterpriseKpis;
  topStaff?: StaffRank[];
  attentionQueue?: EnterpriseItem[];
  recommendations?: EnterpriseItem[];
}

interface StaffRank {
  staffId?: string;
  name?: string;
  staffName?: string;
  role?: string;
  performanceScore?: number;
  attendanceScore?: number;
  serviceEfficiency?: number;
  revenue?: number;
  bookings?: number;
}

interface DigitalTwin {
  staffId: string;
  staffName?: string;
  branchId?: string;
  status?: string;
  profile?: {
    role?: string;
    skillsKnown?: number;
    activeServices?: string[];
  };
  performance?: {
    score?: number;
    attendanceScore?: number;
    serviceEfficiency?: number;
    revenue?: number;
    appointmentCount?: number;
    presentDays?: number;
    scheduledShifts?: number;
  };
  finance?: {
    revenue?: number;
    commission?: number;
    averageTicket?: number;
  };
  risk?: {
    highestRisk?: RiskLevel;
    signals?: EnterpriseItem[];
  };
  suggestions?: string[];
}

interface DigitalTwinResponse {
  period?: StaffEnterprisePeriod;
  branchId?: string;
  empty?: boolean;
  items?: DigitalTwin[];
}

interface SkillMatrixRow {
  staffId?: string;
  staffName?: string;
  branchId?: string;
  assignedServices?: Array<{ serviceId?: string; serviceName?: string }>;
  licenses?: EnterpriseItem[];
  skills?: EnterpriseItem[];
}

interface ListResponse<T> {
  period?: StaffEnterprisePeriod;
  branchId?: string;
  date?: string;
  schemaReady?: boolean;
  empty?: boolean;
  items?: T[];
  stored?: T[];
}

interface EnterpriseItem {
  id?: string;
  source?: string;
  type?: string;
  title?: string;
  reason?: string;
  suggestedAction?: string;
  signalType?: string;
  riskLevel?: RiskLevel;
  riskScore?: number;
  staffId?: string;
  staffName?: string;
  branchId?: string;
  status?: string;
  trainingTitle?: string;
  trainingType?: string;
  complianceRiskLevel?: RiskLevel;
  eventType?: string;
  severity?: string;
  actionType?: string;
  entityType?: string;
  actorRole?: string;
  actorId?: string;
  createdAt?: string;
  eventAt?: string;
  detectedAt?: string;
  periodStart?: string;
  periodEnd?: string;
  grossPay?: number;
  commissionAmount?: number;
  incentiveAmount?: number;
  overtimePay?: number;
  [key: string]: unknown;
}

interface BranchOption {
  id: string;
  name?: string;
}

interface StaffOption {
  id: string;
  name?: string;
  fullName?: string;
  branchId?: string;
}

interface DetailSelection {
  eyebrow: string;
  title: string;
  subtitle?: string;
  status?: string;
  riskLevel?: RiskLevel;
  payload: unknown;
}

interface StaffCommandLink {
  label: string;
  path: string;
  metric: string | number;
  description: string;
  tone: string;
}

interface ProfitInsight {
  staffId: string;
  staffName: string;
  branchId: string;
  revenue: number;
  grossPay: number;
  estimatedMinutes: number;
  profitPerMinute: number;
  riskLevel: RiskLevel;
}

type StaffEnterpriseFilterKey = 'periodStart' | 'periodEnd' | 'branchId' | 'staffId';

@Component({
  selector: 'app-staff-enterprise',
  standalone: true,
  imports: [AuraMoneyPipe, CommonModule, FormsModule, RouterModule],
  template: `
    <section class="enterprise-shell">
      <header class="enterprise-header">
        <div>
          <h1>Workforce Center</h1>
        </div>
        <nav class="header-actions" aria-label="Staff enterprise navigation">
          <a routerLink="/staff-os/staff-list" class="ghost-button">Staff</a>
          <a routerLink="/staff-os/staff-list" class="ghost-button">Staff OS</a>
          <button type="button" class="primary-button" (click)="loadDashboard()" [disabled]="loading()">Refresh</button>
        </nav>
      </header>

      <section class="filter-band" aria-label="Staff enterprise filters">
        <label>
          <span>From date</span>
          <input type="date" [ngModel]="filters.periodStart" (ngModelChange)="setFilter('periodStart', $event)" />
        </label>
        <label>
          <span>To date</span>
          <input type="date" [ngModel]="filters.periodEnd" (ngModelChange)="setFilter('periodEnd', $event)" />
        </label>
        <label>
          <span>Branch</span>
          <select [ngModel]="filters.branchId" (ngModelChange)="setFilter('branchId', $event)">
            <option value="">All branches</option>
            <option *ngFor="let branch of branches()" [value]="branch.id">{{ branch.name || branch.id }}</option>
          </select>
        </label>
        <label>
          <span>Staff</span>
          <select [ngModel]="filters.staffId" (ngModelChange)="setFilter('staffId', $event)">
            <option value="">All staff</option>
            <option *ngFor="let person of staffOptions()" [value]="person.id">{{ person.name || person.fullName || person.id }}</option>
          </select>
        </label>
        <div class="filter-actions">
          <button type="button" class="ghost-button" (click)="resetFilters()">Reset</button>
          <button type="button" class="primary-button" (click)="loadDashboard()">Apply</button>
        </div>
      </section>

      <section class="state-panel loading" *ngIf="loading()">
        <span class="spinner"></span>
        <strong>Loading staff metrics</strong>
      </section>

      <section class="state-panel error" *ngIf="error()">
        <strong>{{ error() }}</strong>
        <button type="button" class="ghost-button" (click)="loadDashboard()">Retry</button>
      </section>

      <section class="state-panel empty" *ngIf="!loading() && !error() && isEmpty()">
        <strong>No staff enterprise signals found</strong>
        <span>Adjust filters or add staff activity, attendance, invoices and commission data.</span>
      </section>

      <ng-container *ngIf="!loading() && !error()">
        <section class="kpi-grid" aria-label="Staff enterprise KPI cards">
          <article class="kpi-card teal">
            <span>Total staff</span>
            <strong>{{ kpis().staffCount || 0 }}</strong>
            <small>{{ command()?.sourceCounts?.['appointments'] || 0 }} appointments scanned</small>
          </article>
          <article class="kpi-card green">
            <span>Revenue</span>
            <strong>{{ kpis().totalRevenue || 0 | auraMoney:'1.0-0' }}</strong>
            <small>{{ kpis().totalCommission || 0 | auraMoney:'1.0-0' }} commission</small>
          </article>
          <article class="kpi-card amber">
            <span>Present days</span>
            <strong>{{ kpis().presentDays || 0 }}</strong>
            <small>{{ kpis().scheduledShifts || 0 }} scheduled shifts</small>
          </article>
          <article class="kpi-card red">
            <span>High risk</span>
            <strong>{{ kpis().highRiskSignals || 0 }}</strong>
            <small>{{ riskSignalsFiltered().length }} total signals</small>
          </article>
          <article class="kpi-card blue">
            <span>Approvals</span>
            <strong>{{ kpis().pendingApprovals || 0 }}</strong>
            <small>{{ approvalsFiltered().length }} queue items</small>
          </article>
          <article class="kpi-card violet">
            <span>Training due</span>
            <strong>{{ kpis().trainingDue || 0 }}</strong>
            <small>{{ trainingFiltered().length }} suggestions</small>
          </article>
        </section>

        <section class="section-band">
          <div class="section-heading">
            <div>
              <h2>Open connected pages with same branch/staff context</h2>
            </div>
            <small class="snapshot-label">{{ command()?.generatedAt || filters.periodEnd }} live snapshot</small>
          </div>
          <div class="module-link-grid">
            <a *ngFor="let link of staffCommandLinks()" [routerLink]="link.path" [queryParams]="queryParams()" class="module-link-card" [ngClass]="link.tone">
              <span>{{ link.label }}</span>
              <strong>{{ link.metric }}</strong>
              <small>{{ link.description }}</small>
            </a>
          </div>
        </section>

        <section class="section-band command-grid">
          <div class="section-heading">
            <h2>Owner attention queue</h2>
          </div>
          <div class="command-list">
            <button type="button" class="command-row" *ngFor="let item of commandQueue()" (click)="openDetail('Command signal', item.title || item.reason || item.type || 'Staff signal', item.suggestedAction || item.reason || item.status || 'Live computed item', item)">
              <span class="badge" [ngClass]="riskClass(item.riskLevel || item['priority'])">{{ item.riskLevel || item['priority'] || item.type || 'info' }}</span>
              <strong>{{ item.title || item.reason || item.signalType || item.requestType || 'Staff signal' }}</strong>
              <small>{{ item.suggestedAction || item.status || item.staffName || item.staffId || 'Ready for review' }}</small>
            </button>
          </div>
        </section>

        <section class="section-band">
          <div class="section-heading">
            <h2>Roster profitability view</h2>
          </div>
          <div class="profit-grid">
            <button type="button" class="profit-row" *ngFor="let row of profitInsights()" (click)="openDetail('Profit scheduler', row.staffName, 'Revenue, payout and estimated utilization', row)">
              <div>
                <strong>{{ row.staffName }}</strong>
                <span>{{ row.estimatedMinutes }} estimated minutes</span>
              </div>
              <div>
                <strong>{{ row.profitPerMinute | auraMoney:'1.1-1' }}</strong>
              </div>
              <span class="badge" [ngClass]="riskClass(row.riskLevel)">{{ row.riskLevel }}</span>
            </button>
          </div>
        </section>

        <section class="section-band">
          <div class="section-heading">
            <h2>Performance, finance and skill profile</h2>
          </div>
          <div class="twin-grid">
            <button type="button" class="twin-card" *ngFor="let twin of twinsFiltered()" (click)="openDetail('Digital twin', twin.staffName || twin.staffId, twin.profile?.role || twin.status || 'Staff profile', twin)">
              <div class="twin-top">
                <div>
                  <strong>{{ twin.staffName || twin.staffId }}</strong>
                  <span>{{ twin.profile?.role || 'Staff' }}</span>
                </div>
                <span class="badge" [ngClass]="riskClass(twin.risk?.highestRisk)">{{ twin.risk?.highestRisk || 'low' }}</span>
              </div>
              <div class="mini-metrics">
                <span><b>{{ twin.performance?.score || 0 | number: '1.0-1' }}</b> Score</span>
                <span><b>{{ twin.performance?.revenue || 0 | auraMoney:'1.0-0' }}</b> Revenue</span>
                <span><b>{{ twin.profile?.skillsKnown || 0 }}</b> Skills</span>
              </div>
              <small>{{ firstText(twin.suggestions) }}</small>
            </button>
          </div>
        </section>

        <section class="section-band two-column">
          <div>
            <div class="section-heading">
              <h2>Certification status</h2>
            </div>
            <div class="table-wrap">
              <table>
                <thead>
                  <tr><th>Staff</th><th>Services</th><th>Licenses</th><th>Skills</th></tr>
                </thead>
                <tbody>
                  <tr *ngFor="let row of skillMatrixFiltered()" (click)="openDetail('Skill matrix', row.staffName || row.staffId || 'Staff', 'License and skill evidence', row)">
                    <td><strong>{{ row.staffName || row.staffId }}</strong></td>
                    <td>{{ row.assignedServices?.length || 0 }}</td>
                    <td>{{ row.licenses?.length || 0 }}</td>
                    <td>{{ row.skills?.length || 0 }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <div>
            <div class="section-heading">
              <h2>Cash, discount and commission signals</h2>
            </div>
            <div class="signal-list">
              <button type="button" class="signal-row" *ngFor="let signal of revenueLeakageSignals()" (click)="openDetail('Revenue leakage', signal.staffName || signal.staffId || signal.signalType || 'Signal', signal.reason || signal.suggestedAction || 'Computed risk', signal)">
                <span class="badge" [ngClass]="riskClass(signal.riskLevel)">{{ signal.riskLevel || 'medium' }}</span>
                <strong>{{ signal.staffName || signal.staffId || signal.signalType }}</strong>
                <small>{{ signal.reason || signal.suggestedAction }}</small>
              </button>
            </div>
          </div>
        </section>

        <section class="section-band two-column">
          <div>
            <div class="section-heading">
              <h2>Workforce risk review</h2>
            </div>
            <div class="signal-list">
              <button type="button" class="signal-row" *ngFor="let signal of burnoutSignals()" (click)="openDetail('Burnout and attrition', signal.staffName || signal.staffId || signal.signalType || 'Signal', signal.reason || 'Staff risk', signal)">
                <span class="badge" [ngClass]="riskClass(signal.riskLevel)">{{ signal.riskLevel || 'medium' }}</span>
                <strong>{{ signal.staffName || signal.staffId || signal.signalType }}</strong>
                <small>{{ signal.reason || signal.suggestedAction }}</small>
              </button>
            </div>
          </div>

          <div>
            <div class="section-heading">
              <h2>Recommended coaching</h2>
            </div>
            <div class="signal-list">
              <button type="button" class="signal-row" *ngFor="let item of trainingFiltered()" (click)="openDetail('Training academy', item.trainingTitle || item.title || item.staffId || 'Training', item.reason || item.status || item.trainingType || 'Suggested action', item)">
                <span class="badge" [ngClass]="statusClass(item.status)">{{ item.status || 'recommended' }}</span>
                <strong>{{ item.trainingTitle || item.title || item.trainingType || 'Training item' }}</strong>
                <small>{{ item.staffName || item.staffId || item.reason || 'Staff-linked recommendation' }}</small>
              </button>
            </div>
          </div>
        </section>

        <section class="section-band two-column">
          <div>
            <div class="section-heading">
              <h2>Payout and compliance signals</h2>
            </div>
            <div class="table-wrap">
              <table>
                <thead>
                  <tr><th>Staff</th><th>Gross</th><th>Commission</th><th>Risk</th></tr>
                </thead>
                <tbody>
                  <tr *ngFor="let row of payrollFiltered()" (click)="openDetail('Payroll review', row.staffName || row.staffId || 'Payroll row', row.periodStart + ' to ' + row.periodEnd, row)">
                    <td><strong>{{ row.staffName || row.staffId }}</strong></td>
                    <td>{{ row.grossPay || 0 | auraMoney:'1.0-0' }}</td>
                    <td>{{ row.commissionAmount || 0 | auraMoney:'1.0-0' }}</td>
                    <td><span class="badge" [ngClass]="riskClass(row.complianceRiskLevel)">{{ row.complianceRiskLevel || 'low' }}</span></td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <div>
            <div class="section-heading">
              <h2>Today status</h2>
            </div>
            <div class="signal-list">
              <button type="button" class="signal-row" *ngFor="let item of floorFiltered()" (click)="openDetail('Floor control', item.eventType || item.staffId || 'Floor event', item.status || item.severity || 'Live event', item)">
                <span class="badge" [ngClass]="statusClass(item.status || item.severity)">{{ item.status || item.severity || 'open' }}</span>
                <strong>{{ item.eventType || 'floor event' }}</strong>
                <small>{{ item.staffId || item.branchId || item.eventAt }}</small>
              </button>
            </div>
          </div>
        </section>

        <section class="section-band">
          <div class="section-heading">
            <h2>Immutable activity view</h2>
          </div>
          <div class="audit-timeline">
            <button type="button" class="audit-row" *ngFor="let item of auditFiltered()" (click)="openDetail('Zero-trust audit', text(item.actionType || item['action'] || item.entityType, 'Audit event'), text(item.actorRole || item.status || item.createdAt, 'Recorded event'), item)">
              <span>{{ item.createdAt || item['created_at'] || item.eventAt || '-' }}</span>
              <strong>{{ item.actionType || item['action'] || item.entityType || 'Audit event' }}</strong>
              <small>{{ item.actorRole || item.actorId || item.staffId || item.status || item.source }}</small>
            </button>
          </div>
        </section>
      </ng-container>

      <aside class="detail-drawer" *ngIf="selected() as detail" aria-label="Staff enterprise detail panel">
        <div class="drawer-header">
          <div>
            <span class="eyebrow">{{ detail.eyebrow }}</span>
            <h2>{{ detail.title }}</h2>
            <p>{{ detail.subtitle }}</p>
          </div>
          <button type="button" class="icon-button" (click)="selected.set(null)" aria-label="Close detail">×</button>
        </div>
        <div class="drawer-badges">
          <span class="badge" *ngIf="detail.status" [ngClass]="statusClass(detail.status)">{{ detail.status }}</span>
          <span class="badge" *ngIf="detail.riskLevel" [ngClass]="riskClass(detail.riskLevel)">{{ detail.riskLevel }}</span>
        </div>
        <div class="detail-summary-grid">
          <article>
            <span>Staff</span>
            <strong>{{ detailValue(detail.payload, 'staffName', detailValue(detail.payload, 'staffId', 'All staff')) }}</strong>
          </article>
          <article>
            <span>Branch</span>
            <strong>{{ detailValue(detail.payload, 'branchId', filters.branchId || 'All branches') }}</strong>
          </article>
          <article>
            <span>Source</span>
            <strong>{{ detailValue(detail.payload, 'source', detail.eyebrow) }}</strong>
          </article>
          <article>
            <span>Time</span>
            <strong>{{ detailValue(detail.payload, 'detectedAt', detailValue(detail.payload, 'createdAt', detailValue(detail.payload, 'eventAt', '-'))) }}</strong>
          </article>
        </div>
        <section class="drawer-action-card">
          <span>Reason</span>
          <strong>{{ detailValue(detail.payload, 'reason', detail.subtitle) }}</strong>
          <small *ngFor="let reason of detailReasons(detail.payload)">{{ reason }}</small>
        </section>
        <section class="drawer-action-card">
          <span>Suggested action</span>
          <strong>{{ detailValue(detail.payload, 'suggestedAction', 'Review this staff signal and take manager action.') }}</strong>
        </section>
        <div class="evidence-grid" *ngIf="detailEvidence(detail.payload).length">
          <article *ngFor="let item of detailEvidence(detail.payload)">
            <span>{{ item.label }}</span>
            <strong>{{ item.value }}</strong>
          </article>
        </div>
        <details class="technical-details">
          <summary>Technical payload</summary>
          <pre>{{ detail.payload | json }}</pre>
        </details>
      </aside>
    </section>
  `,
  styles: [`
    :host {
      display: block;
    }

    .enterprise-shell {
      display: flex;
      flex-direction: column;
      gap: 16px;
      color: #0f172a;
    }

    .enterprise-header,
    .filter-band,
    .section-band,
    .state-panel {
      border: 1px solid #d9e2ea;
      background: #ffffff;
      border-radius: 8px;
      box-shadow: 0 18px 40px rgba(15, 23, 42, 0.07);
    }

    .enterprise-header {
      display: flex;
      justify-content: space-between;
      gap: 16px;
      align-items: flex-start;
      padding: 20px;
    }

    .enterprise-header h1,
    .enterprise-header p,
    .section-heading h2 {
      margin: 0;
    }

    .enterprise-header h1 {
      font-size: 30px;
      line-height: 1.12;
      letter-spacing: 0;
      margin-top: 4px;
    }

    .enterprise-header p {
      margin-top: 8px;
      color: #5b677a;
      font-size: 15px;
    }

    .eyebrow {
      color: #52617a;
      font-size: 12px;
      font-weight: 800;
      letter-spacing: 0;
      text-transform: uppercase;
    }

    .header-actions,
    .filter-actions {
      display: flex;
      gap: 10px;
      align-items: center;
      flex-wrap: wrap;
    }

    .primary-button,
    .ghost-button,
    .icon-button {
      min-height: 40px;
      border-radius: 8px;
      border: 1px solid #cfd9e6;
      padding: 0 14px;
      background: #ffffff;
      color: #14213d;
      font-weight: 700;
      cursor: pointer;
      text-decoration: none;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      white-space: nowrap;
    }

    .primary-button {
      background: #4B1238;
      border-color: #4B1238;
      color: #ffffff;
    }

    .primary-button:disabled {
      opacity: 0.6;
      cursor: wait;
    }

    .filter-band {
      display: grid;
      grid-template-columns: repeat(4, minmax(150px, 1fr)) auto;
      gap: 12px;
      align-items: end;
      padding: 16px;
    }

    label {
      display: grid;
      gap: 6px;
      font-weight: 800;
      color: #334155;
      font-size: 13px;
    }

    input,
    select {
      height: 42px;
      width: 100%;
      border: 1px solid #cfd9e6;
      border-radius: 8px;
      padding: 0 12px;
      font: inherit;
      background: #ffffff;
      color: #0f172a;
    }

    .state-panel {
      padding: 18px;
      display: flex;
      align-items: center;
      gap: 12px;
    }

    .state-panel.error {
      border-color: #fecaca;
      background: #fff5f5;
      color: #991b1b;
    }

    .state-panel.empty {
      flex-direction: column;
      align-items: flex-start;
      color: #475569;
    }

    .spinner {
      width: 18px;
      height: 18px;
      border-radius: 999px;
      border: 3px solid #cbd5e1;
      border-top-color: #4B1238;
      animation: spin 0.8s linear infinite;
    }

    @keyframes spin {
      to { transform: rotate(360deg); }
    }

    .kpi-grid {
      display: grid;
      grid-template-columns: repeat(6, minmax(0, 1fr));
      gap: 12px;
    }

    .kpi-card,
    .twin-card {
      border: 1px solid #d9e2ea;
      background: #ffffff;
      border-radius: 8px;
      padding: 16px;
      min-width: 0;
      text-align: left;
      box-shadow: 0 12px 28px rgba(15, 23, 42, 0.06);
    }

    .kpi-card {
      display: grid;
      gap: 8px;
      border-top: 4px solid #64748b;
    }

    .kpi-card span,
    .kpi-card small,
    .mini-metrics span,
    .signal-row small,
    .command-row small,
    .profit-row span,
    .audit-row small,
    .audit-row span {
      color: #64748b;
      font-size: 12px;
    }

    .kpi-card strong {
      font-size: 25px;
      line-height: 1.1;
      letter-spacing: 0;
    }

    .kpi-card.teal { border-top-color: #4B1238; }
    .kpi-card.green { border-top-color: #C87D4B; }
    .kpi-card.amber { border-top-color: #b7791f; }
    .kpi-card.red { border-top-color: #dc2626; }
    .kpi-card.blue { border-top-color: #4B1238; }
    .kpi-card.violet { border-top-color: #7c3aed; }

    .section-band {
      padding: 18px;
    }

    .section-heading {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      align-items: flex-end;
      margin-bottom: 14px;
    }

    .section-heading h2 {
      font-size: 18px;
      letter-spacing: 0;
      margin-top: 3px;
    }

    .snapshot-label {
      color: #64748b;
      font-size: 12px;
      font-weight: 800;
      text-align: right;
    }

    .module-link-grid {
      display: grid;
      gap: 10px;
      grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
    }

    .module-link-card {
      display: grid;
      gap: 6px;
      border: 1px solid #d9e2ea;
      border-radius: 8px;
      padding: 14px;
      text-decoration: none;
      color: #0f172a;
      background: #f8fafc;
      border-left: 5px solid #64748b;
    }

    .module-link-card span {
      color: #52617a;
      font-size: 12px;
      font-weight: 900;
      text-transform: uppercase;
    }

    .module-link-card strong {
      font-size: 24px;
      line-height: 1;
    }

    .module-link-card small {
      color: #64748b;
      font-weight: 700;
    }

    .module-link-card.green { border-left-color: #C87D4B; }
    .module-link-card.blue { border-left-color: #4B1238; }
    .module-link-card.amber { border-left-color: #b7791f; }
    .module-link-card.red { border-left-color: #dc2626; }
    .module-link-card.violet { border-left-color: #7c3aed; }
    .module-link-card.teal { border-left-color: #4B1238; }

    .command-list,
    .signal-list,
    .audit-timeline {
      display: grid;
      gap: 10px;
      max-height: 430px;
      overflow: auto;
      padding-right: 4px;
    }

    .command-list {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .command-row,
    .signal-row,
    .audit-row,
    .profit-row {
      width: 100%;
      display: grid;
      gap: 6px;
      align-items: center;
      border: 1px solid #d9e2ea;
      border-radius: 8px;
      background: #fbfdff;
      padding: 12px;
      text-align: left;
      cursor: pointer;
      color: inherit;
    }

    .command-row {
      grid-template-columns: auto 1fr;
    }

    .command-row small {
      grid-column: 2;
    }

    .profit-grid,
    .twin-grid {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 12px;
      max-height: 430px;
      overflow: auto;
      padding-right: 4px;
    }

    .profit-row {
      grid-template-columns: minmax(0, 1fr) auto auto;
    }

    .profit-row strong,
    .profit-row span,
    .signal-row strong,
    .signal-row small,
    .command-row strong,
    .command-row small,
    .audit-row strong,
    .audit-row small {
      overflow-wrap: anywhere;
    }

    .twin-card {
      cursor: pointer;
      display: grid;
      gap: 12px;
      color: inherit;
    }

    .twin-top {
      display: flex;
      justify-content: space-between;
      gap: 10px;
      align-items: flex-start;
    }

    .twin-top strong {
      display: block;
      font-size: 16px;
    }

    .twin-top span:not(.badge) {
      color: #64748b;
      font-size: 12px;
    }

    .mini-metrics {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 8px;
    }

    .mini-metrics span {
      border: 1px solid #E7DDD6;
      border-radius: 8px;
      padding: 8px;
      background: #f8fafc;
    }

    .mini-metrics b {
      display: block;
      color: #0f172a;
      font-size: 14px;
      overflow-wrap: anywhere;
    }

    .two-column {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 18px;
    }

    .table-wrap {
      overflow: auto;
      border: 1px solid #E7DDD6;
      border-radius: 8px;
      max-height: 430px;
    }

    table {
      width: 100%;
      border-collapse: collapse;
      min-width: 520px;
    }

    th,
    td {
      padding: 11px 12px;
      text-align: left;
      border-bottom: 1px solid #E7DDD6;
      vertical-align: top;
    }

    th {
      background: #f8fafc;
      color: #475569;
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0;
    }

    tbody tr {
      cursor: pointer;
    }

    tbody tr:hover,
    .command-row:hover,
    .signal-row:hover,
    .audit-row:hover,
    .profit-row:hover,
    .twin-card:hover {
      border-color: #4B1238;
      background: #F5EEF2;
    }

    .badge {
      display: inline-flex;
      min-height: 24px;
      align-items: center;
      justify-content: center;
      width: fit-content;
      border-radius: 999px;
      padding: 0 10px;
      font-size: 12px;
      font-weight: 800;
      color: #334155;
      background: #E7DDD6;
      border: 1px solid #cbd5e1;
      text-transform: capitalize;
      white-space: nowrap;
    }

    .badge.low,
    .badge.success,
    .badge.ready,
    .badge.approved,
    .badge.active {
      color: #7A4A28;
      background: #FBF0E8;
      border-color: #E8C8A8;
    }

    .badge.medium,
    .badge.warning,
    .badge.recommended,
    .badge.pending,
    .badge.assigned {
      color: #854d0e;
      background: #fef3c7;
      border-color: #facc15;
    }

    .badge.high,
    .badge.critical,
    .badge.error,
    .badge.open,
    .badge.overdue,
    .badge.rejected {
      color: #991b1b;
      background: #fee2e2;
      border-color: #fca5a5;
    }

    .badge.info,
    .badge.preview,
    .badge.draft {
      color: #4B1238;
      background: #F8EEF4;
      border-color: #C8A0B8;
    }

    .detail-drawer {
      position: fixed;
      top: 170px;
      right: 16px;
      bottom: 16px;
      width: min(520px, calc(100vw - 32px));
      z-index: 20;
      border: 1px solid #cfd9e6;
      border-radius: 8px;
      background: #ffffff;
      box-shadow: 0 30px 80px rgba(15, 23, 42, 0.24);
      padding: 18px;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .drawer-header {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      align-items: flex-start;
    }

    .drawer-header h2,
    .drawer-header p {
      margin: 0;
    }

    .drawer-header h2 {
      margin-top: 4px;
      font-size: 21px;
      letter-spacing: 0;
    }

    .drawer-header p {
      margin-top: 5px;
      color: #64748b;
    }

    .icon-button {
      width: 38px;
      padding: 0;
      font-size: 22px;
      line-height: 1;
    }

    .drawer-badges {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
    }

    .detail-summary-grid,
    .evidence-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 10px;
    }

    .detail-summary-grid article,
    .evidence-grid article,
    .drawer-action-card {
      border: 1px solid #d9e2ea;
      border-radius: 8px;
      background: #f8fafc;
      padding: 12px;
      display: grid;
      gap: 5px;
    }

    .detail-summary-grid span,
    .evidence-grid span,
    .drawer-action-card span {
      color: #64748b;
      font-size: 12px;
      font-weight: 900;
      text-transform: uppercase;
    }

    .detail-summary-grid strong,
    .evidence-grid strong,
    .drawer-action-card strong,
    .drawer-action-card small {
      overflow-wrap: anywhere;
    }

    .drawer-action-card small {
      color: #475569;
      font-weight: 700;
    }

    .technical-details {
      border: 1px solid #d9e2ea;
      border-radius: 8px;
      overflow: hidden;
    }

    .technical-details summary {
      cursor: pointer;
      font-weight: 900;
      padding: 12px;
      background: #f8fafc;
    }

    pre {
      margin: 0;
      padding: 12px;
      border-radius: 8px;
      background: #0f172a;
      color: #E7DDD6;
      overflow: auto;
      white-space: pre-wrap;
      word-break: break-word;
      font-size: 12px;
      line-height: 1.5;
      max-height: 340px;
    }

    @media (max-width: 1180px) {
      .kpi-grid,
      .profit-grid,
      .twin-grid {
        grid-template-columns: repeat(3, minmax(0, 1fr));
      }

      .filter-band {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }

      .detail-drawer {
        top: 150px;
        width: min(500px, calc(100vw - 32px));
      }
    }

    @media (max-width: 860px) {
      .enterprise-header,
      .two-column {
        grid-template-columns: 1fr;
        display: grid;
      }

      .command-list,
      .profit-grid,
      .twin-grid,
      .kpi-grid {
        grid-template-columns: 1fr;
      }
    }

    @media (max-width: 640px) {
      .enterprise-header,
      .filter-band,
      .section-band {
        padding: 14px;
      }

      .filter-band {
        grid-template-columns: 1fr;
      }

      .filter-actions,
      .header-actions {
        width: 100%;
      }

      .filter-actions > *,
      .header-actions > * {
        flex: 1;
      }

      .profit-row,
      .command-row {
        grid-template-columns: 1fr;
      }

      .command-row small {
        grid-column: auto;
      }

      .detail-drawer {
        left: 12px;
        right: 12px;
        top: 140px;
        width: auto;
      }
    }
  `]
})
export class StaffEnterpriseComponent implements OnInit {
  readonly loading = signal(false);
  readonly error = signal('');
  readonly command = signal<StaffEnterpriseCommandCenter | null>(null);
  readonly digitalTwins = signal<DigitalTwinResponse | null>(null);
  readonly skillMatrix = signal<ListResponse<SkillMatrixRow> | null>(null);
  readonly riskSignals = signal<ListResponse<EnterpriseItem> | null>(null);
  readonly floorControl = signal<ListResponse<EnterpriseItem> | null>(null);
  readonly payrollIntelligence = signal<ListResponse<EnterpriseItem> | null>(null);
  readonly auditTrail = signal<ListResponse<EnterpriseItem> | null>(null);
  readonly training = signal<ListResponse<EnterpriseItem> | null>(null);
  readonly approvals = signal<ListResponse<EnterpriseItem> | null>(null);
  readonly branches = signal<BranchOption[]>([]);
  readonly staff = signal<StaffOption[]>([]);
  readonly selected = signal<DetailSelection | null>(null);
  private readonly filterRevision = signal(0);

  readonly filters = {
    periodStart: dateDaysAgo(29),
    periodEnd: today(),
    branchId: '',
    staffId: ''
  };

  private readonly kpiValues = computed(() => this.command()?.kpis || {});
  private readonly selectedStaffId = computed(() => {
    this.filterRevision();
    return this.filters.staffId;
  });
  private readonly staffOptionRows = computed(() => {
    const fromTwins = this.digitalTwins()?.items?.map((twin) => ({
      id: twin.staffId,
      name: twin.staffName || twin.staffId,
      branchId: twin.branchId
    })) || [];
    const map = new Map<string, StaffOption>();
    for (const item of [...this.staff(), ...fromTwins]) {
      if (item.id) map.set(item.id, item);
    }
    return [...map.values()].sort((a, b) => String(a.name || a.fullName || a.id).localeCompare(String(b.name || b.fullName || b.id)));
  });
  private readonly commandQueueRows = computed(() => {
    const command = this.command();
    return [...(command?.attentionQueue || []), ...(command?.recommendations || [])].slice(0, 12);
  });
  private readonly twinRows = computed(() => (this.digitalTwins()?.items || []).filter((item) => this.matchesStaff(item.staffId)));
  private readonly skillMatrixRows = computed(() => (this.skillMatrix()?.items || []).filter((item) => this.matchesStaff(item.staffId)));
  private readonly riskSignalRows = computed(() => (this.riskSignals()?.items || []).filter((item) => this.matchesStaff(item.staffId)));
  private readonly revenueLeakageRows = computed(() => {
    const leakageTypes = new Set(['revenue_leakage', 'discount_misuse', 'cash_handling_risk', 'commission_anomaly']);
    return this.riskSignalRows().filter((item) => leakageTypes.has(String(item.signalType || item.type || '')));
  });
  private readonly burnoutRows = computed(() => {
    const burnoutTypes = new Set(['burnout_risk', 'attrition_risk', 'low_utilization', 'overbooking_risk', 'attendance_manipulation', 'repeated_client_complaints', 'staff_client_mismatch', 'uncertified_service_assignment']);
    return this.riskSignalRows().filter((item) => burnoutTypes.has(String(item.signalType || item.type || '')));
  });
  private readonly floorRows = computed(() => (this.floorControl()?.items || []).filter((item) => this.matchesStaff(item.staffId)));
  private readonly payrollRows = computed(() => {
    const stored = this.payrollIntelligence()?.stored || [];
    const items = this.payrollIntelligence()?.items || [];
    return [...items, ...stored].filter((item) => this.matchesStaff(item.staffId));
  });
  private readonly trainingRows = computed(() => (this.training()?.items || []).filter((item) => this.matchesStaff(item.staffId)));
  private readonly approvalRows = computed(() => (this.approvals()?.items || []).filter((item) => this.matchesStaff(item.staffId)));
  private readonly auditRows = computed(() => (this.auditTrail()?.items || []).filter((item) => this.matchesStaff(item.staffId)));
  private readonly profitInsightRows = computed(() => {
    const payrollByStaff = new Map(this.payrollRows().map((row) => [row.staffId || '', row]));
    return this.twinRows().map((twin) => {
      const payroll = payrollByStaff.get(twin.staffId);
      const revenue = Number(twin.performance?.revenue || twin.finance?.revenue || 0);
      const grossPay = Number(payroll?.grossPay || 0);
      const scheduledShifts = Number(twin.performance?.scheduledShifts || 0);
      const presentDays = Number(twin.performance?.presentDays || 0);
      const estimatedMinutes = Math.max(1, (scheduledShifts || presentDays || 1) * 540);
      const profitPerMinute = (revenue - grossPay) / estimatedMinutes;
      return {
        staffId: twin.staffId,
        staffName: twin.staffName || twin.staffId,
        branchId: twin.branchId || '',
        revenue,
        grossPay,
        estimatedMinutes,
        profitPerMinute,
        riskLevel: profitPerMinute < 0 ? 'high' : profitPerMinute < 20 ? 'medium' : 'low'
      };
    }).sort((a, b) => b.profitPerMinute - a.profitPerMinute).slice(0, 9);
  });
  private readonly emptyState = computed(() => !this.commandQueueRows().length
    && !this.twinRows().length
    && !this.riskSignalRows().length
    && !this.trainingRows().length
    && !this.auditRows().length);

  constructor(private readonly api: ApiService) {}

  ngOnInit(): void {
    this.loadLookups();
    this.loadDashboard();
  }

  loadLookups(): void {
    forkJoin({
      branches: this.api.list<BranchOption[]>('branches', { limit: 200 }),
      staff: this.api.list<StaffOption[]>('staff', { limit: 1000 })
    }).subscribe({
      next: ({ branches, staff }) => {
        this.branches.set(Array.isArray(branches) ? branches : []);
        this.staff.set(Array.isArray(staff) ? staff : []);
      },
      error: () => {
        this.branches.set([]);
        this.staff.set([]);
      }
    });
  }

  loadDashboard(): void {
    this.loading.set(true);
    this.error.set('');
    const params = this.queryParams();
    forkJoin({
      command: this.api.list<StaffEnterpriseCommandCenter>('staff-enterprise/command-center', params),
      digitalTwins: this.api.list<DigitalTwinResponse>('staff-enterprise/digital-twins', params),
      skillMatrix: this.api.list<ListResponse<SkillMatrixRow>>('staff-enterprise/skill-matrix', params),
      riskSignals: this.api.list<ListResponse<EnterpriseItem>>('staff-enterprise/risk-signals', params),
      floorControl: this.api.list<ListResponse<EnterpriseItem>>('staff-enterprise/floor-control', params),
      payrollIntelligence: this.api.list<ListResponse<EnterpriseItem>>('staff-enterprise/payroll-intelligence', params),
      auditTrail: this.api.list<ListResponse<EnterpriseItem>>('staff-enterprise/audit-trail', params),
      training: this.api.list<ListResponse<EnterpriseItem>>('staff-enterprise/training', params),
      approvals: this.api.list<ListResponse<EnterpriseItem>>('staff-enterprise/approvals', params)
    }).pipe(finalize(() => this.loading.set(false))).subscribe({
      next: (result) => {
        this.command.set(result.command);
        this.digitalTwins.set(result.digitalTwins);
        this.skillMatrix.set(result.skillMatrix);
        this.riskSignals.set(result.riskSignals);
        this.floorControl.set(result.floorControl);
        this.payrollIntelligence.set(result.payrollIntelligence);
        this.auditTrail.set(result.auditTrail);
        this.training.set(result.training);
        this.approvals.set(result.approvals);
      },
      error: (error: unknown) => {
        this.error.set(error instanceof Error ? error.message : 'Unable to load Staff Enterprise OS');
      }
    });
  }

  resetFilters(): void {
    this.filters.periodStart = dateDaysAgo(29);
    this.filters.periodEnd = today();
    this.filters.branchId = '';
    this.filters.staffId = '';
    this.bumpFilterRevision();
    this.loadDashboard();
  }

  setFilter(key: StaffEnterpriseFilterKey, value: string): void {
    this.filters[key] = value;
    this.bumpFilterRevision();
  }

  kpis(): StaffEnterpriseKpis {
    return this.kpiValues();
  }

  commandQueue(): EnterpriseItem[] {
    return this.commandQueueRows();
  }

  staffCommandLinks(): StaffCommandLink[] {
    const sourceCounts = this.command()?.sourceCounts || {};
    const kpis = this.kpis();
    return [
      { label: 'Employee Masters', path: '/staff-os/employee-masters', metric: kpis.staffCount || this.staffOptions().length || 0, description: 'profile, category, salary and statutory master', tone: 'teal' },
      { label: 'Attendance Dash', path: '/staff-os/attendance-dashboard', metric: kpis.presentDays || 0, description: 'present days, late marks and attendance signals', tone: 'green' },
      { label: 'Roster Calendar', path: '/staff-os/roster-calendar', metric: kpis.scheduledShifts || 0, description: 'scheduled shifts and floor availability', tone: 'blue' },
      { label: 'Payroll Dash', path: '/staff-os/payroll-dashboard', metric: this.moneyShort(kpis.totalRevenue || 0), description: 'salary, payout and compliance review', tone: 'violet' },
      { label: 'Commission Dash', path: '/staff-os/commission-dashboard', metric: this.moneyShort(kpis.totalCommission || 0), description: 'invoice linked commission and incentive payout', tone: 'amber' },
      { label: 'Staff Sales', path: '/reports/staff-sales', metric: sourceCounts['invoices'] || sourceCounts['appointments'] || 0, description: 'POS and appointment revenue attribution', tone: 'teal' },
      { label: 'Invoice Reports', path: '/reports/invoices', metric: sourceCounts['invoices'] || 0, description: 'invoice, due, GST, discount and wallet drilldown', tone: 'blue' },
      { label: 'Commission Preview', path: '/reports/commission-preview', metric: this.payrollFiltered().length, description: 'pre-payroll commission verification', tone: 'amber' },
      { label: 'Leave Mgmt', path: '/staff-os/leave-management', metric: this.approvalsFiltered().length, description: 'leave approval and availability queue', tone: 'green' },
      { label: 'Training Center', path: '/staff-os/training-center', metric: kpis.trainingDue || this.trainingFiltered().length, description: 'coaching and skill upgrade suggestions', tone: 'violet' },
      { label: 'Risk Signals', path: '/staff-enterprise', metric: kpis.highRiskSignals || this.riskSignalsFiltered().length, description: 'burnout, leakage and compliance alerts', tone: 'red' },
      { label: 'Tips Register', path: '/pos/tips', metric: sourceCounts['tips'] || 0, description: 'staff tip collection and payout register', tone: 'teal' }
    ];
  }

  staffOptions(): StaffOption[] {
    return this.staffOptionRows();
  }

  moneyShort(value: number): string {
    const amount = Number(value || 0);
    if (Math.abs(amount) >= 100000) return `₹${Math.round(amount / 100000)}L`;
    if (Math.abs(amount) >= 1000) return `₹${Math.round(amount / 1000)}K`;
    return `₹${Math.round(amount)}`;
  }

  twinsFiltered(): DigitalTwin[] {
    return this.twinRows();
  }

  skillMatrixFiltered(): SkillMatrixRow[] {
    return this.skillMatrixRows();
  }

  riskSignalsFiltered(): EnterpriseItem[] {
    return this.riskSignalRows();
  }

  revenueLeakageSignals(): EnterpriseItem[] {
    return this.revenueLeakageRows();
  }

  burnoutSignals(): EnterpriseItem[] {
    return this.burnoutRows();
  }

  floorFiltered(): EnterpriseItem[] {
    return this.floorRows();
  }

  payrollFiltered(): EnterpriseItem[] {
    return this.payrollRows();
  }

  trainingFiltered(): EnterpriseItem[] {
    return this.trainingRows();
  }

  approvalsFiltered(): EnterpriseItem[] {
    return this.approvalRows();
  }

  auditFiltered(): EnterpriseItem[] {
    return this.auditRows();
  }

  profitInsights(): ProfitInsight[] {
    return this.profitInsightRows();
  }

  isEmpty(): boolean {
    return this.emptyState();
  }

  openDetail(eyebrow: string, title: string, subtitle: string, payload: unknown): void {
    const record = isRecord(payload) ? payload : {};
    this.selected.set({
      eyebrow,
      title,
      subtitle,
      status: typeof record['status'] === 'string' ? record['status'] : undefined,
      riskLevel: typeof record['riskLevel'] === 'string' ? record['riskLevel'] : typeof record['complianceRiskLevel'] === 'string' ? record['complianceRiskLevel'] : undefined,
      payload
    });
  }

  detailValue(payload: unknown, key: string, fallback = '-'): string {
    const record = isRecord(payload) ? payload : {};
    const value = record[key];
    if (value === undefined || value === null || value === '') return fallback;
    if (Array.isArray(value)) return value.map((item) => this.text(item, '')).filter(Boolean).join(', ') || fallback;
    if (isRecord(value)) return JSON.stringify(value);
    return String(value);
  }

  detailReasons(payload: unknown): string[] {
    const record = isRecord(payload) ? payload : {};
    const reasons = record['reasons'];
    if (Array.isArray(reasons)) return reasons.map((reason) => this.text(reason, '')).filter(Boolean).slice(0, 4);
    return [];
  }

  detailEvidence(payload: unknown): Array<{ label: string; value: string }> {
    const record = isRecord(payload) ? payload : {};
    const evidence = isRecord(record['evidence']) ? record['evidence'] : {};
    return Object.entries(evidence).slice(0, 6).map(([label, value]) => ({
      label,
      value: this.text(value, '-')
    }));
  }

  riskClass(level?: unknown): string {
    const normalized = String(level || 'info').toLowerCase();
    if (['critical', 'high'].includes(normalized)) return normalized;
    if (['medium', 'warning', 'pending', 'recommended'].includes(normalized)) return 'medium';
    if (['low', 'success', 'approved', 'ready', 'active'].includes(normalized)) return 'low';
    return 'info';
  }

  statusClass(value?: unknown): string {
    const normalized = String(value || 'info').toLowerCase();
    if (['approved', 'active', 'ready', 'resolved', 'completed'].includes(normalized)) return 'success';
    if (['pending', 'assigned', 'recommended', 'warning', 'open'].includes(normalized)) return 'warning';
    if (['rejected', 'overdue', 'error', 'failed', 'critical'].includes(normalized)) return 'error';
    if (['draft', 'preview', 'queued'].includes(normalized)) return 'preview';
    return 'info';
  }

  firstText(values?: string[]): string {
    return Array.isArray(values) && values.length ? values[0] : 'No recommendation for selected period';
  }

  text(value: unknown, fallback: string): string {
    const normalized = String(value || '').trim();
    return normalized || fallback;
  }

  queryParams(): ApiRecord {
    return {
      periodStart: this.filters.periodStart,
      periodEnd: this.filters.periodEnd,
      branchId: this.filters.branchId,
      staffId: this.filters.staffId
    };
  }

  private matchesStaff(staffId?: string): boolean {
    const selectedStaffId = this.selectedStaffId();
    return !selectedStaffId || staffId === selectedStaffId;
  }

  private bumpFilterRevision(): void {
    this.filterRevision.update((value) => value + 1);
  }
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

function dateDaysAgo(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return date.toISOString().slice(0, 10);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}
