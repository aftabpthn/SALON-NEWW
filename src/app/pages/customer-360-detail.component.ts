import { CommonModule } from '@angular/common';
import { Component, OnInit, signal } from '@angular/core';
import { FormsModule, ReactiveFormsModule, UntypedFormBuilder, Validators } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { ApiRecord, ApiService } from '../core/api.service';
import { AuraKpiCardComponent } from '../shared/ui/aura-kpi-card/aura-kpi-card.component';
import { StateComponent } from '../shared/ui/state/state.component';
import { AuraMoneyPipe } from '../shared/pipes/aura-money.pipe';
import { AuraDatePipe } from '../shared/pipes/aura-date.pipe';

@Component({
  selector: 'app-customer-360-detail',
  standalone: true,
  imports: [AuraDatePipe, AuraMoneyPipe, CommonModule, FormsModule, ReactiveFormsModule, RouterLink, StateComponent, AuraKpiCardComponent],
  template: `
    <section class="page-stack inner-page-shell">
      <button class="ghost-button back-button" type="button" routerLink="/customer-360">← Back to Customer Intelligence</button>

      <app-state [loading]="loading()" [error]="error()"></app-state>

      <ng-container *ngIf="profile() as profileData">
        <section class="profile-header inner-page-header">
          <span class="avatar large">{{ profileData.client.name.slice(0, 1) }}</span>
          <div>
            <h2>{{ profileData.client.name }}</h2>
            <p>{{ profileData.client.phone }} · {{ profileData.client.email || 'No email' }}</p>
            <div class="chip-row"><span class="badge" *ngFor="let tag of profileData.client.tags || []">{{ tag }}</span></div>
          </div>
          <div class="profile-stats">
            <span>LTV</span><strong>{{ profileData.metrics.lifetimeValue | auraMoney:'1.0-0' }}</strong>
            <span>Risk</span><strong>{{ profileData.metrics.riskScore }}</strong>
          </div>
        </section>

        <div class="metrics-grid inner-stats-grid">
  <aura-kpi-card tone="neutral" target="/kpi-details/customer-360/last-visit"><span>Last visit</span><strong>{{ profileData.metrics.lastVisit ? (profileData.metrics.lastVisit | auraDate:'date') : 'Never' }}</strong><small>{{ profileData.metrics.inactiveDays }} inactive days</small></aura-kpi-card>
  <aura-kpi-card tone="neutral" target="/kpi-details/customer-360/favorite-service"><span>Favorite service</span><strong>{{ profileData.metrics.favoriteService }}</strong></aura-kpi-card>
  <aura-kpi-card tone="neutral" target="/kpi-details/customer-360/average-spend"><span>Average spend</span><strong>{{ profileData.metrics.averageSpend | auraMoney:'1.0-0' }}</strong><small>{{ profileData.metrics.visitCount }} visits</small></aura-kpi-card>
  <aura-kpi-card tone="neutral" target="/kpi-details/customer-360/preferred-staff"><span>Preferred staff</span><strong>{{ profileData.metrics.preferredStaffName || 'Unknown' }}</strong></aura-kpi-card>
  <aura-kpi-card tone="neutral" target="/kpi-details/customer-360/outstanding"><span>Outstanding</span><strong>{{ profileData.metrics.outstandingBalance | auraMoney:'1.0-0' }}</strong></aura-kpi-card>
  <aura-kpi-card tone="neutral" target="/kpi-details/customer-360/loyalty"><span>Loyalty</span><strong>{{ profileData.metrics.loyaltyPoints }}</strong><small>{{ profileData.metrics.membershipStatus }}</small></aura-kpi-card>

  <aura-kpi-card tone="neutral" target="/kpi-details/customer-360/lifetime-value"><span>Lifetime value</span><strong>{{ profileData.metrics.lifetimeValue | auraMoney:'1.0-0' }}</strong><small>Since {{ profileData.metrics.firstVisitDate | auraDate:'monthYear' }}</small></aura-kpi-card>
  <aura-kpi-card tone="neutral" target="/kpi-details/customer-360/this-month"><span>This month</span><strong>{{ profileData.metrics.monthToDateSpend | auraMoney:'1.0-0' }}</strong><small [class.positive-delta]="spendDelta >= 0" [class.negative-delta]="spendDelta < 0">{{ spendDelta >= 0 ? '▲' : '▼' }} {{ spendDelta | number: '1.0-0' }}% vs last month</small></aura-kpi-card>
  <aura-kpi-card tone="neutral" target="/kpi-details/customer-360/highest-bill"><span>Highest bill</span><strong>{{ profileData.metrics.highestSingleBill | auraMoney:'1.0-0' }}</strong></aura-kpi-card>
  <aura-kpi-card tone="neutral" target="/kpi-details/customer-360/avg-discount"><span>Avg discount</span><strong>{{ profileData.metrics.averageDiscountPercent | number: '1.0-0' }}%</strong></aura-kpi-card>
  <aura-kpi-card tone="neutral" target="/kpi-details/customer-360/product-spend"><span>Product spend</span><strong>{{ profileData.metrics.productSpend | auraMoney:'1.0-0' }}</strong></aura-kpi-card>
  <aura-kpi-card tone="neutral" target="/kpi-details/customer-360/service-spend"><span>Service spend</span><strong>{{ profileData.metrics.serviceSpend | auraMoney:'1.0-0' }}</strong></aura-kpi-card>

  <aura-kpi-card tone="neutral" target="/kpi-details/customer-360/visit-frequency"><span>Visit frequency</span><strong>Every {{ profileData.metrics.visitFrequencyDays }} days</strong></aura-kpi-card>
  <aura-kpi-card tone="neutral" target="/kpi-details/customer-360/no-shows"><span>No-shows</span><strong>{{ profileData.metrics.noShowCount }}</strong></aura-kpi-card>
  <aura-kpi-card tone="neutral" target="/kpi-details/customer-360/cancellations"><span>Cancellations</span><strong>{{ profileData.metrics.cancellationRate | number: '1.0-0' }}%</strong><small>{{ profileData.metrics.cancellationCount }} total cancellations</small></aura-kpi-card>
  <aura-kpi-card tone="neutral" target="/kpi-details/customer-360/visit-type"><span>Visit type</span><strong>{{ (profileData.metrics.walkInCount / (profileData.metrics.bookedCount + profileData.metrics.walkInCount) * 100) | number: '1.0-0' }}%</strong><small>{{ profileData.metrics.bookedCount }} booked · {{ profileData.metrics.walkInCount }} walk-in</small></aura-kpi-card>
  <aura-kpi-card tone="neutral" target="/kpi-details/customer-360/peak-day"><span>Peak day</span><strong>{{ profileData.metrics.peakVisitDay }}</strong><small>{{ profileData.metrics.peakVisitTime }}</small></aura-kpi-card>
  <aura-kpi-card tone="neutral" target="/kpi-details/customer-360/client-since"><span>Client since</span><strong>{{ profileData.metrics.firstVisitDate | auraDate:'monthYear' }}</strong><small>{{ profileData.metrics.visitCount }} total visits</small></aura-kpi-card>

  <aura-kpi-card tone="neutral" target="/kpi-details/customer-360/top-3-services"><span>Top 3 services</span><strong>{{ profileData.metrics.topServices[0] || '—' }}</strong><small>{{ profileData.metrics.topServices[1] || '' }}{{ profileData.metrics.topServices[2] ? ' · ' + profileData.metrics.topServices[2] : '' }}</small></aura-kpi-card>
  <aura-kpi-card tone="neutral" target="/kpi-details/customer-360/never-tried"><span>Never tried ⚡</span><strong>{{ profileData.metrics.untriedServices[0] || 'All tried!' }}</strong><small>{{ profileData.metrics.untriedServices.length > 1 ? (profileData.metrics.untriedServices.length - 1) + ' more upsell opps' : 'Upsell opportunity' }}</small></aura-kpi-card>
  <aura-kpi-card tone="neutral" target="/kpi-details/customer-360/last-product"><span>Last product</span><strong>{{ profileData.metrics.lastProductPurchased || 'None' }}</strong></aura-kpi-card>
  <aura-kpi-card tone="neutral" target="/kpi-details/customer-360/colour-history"><span>Colour history</span><strong>{{ profileData.metrics.colorHistory[0] || 'No colour services' }}</strong><small>{{ profileData.metrics.colorHistory.length > 1 ? profileData.metrics.colorHistory.slice(1, 3).join(' → ') : 'First on record' }}</small></aura-kpi-card>
  <aura-kpi-card tone="neutral" target="/kpi-details/customer-360/allergy-status"><span>Allergy status</span><strong>{{ profileData.metrics.allergyStatus }}</strong><small>Patch: {{ profileData.metrics.patchTestDate ? (profileData.metrics.patchTestDate | auraDate:'date') : 'Never done' }}</small></aura-kpi-card>

  <aura-kpi-card tone="neutral" target="/kpi-details/customer-360/referrals-given"><span>Referrals given</span><strong>{{ profileData.metrics.referralCount }}</strong></aura-kpi-card>
  <aura-kpi-card tone="neutral" target="/kpi-details/customer-360/review-score"><span>Review score</span><strong>{{ profileData.metrics.reviewScore !== null ? (profileData.metrics.reviewScore | number: '1.1-1') + ' ★' : 'No review' }}</strong><small>{{ profileData.metrics.reviewCount }} reviews submitted</small></aura-kpi-card>
  <aura-kpi-card tone="neutral" target="/kpi-details/customer-360/campaign-opens"><span>Campaign opens</span><strong>{{ profileData.metrics.campaignOpenRate | number: '1.0-0' }}%</strong><small>Last: {{ profileData.metrics.lastCampaignOpened || 'None' }}</small></aura-kpi-card>
  <aura-kpi-card tone="neutral" target="/kpi-details/customer-360/birthday"><span>Birthday @if (profileData.metrics.daysUntilBirthday !== null && profileData.metrics.daysUntilBirthday <= 7) {<span class="badge-alert">{{ profileData.metrics.daysUntilBirthday === 0 ? '🎂 Today!' : 'in ' + profileData.metrics.daysUntilBirthday + 'd' }}</span>}</span><strong>{{ profileData.metrics.birthday | auraDate:'date' }}</strong><small>{{ profileData.metrics.anniversary ? 'Anniv: ' + (profileData.metrics.anniversary | auraDate:'date') : 'No anniversary' }}</small></aura-kpi-card>
  <aura-kpi-card tone="neutral" target="/kpi-details/customer-360/prefers"><span>Prefers</span><strong>{{ profileData.metrics.communicationPreference }}</strong></aura-kpi-card>

  <aura-kpi-card tone="neutral" target="/kpi-details/customer-360/churn-risk"><span>Churn risk</span><strong>{{ profileData.metrics.churnRiskScore }}</strong><small><span class="risk-bar"><span class="risk-fill" [style.width.%]="profileData.metrics.churnRiskPercent"></span></span> {{ profileData.metrics.churnRiskPercent }}% score</small></aura-kpi-card>
  <aura-kpi-card tone="neutral" target="/kpi-details/customer-360/sentiment"><span>Sentiment</span><strong>{{ profileData.metrics.sentimentScore }}/100</strong><small>{{ profileData.metrics.sentimentScore >= 80 ? '😊 Positive' : profileData.metrics.sentimentScore >= 50 ? '😐 Neutral' : '😟 Negative' }}</small></aura-kpi-card>
  <aura-kpi-card tone="neutral" target="/kpi-details/customer-360/complaints"><span>Complaints</span><strong>{{ profileData.metrics.complaintCount }}</strong><small>{{ profileData.metrics.lastComplaintDate ? 'Last: ' + (profileData.metrics.lastComplaintDate | auraDate:'date') : 'No complaints' }}</small></aura-kpi-card>
  <aura-kpi-card tone="neutral" target="/kpi-details/customer-360/client-status"><span>Client status</span><strong>{{ profileData.metrics.winBackStatus }}</strong></aura-kpi-card>

  @if (profileData.metrics.aiInsightSummary) {
    <aura-kpi-card tone="neutral" target="/kpi-details/customer-360/ai-insight"><span>✨ AI Insight</span><strong class="ai-insight-text">{{ profileData.metrics.aiInsightSummary }}</strong></aura-kpi-card>
  }
</div>

        <div class="dashboard-grid">
          <section class="panel inner-page-card">
            <div class="section-title"><h2>AI next-best-action</h2></div>
            <article class="action-card">
              <strong>{{ profileData.nextBestAction.action }}</strong>
              <span>{{ profileData.nextBestAction.reason }} · {{ profileData.nextBestAction.channel }} · {{ profileData.nextBestAction.priority }}</span>
            </article>
            <div class="quick-grid">
              <article class="action-card" *ngFor="let insight of profileData.insights"><strong>{{ insight }}</strong><span>Customer insight</span></article>
            </div>
          </section>

          <section class="panel">
            <div class="section-title"><h2>Wallet, membership and loyalty</h2></div>
            <div class="quick-grid">
              <article class="action-card">
                <strong>{{ (profileData.wallet?.balance || 0) | auraMoney:'1.0-0' }}</strong>
                <span>Wallet balance · latest {{ profileData.wallet?.latestWalletTransaction?.type || 'none' }}</span>
              </article>
              <article class="action-card">
                <strong>{{ profileData.wallet?.loyaltyBalance || 0 }}</strong>
                <span>Loyalty points · latest {{ profileData.wallet?.latestLoyaltyTransaction?.type || 'none' }}</span>
              </article>
              <article class="action-card">
                <strong>{{ profileData.membershipSummary?.status || 'none' }}</strong>
                <span>{{ profileData.membershipSummary?.activeMembership?.planName || profileData.membershipSummary?.activeMembership?.name || 'No active plan' }}</span>
              </article>
            </div>
          </section>
        </div>

        <div class="dashboard-grid">
          <section class="panel">
            <div class="section-title"><h2>Visit history</h2></div>
            <div class="table-wrap">
              <table>
                <thead><tr><th>Date</th><th>Status</th><th>Services</th><th>Amount</th><th>Balance</th></tr></thead>
                <tbody>
                  <tr *ngFor="let visit of profileData.visitHistory || []">
                    <td>{{ visit.startAt | auraDate:'date' }}</td>
                    <td>{{ visit.status }}</td>
                    <td>{{ (visit.services || []).join(', ') || 'No service linked' }}</td>
                    <td>{{ visit.amount | auraMoney:'1.0-0' }}</td>
                    <td>{{ visit.balance | auraMoney:'1.0-0' }}</td>
                  </tr>
                  <tr *ngIf="!(profileData.visitHistory || []).length"><td colspan="5"><div class="empty-state"><strong>No visit history</strong><span>Completed appointments and invoices will appear here.</span></div></td></tr>
                </tbody>
              </table>
            </div>
          </section>

          <section class="panel">
            <div class="section-title"><h2>Review linkage</h2></div>
            <article class="action-card">
              <strong>{{ profileData.reviewLinkage?.averageRating !== null ? (profileData.reviewLinkage?.averageRating | number: '1.1-1') + ' / 5' : 'No reviews' }}</strong>
              <span>{{ profileData.reviewLinkage?.reviewCount || 0 }} reviews · {{ profileData.reviewLinkage?.negativeCount || 0 }} recovery signals</span>
            </article>
            <div class="rank-list">
              <article *ngFor="let review of profileData.reviewLinkage?.reviews || []">
                <div><strong>{{ review.platformName }} · {{ review.rating }}/5</strong><span>{{ review.reviewText || review.title || 'No text captured' }}</span></div>
                <small>{{ review.reviewedAt | auraDate:'date' }}</small>
              </article>
              <article *ngIf="!(profileData.reviewLinkage?.reviews || []).length"><div><strong>No linked reviews</strong><span>Invoice review links and platform sync reviews will connect here.</span></div></article>
            </div>
          </section>
        </div>

        <div class="dashboard-grid">
          <section class="panel">
            <div class="section-title"><h2>Notes timeline</h2></div>
            <div class="rank-list">
              <article *ngFor="let item of profileData.timeline">
                <div><strong>{{ item.title }}</strong><span>{{ item.type }} · {{ item.body }}</span></div>
                <small>{{ item.createdAt | auraDate:'date' }}</small>
              </article>
              <article *ngIf="!profileData.timeline.length"><div><strong>No timeline yet</strong><span>Add a note or complete a booking.</span></div></article>
            </div>

            <form [formGroup]="noteForm" (ngSubmit)="addNote()" class="timeline-form">
              <label class="field"><span>Title</span><input formControlName="title" /></label>
              <label class="field"><span>Type</span><select formControlName="type"><option value="note">Note</option><option value="preference">Preference</option><option value="follow-up">Follow-up</option></select></label>
              <label class="field full"><span>Body</span><textarea formControlName="body"></textarea></label>
              <div class="form-actions">
                <button class="primary-button mini" type="submit" [disabled]="noteForm.invalid">Add note</button>
              </div>
            </form>
          </section>
        </div>
      </ng-container>

      <pre class="result-json" *ngIf="result()">{{ result() | json }}</pre>
    </section>
  `,
  styles: [`
    .page-stack { display: grid; gap: 16px; padding-block: 16px; }
    .back-button { justify-self: start; }
    .profile-header { display: flex; align-items: center; gap: 16px; padding: 16px; border: 1px solid var(--line); border-radius: 12px; background: var(--surface); }
    .profile-header .avatar { width: 48px; height: 48px; display: grid; place-items: center; border-radius: 999px; background: #4B1238; color: #fff; font-size: 20px; font-weight: 800; }
    .profile-header h2 { margin: 0; }
    .profile-header p { margin: 2px 0 0; color: var(--muted); font-size: 13px; }
    .profile-stats { margin-left: auto; display: flex; gap: 16px; align-items: center; }
    .profile-stats span { color: var(--muted); font-size: 12px; display: block; }
    .profile-stats strong { font-size: 18px; }
    .chip-row { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 6px; }
    .chip-row .badge { font-size: 11px; padding: 2px 8px; border-radius: 999px; background: #4B1238; color: #fff; }
    .metrics-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
      gap: 16px;
      --kpi-min-height: 120px;
      --kpi-gap: 10px;
      --kpi-padding: 18px 20px 16px;
      --kpi-strong-size: 18px;
      --kpi-small-size: 13px;
    }
    :host ::ng-deep .metrics-grid aura-kpi-card .metric-card {
      min-height: 120px;
      border-radius: 18px;
    }
    .dashboard-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(min(480px, 100%), 1fr)); gap: 14px; }
    .dashboard-grid .panel { border: 1px solid var(--line); border-radius: 12px; padding: 16px; background: var(--surface); }
    .dashboard-grid .section-title { border-bottom: 1px solid var(--line); padding-bottom: 6px; margin-bottom: 8px; }
    .dashboard-grid .section-title h2 { font-size: 15px; margin: 0; }
    .table-wrap { border-radius: 8px; overflow-x: auto; }
    table { width: 100%; border-collapse: collapse; }
    th, td { text-align: left; padding: 8px 10px; border-bottom: 1px solid var(--line); font-size: 13px; }
    th { font-weight: 750; color: var(--muted); font-size: 11px; text-transform: uppercase; }
    .action-card { padding: 12px; border: 1px solid var(--line); border-radius: 10px; }
    .action-card strong { display: block; font-size: 14px; }
    .action-card span { font-size: 12px; color: var(--muted); }
    .quick-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 8px; }
    .rank-list { display: grid; gap: 6px; }
    .rank-list article { display: flex; justify-content: space-between; align-items: center; padding: 8px 10px; border: 1px solid var(--line); border-radius: 8px; }
    .rank-list article strong { font-size: 13px; display: block; }
    .rank-list article span { font-size: 12px; color: var(--muted); }
    .rank-list article small { color: var(--muted); font-size: 11px; flex-shrink: 0; }
    .empty-state { text-align: center; padding: 24px; }
    .empty-state strong { display: block; font-size: 14px; }
    .empty-state span { font-size: 13px; color: var(--muted); }
    .positive-delta { color: #4B1238; }
    .negative-delta { color: #e6674f; }
    .risk-bar { display: inline-block; width: 50px; height: 4px; border-radius: 999px; background: var(--line); vertical-align: middle; }
    .risk-fill { display: block; height: 100%; border-radius: 999px; background: currentColor; }
    .badge-alert { display: inline-block; font-size: 10px; padding: 1px 6px; border-radius: 999px; background: #e6674f; color: #fff; margin-left: 4px; vertical-align: middle; }
    .ai-insight-text { font-weight: 400 !important; font-size: 13px !important; line-height: 1.5; }
    .timeline-form { margin-top: 12px; display: grid; gap: 8px; padding-top: 12px; border-top: 1px solid var(--line); }
    .field { display: grid; gap: 4px; }
    .field.full { grid-column: 1 / -1; }
    .field span { font-size: 11px; font-weight: 750; color: var(--muted); }
    .field input, .field select, .field textarea { padding: 6px 8px; border: 1px solid var(--line); border-radius: 8px; font: inherit; font-size: 13px; }
    .field textarea { min-height: 60px; resize: vertical; }
    .form-actions { display: flex; gap: 8px; justify-content: flex-end; }
    .result-json { font-size: 11px; opacity: 0.6; max-height: 200px; overflow: auto; }

    @media (max-width: 900px) {
      .metrics-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
    }
    @media (max-width: 520px) {
      .metrics-grid { grid-template-columns: 1fr; gap: 10px; }
    }
  `]
})
export class Customer360DetailComponent implements OnInit {
  readonly profile = signal<ApiRecord | null>(null);
  readonly result = signal<ApiRecord | null>(null);
  readonly loading = signal(true);
  readonly error = signal('');

