import { CommonModule } from '@angular/common';
import { Component, OnInit, computed, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { finalize } from 'rxjs';
import { ApiRecord } from '../../../core/api.service';
import { AppStateService } from '../../../core/state/app-state.service';
import { StaffOsApi } from '../data/staff-os.api';
import { StaffOsPerformanceDetailResponse, StaffOsPerformanceIntelligenceRow } from '../domain/staff-os.models';
import { AuraMoneyPipe } from '../../../shared/pipes/aura-money.pipe';

@Component({
  standalone: true,
  imports: [AuraMoneyPipe, CommonModule, RouterLink],
  template: `
    <main class="perf-detail-shell">
      <header class="perf-detail-header">
        <div>
          <span>Staff Performance Drilldown</span>
          <h1>{{ staffName() }}</h1>
          <p>{{ detail()?.ownerSummary?.headline || 'Service time, attendance, product usage, repeat clients and profitability ka staff-level breakdown.' }}</p>
        </div>
        <nav>
          <a routerLink="/staff-os/performance-dashboard" [queryParams]="contextParams()">Dashboard</a>
          <a routerLink="/reports/staff-sales" [queryParams]="contextParams()">Staff sales</a>
          <button type="button" (click)="load()">Refresh</button>
        </nav>
      </header>

      <section class="state error" *ngIf="error()">{{ error() }}</section>
      <section class="state" *ngIf="loading()">Loading staff performance...</section>

      <ng-container *ngIf="intelligence() as row">
        <section class="score-hero" [class]="gradeClass(row)">
          <article>
            <span>Final score</span>
            <strong>{{ row.score | number:'1.0-0' }}</strong>
            <small>#{{ row.rank || 0 }} · {{ row.letterGrade || row.grade }} · trend {{ row.trend?.label || 'New' }}</small>
          </article>
          <article>
            <span>Net contribution</span>
            <strong>{{ rupees(row.profitability?.netContributionPaise) | auraMoney:'1.0-0' }}</strong>
            <small>{{ rupees(row.profitability?.revenuePaise) | auraMoney:'1.0-0' }} revenue</small>
          </article>
          <article>
            <span>Product wastage</span>
            <strong>{{ rupees(row.productUsage?.wastageCostPaise) | auraMoney:'1.0-0' }}</strong>
            <small>{{ row.productUsage?.wastagePct || 0 | number:'1.0-1' }}% variance</small>
          </article>
          <article>
            <span>Repeat pull</span>
            <strong>{{ row.clientRetention?.repeatClientRate || 0 | number:'1.0-1' }}%</strong>
            <small>{{ row.clientRetention?.repeatClients || 0 }} repeat of {{ row.clientRetention?.clients || 0 }}</small>
          </article>
        </section>

        <section class="product-panel" *ngIf="row.aiSummary">
          <div class="panel-head">
            <span>{{ row.aiSummary.agentKey || 'ai-staff-coach' }}</span>
            <strong>{{ row.aiSummary.priority || 'low' }} · {{ row.aiSummary.confidence || 0 }}%</strong>
          </div>
          <p>{{ row.aiSummary.headline }}</p>
          <div class="detail-table">
            <div class="tr head"><span>Action</span><span>Priority</span><span>Due</span><span>Evidence</span><span>Expected</span></div>
            <div class="tr" *ngFor="let action of row.aiActions || []">
              <span><strong>{{ action.title }}</strong><small>{{ action.action }}</small></span>
              <span>{{ action.priority }}</span>
              <span>{{ action.dueInDays || 0 }} days</span>
              <span>{{ action.evidence }}</span>
              <span>{{ action.expectedOutcome }}</span>
            </div>
          </div>
        </section>

        <section class="breakdown-grid">
          <article>
            <div class="panel-head"><span>Service time</span><strong>{{ row.serviceTime?.score || 0 | number:'1.0-0' }}</strong></div>
            <dl>
              <div><dt>Completed</dt><dd>{{ row.serviceTime?.completed || 0 }}</dd></div>
              <div><dt>Delayed</dt><dd>{{ row.serviceTime?.delayed || 0 }}</dd></div>
              <div><dt>Avg over</dt><dd>{{ row.serviceTime?.avgOverMinutes || 0 | number:'1.0-1' }} min</dd></div>
              <div><dt>Allowed</dt><dd>{{ row.serviceTime?.allowedMinutes || 0 }} min</dd></div>
              <div><dt>Salary loss</dt><dd>{{ rupees(row.serviceTime?.salaryLossPaise) | auraMoney:'1.0-0' }}</dd></div>
              <div><dt>Hourly cost</dt><dd>{{ rupees(row.serviceTime?.hourlySalaryPaise) | auraMoney:'1.0-0' }}</dd></div>
              <div><dt>Shift hours</dt><dd>{{ row.serviceTime?.shiftHours || 9 }} hr</dd></div>
              <div><dt>Shift source</dt><dd>{{ row.serviceTime?.shiftSource === 'staff_shift' ? 'Staff shift' : 'Payroll default' }}</dd></div>
              <div><dt>Salary source</dt><dd>{{ row.serviceTime?.salarySource === 'staff_salary_profile' ? 'Staff profile' : 'Missing' }}</dd></div>
            </dl>
          </article>
          <article>
            <div class="panel-head"><span>Attendance</span><strong>{{ row.attendance?.score || 0 | number:'1.0-0' }}</strong></div>
            <dl>
              <div><dt>Present</dt><dd>{{ row.attendance?.presentDays || 0 }}/{{ row.attendance?.expectedWorkingDays || 0 }}</dd></div>
              <div><dt>Gap</dt><dd>{{ row.attendance?.absentDays || 0 }}</dd></div>
              <div><dt>Late</dt><dd>{{ row.attendance?.lateMinutes || 0 }} min</dd></div>
              <div><dt>Overtime</dt><dd>{{ row.attendance?.overtimeMinutes || 0 }} min</dd></div>
            </dl>
          </article>
          <article>
            <div class="panel-head"><span>Product usage</span><strong>{{ row.productUsage?.score || 0 | number:'1.0-0' }}</strong></div>
            <dl>
              <div><dt>Drafts</dt><dd>{{ row.productUsage?.drafts || 0 }}</dd></div>
              <div><dt>Expected</dt><dd>{{ rupees(row.productUsage?.expectedCostPaise) | auraMoney:'1.0-0' }}</dd></div>
              <div><dt>Actual</dt><dd>{{ rupees(row.productUsage?.actualCostPaise) | auraMoney:'1.0-0' }}</dd></div>
              <div><dt>Wastage</dt><dd>{{ rupees(row.productUsage?.wastageCostPaise) | auraMoney:'1.0-0' }}</dd></div>
            </dl>
          </article>
          <article>
            <div class="panel-head"><span>Clients</span><strong>{{ row.clientRetention?.score || 0 | number:'1.0-0' }}</strong></div>
            <dl>
              <div><dt>Clients</dt><dd>{{ row.clientRetention?.clients || 0 }}</dd></div>
              <div><dt>Repeat clients</dt><dd>{{ row.clientRetention?.repeatClients || 0 }}</dd></div>
              <div><dt>New clients</dt><dd>{{ row.newReferral?.newClients || 0 }}</dd></div>
              <div><dt>Referrals</dt><dd>{{ row.newReferral?.referralClients || 0 }} / {{ row.newReferral?.referralRate || 0 | number:'1.0-1' }}%</dd></div>
              <div><dt>Repeat rate</dt><dd>{{ row.clientRetention?.repeatClientRate || 0 | number:'1.0-1' }}%</dd></div>
            </dl>
          </article>
        </section>

        <section class="product-panel" *ngIf="serviceRows(row).length">
          <div class="panel-head"><span>Service skill summary</span><strong>{{ skillRows(row).length }}</strong></div>
          <div class="detail-table" *ngIf="skillRows(row).length">
            <div class="tr head"><span>Service</span><span>Score</span><span>Avg delay</span><span>Delayed</span><span>Loss</span></div>
            <div class="tr" *ngFor="let skill of skillRows(row)">
              <span><strong>{{ skill['serviceName'] || 'Service' }}</strong><small>{{ skill['status'] || 'skill' }}</small></span>
              <span>{{ skill['score'] || 0 | number:'1.0-0' }}</span>
              <span>{{ skill['avgOverMinutes'] || 0 | number:'1.0-1' }} min</span>
              <span>{{ skill['delayed'] || 0 }} / {{ skill['completed'] || 0 }}</span>
              <span>{{ rupees(skill['salaryLossPaise']) | auraMoney:'1.0-0' }}</span>
            </div>
          </div>
        </section>

        <section class="product-panel" *ngIf="serviceRows(row).length">
          <div class="panel-head"><span>Service time details</span><strong>{{ serviceRows(row).length }}</strong></div>
          <div class="detail-table">
            <div class="tr head"><span>Service</span><span>Allowed</span><span>Actual</span><span>Delay</span><span>Salary loss</span></div>
            <div class="tr" *ngFor="let service of serviceRows(row)">
              <span><strong>{{ service['serviceName'] || 'Service' }}</strong><small>{{ service['appointmentId'] || '' }}</small></span>
              <span>{{ service['allowedMinutes'] || 0 }} min</span>
              <span>{{ service['actualMinutes'] || 0 }} min</span>
              <span>{{ service['overMinutes'] || 0 }} min</span>
              <span>{{ rupees(service['delayCostPaise']) | auraMoney:'1.0-0' }}<small>{{ service['salarySource'] === 'staff_salary_profile' ? 'Salary linked' : 'Set salary' }}</small></span>
            </div>
          </div>
        </section>

        <section class="product-panel" *ngIf="referralRows(row).length">
          <div class="panel-head"><span>Referral clients</span><strong>{{ referralRows(row).length }}</strong></div>
          <div class="detail-table referral">
            <div class="tr head"><span>Client</span><span>Referred by</span><span>Source</span><span>Score</span><span>Status</span></div>
            <div class="tr" *ngFor="let referral of referralRows(row)">
              <span><strong>{{ referral['clientName'] || referral['clientId'] }}</strong><small>{{ referral['clientId'] || '' }}</small></span>
              <span>{{ referral['referredByClientId'] || '-' }}</span>
              <span>Appointment</span>
              <span>{{ row.newReferral?.score || 0 | number:'1.0-0' }}</span>
              <span>Captured</span>
            </div>
          </div>
        </section>

        <section class="insight-grid">
          <article>
            <h2>Risks</h2>
            <p *ngFor="let item of row.risks || []">{{ item }}</p>
            <p *ngIf="!row.risks?.length">No open risk for this period.</p>
          </article>
          <article>
            <h2>Strengths</h2>
            <p *ngFor="let item of row.strengths || []">{{ item }}</p>
            <p *ngIf="!row.strengths?.length">Strength signal will appear after more performance evidence.</p>
          </article>
          <article>
            <h2>Actions</h2>
            <p *ngFor="let item of row.recommendedActions || []">{{ item }}</p>
          </article>
        </section>

        <section class="product-panel" *ngIf="productRows(row).length">
          <div class="panel-head"><span>Product wastage lines</span><strong>{{ productRows(row).length }}</strong></div>
          <div class="detail-table">
            <div class="tr head"><span>Product</span><span>Expected</span><span>Actual</span><span>Extra</span><span>Loss</span></div>
            <div class="tr" *ngFor="let product of productRows(row)">
              <span><strong>{{ product['productName'] || product['productId'] }}</strong><small>{{ product['unit'] || '' }}</small></span>
              <span>{{ product['expectedQty'] || 0 }}</span>
              <span>{{ product['actualQty'] || 0 }}</span>
              <span>{{ product['extraQty'] || 0 }}</span>
              <span>{{ rupees(product['wastageCostPaise']) | auraMoney:'1.0-0' }}</span>
            </div>
          </div>
        </section>
      </ng-container>

      <section class="product-panel" *ngIf="detail()?.rows?.length">
        <div class="panel-head"><span>Daily performance rows</span><strong>{{ detail()?.rows?.length || 0 }}</strong></div>
        <div class="detail-table daily">
          <div class="tr head"><span>Date</span><span>Score</span><span>Revenue</span><span>Utilization</span><span>Rating</span></div>
          <div class="tr" *ngFor="let day of detail()?.rows || []">
            <span>{{ day.businessDate }}</span>
            <span>{{ day.productivityScore | number:'1.0-0' }}</span>
            <span>{{ day.revenueGenerated | auraMoney:'1.0-0' }}</span>
            <span>{{ day.utilizationPct | number:'1.0-0' }}%</span>
            <span>{{ day.avgRating | number:'1.0-1' }}</span>
          </div>
        </div>
      </section>

      <section class="state" *ngIf="!loading() && !intelligence() && !error()">No staff performance detail found.</section>
    </main>
  `,
  styles: [`
    .perf-detail-shell { display: grid; gap: 14px; padding: 16px; }
    .perf-detail-header { align-items: center; background: #fff; border: 1px solid #d9e5de; border-radius: 8px; display: grid; gap: 12px; grid-template-columns: minmax(0, 1fr) auto; padding: 16px; }
    .perf-detail-header span, .score-hero span, .panel-head span { color: #60766d; font-size: 12px; font-weight: 900; text-transform: uppercase; }
    .perf-detail-header h1 { color: #10201a; font-size: 28px; margin: 2px 0; }
    .perf-detail-header p { color: #60766d; margin: 0; }
    .perf-detail-header nav { display: flex; flex-wrap: wrap; gap: 8px; justify-content: flex-end; }
    .perf-detail-header a, .perf-detail-header button { background: #fff; border: 1px solid #cbd8d2; border-radius: 6px; color: #0f766e; cursor: pointer; font: inherit; font-weight: 900; min-height: 36px; padding: 8px 11px; text-decoration: none; }
    .score-hero, .breakdown-grid, .insight-grid { display: grid; gap: 12px; grid-template-columns: repeat(4, minmax(0, 1fr)); }
    .score-hero article, .breakdown-grid article, .insight-grid article, .product-panel, .state { background: #fff; border: 1px solid #d9e5de; border-radius: 8px; padding: 14px; }
    .score-hero article { border-left: 5px solid #64748b; display: grid; gap: 5px; }
    .score-hero.excellent article { border-left-color: #168246; }
    .score-hero.good article { border-left-color: #0f766e; }
    .score-hero.watch article { border-left-color: #b7791f; }
    .score-hero.critical article { border-left-color: #dc2626; }
    .score-hero strong { color: #10201a; font-size: 28px; line-height: 1; }
    .score-hero small, dt, .tr small { color: #60766d; }
    .breakdown-grid article, .insight-grid article, .product-panel { display: grid; gap: 10px; }
    .panel-head { align-items: center; display: flex; justify-content: space-between; gap: 12px; }
    .panel-head strong { color: #10201a; font-size: 22px; }
    dl { display: grid; gap: 8px; margin: 0; }
    dl div { align-items: center; border-top: 1px solid #edf2ef; display: flex; justify-content: space-between; padding-top: 8px; }
    dt { font-weight: 800; }
    dd { color: #10201a; font-weight: 900; margin: 0; }
    .insight-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); }
    .insight-grid h2 { font-size: 15px; margin: 0; }
    .insight-grid p { border-top: 1px solid #edf2ef; color: #40544c; margin: 0; padding-top: 8px; }
    .detail-table { display: grid; overflow: auto; }
    .tr { align-items: center; border-top: 1px solid #edf2ef; display: grid; gap: 10px; grid-template-columns: minmax(180px, 1.4fr) repeat(4, minmax(90px, .8fr)); min-width: 720px; padding: 10px 0; }
    .tr.head { color: #60766d; font-size: 12px; font-weight: 900; text-transform: uppercase; }
    .tr strong { color: #10201a; display: block; }
    .state.error { border-color: #efb7b7; color: #b91c1c; }
    @media (max-width: 1000px) { .perf-detail-header, .score-hero, .breakdown-grid, .insight-grid { grid-template-columns: 1fr 1fr; } .perf-detail-header nav { justify-content: flex-start; } }
    @media (max-width: 640px) { .perf-detail-header, .score-hero, .breakdown-grid, .insight-grid { grid-template-columns: 1fr; } .perf-detail-header h1 { font-size: 22px; } }
  `]
})
export class PerformanceDetailPage implements OnInit {
  readonly detail = signal<StaffOsPerformanceDetailResponse | null>(null);
  readonly loading = signal(false);
  readonly error = signal('');
  readonly intelligence = computed(() => this.detail()?.intelligence || null);
  readonly staffName = computed(() => this.intelligence()?.staffName || this.detail()?.staffId || this.staffId());

  constructor(
    private readonly api: StaffOsApi,
    private readonly route: ActivatedRoute,
    private readonly appState: AppStateService
  ) {}

  ngOnInit(): void {
    this.load();
  }

  staffId(): string {
    return this.route.snapshot.paramMap.get('staffId') || '';
  }

  contextParams(): ApiRecord {
    return {
      branchId: this.route.snapshot.queryParamMap.get('branchId') || this.appState.selectedBranchId(),
      staffId: this.staffId()
    };
  }

  load(): void {
    const staffId = this.staffId();
    if (!staffId) {
      this.error.set('Staff id missing.');
      return;
    }
    this.loading.set(true);
    this.error.set('');
    this.api.performanceByStaff(staffId, this.contextParams())
      .pipe(finalize(() => this.loading.set(false)))
      .subscribe({
        next: (response) => this.detail.set(response),
        error: (error: { error?: { error?: string; message?: string }; message?: string }) => {
          this.error.set(error?.error?.error || error?.error?.message || error?.message || 'Unable to load staff performance detail.');
        }
      });
  }

  rupees(value: unknown): number {
    return Number(value || 0) / 100;
  }

  productRows(row: StaffOsPerformanceIntelligenceRow): ApiRecord[] {
    return (row.productUsage?.products || []) as ApiRecord[];
  }

  serviceRows(row: StaffOsPerformanceIntelligenceRow): ApiRecord[] {
    return (row.serviceTime?.rows || []) as ApiRecord[];
  }

  skillRows(row: StaffOsPerformanceIntelligenceRow): ApiRecord[] {
    return (row.serviceSkills || []) as ApiRecord[];
  }

  referralRows(row: StaffOsPerformanceIntelligenceRow): ApiRecord[] {
    return (row.newReferral?.referrals || []) as ApiRecord[];
  }

  gradeClass(row: StaffOsPerformanceIntelligenceRow): string {
    return `score-hero ${String(row.grade || 'watch').toLowerCase()}`;
  }
}