  readonly noteForm = this.fb.group({
    title: ['Consultation note', Validators.required],
    type: ['note'],
    body: ['Prefers WhatsApp follow-up and evening appointments.', Validators.required]
  });

  constructor(
    private readonly api: ApiService,
    private readonly fb: UntypedFormBuilder,
    private readonly route: ActivatedRoute
  ) {}

  get spendDelta(): number {
    const metrics = this.profile()?.metrics || {};
    const current = Number(metrics.monthToDateSpend || 0);
    const previous = Number(metrics.previousMonthSpend || metrics.lastMonthSpend || 0);
    if (!previous) return current > 0 ? 100 : 0;
    return ((current - previous) / previous) * 100;
  }

  ngOnInit(): void {
    const customerId = this.route.snapshot.paramMap.get('customerId');
    if (customerId) this.loadProfile(customerId);
  }

  private loadProfile(customerId: string): void {
    this.loading.set(true);
    this.error.set('');
    this.api.list<ApiRecord>(`customer-360/clients/${customerId}`).subscribe({
      next: (profile) => {
        this.profile.set(profile);
        this.loading.set(false);
      },
      error: (error) => {
        this.error.set(error?.error?.error || 'Unable to load customer profile');
        this.loading.set(false);
      }
    });
  }

  addNote(): void {
    const clientId = this.profile()?.client?.id;
    if (!clientId) return;
    this.api.post<ApiRecord>(`customer-360/clients/${clientId}/timeline`, this.noteForm.value).subscribe((response) => {
      this.result.set(response);
      this.loadProfile(clientId);
    });
  }
}
