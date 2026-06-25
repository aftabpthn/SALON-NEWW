import { CommonModule, CurrencyPipe, DatePipe } from '@angular/common';
import { Component, OnInit, signal } from '@angular/core';
import { FormsModule, ReactiveFormsModule, UntypedFormBuilder, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ApiRecord, ApiService } from '../core/api.service';
import { StateComponent } from '../shared/ui/state/state.component';
import { AuraKpiCardComponent } from '../shared/ui/aura-kpi-card/aura-kpi-card.component';

@Component({
  selector: 'app-customer-360',
  standalone: true,
  imports: [CommonModule, FormsModule, ReactiveFormsModule, RouterLink, CurrencyPipe, DatePipe, StateComponent, AuraKpiCardComponent],
  template: `
    <section class="page-stack">
      <div class="module-hero">
        <div>
          <span class="eyebrow">Level 21 · Customer 360</span>
          <h2>Lifetime value, visit behavior, preferences, risk score, timeline and AI next-best-action</h2>
          <p>Customer intelligence calculates from saved clients, appointments, sales, invoices, memberships and timeline notes.</p>
        </div>
        <button class="ghost-button" type="button" (click)="load()">Refresh</button>
      </div>

      <app-state [loading]="loading()" [error]="error()"></app-state>

      <div class="metrics-grid" *ngIf="summary()?.metrics as metrics">
        <aura-kpi-card tone="teal" target="/kpi-details/customer-360/clients"><span>Clients</span><strong>{{ metrics.clients }}</strong><small>Customer base</small></aura-kpi-card>
        <aura-kpi-card tone="blue" target="/kpi-details/customer-360/total-ltv"><span>Total LTV</span><strong>{{ metrics.totalLtv | currency: 'INR':'symbol':'1.0-0' }}</strong><small>Saved value</small></aura-kpi-card>
        <aura-kpi-card tone="green" target="/kpi-details/customer-360/avg-spend"><span>Avg spend</span><strong>{{ metrics.avgSpend | currency: 'INR':'symbol':'1.0-0' }}</strong><small>Per profile</small></aura-kpi-card>
        <aura-kpi-card tone="red" target="/kpi-details/customer-360/high-risk"><span>High risk</span><strong>{{ metrics.highRisk }}</strong><small>Needs action</small></aura-kpi-card>
      </div>

      <div class="dashboard-grid">
        <section class="panel">
          <div class="section-title"><h2>Customer intelligence list</h2></div>
          <div class="table-wrap">
            <table>
              <thead><tr><th>Client</th><th>LTV</th><th>Favorite</th><th>Risk</th><th>Next action</th><th></th></tr></thead>
              <tbody>
                <tr *ngFor="let profile of summary()?.profiles || []">
                  <td><strong>{{ profile.client.name }}</strong><small>{{ profile.client.phone }}</small></td>
                  <td>{{ profile.metrics.lifetimeValue | currency: 'INR':'symbol':'1.0-0' }}</td>
                  <td>{{ profile.metrics.favoriteService }}</td>
                  <td>{{ profile.metrics.riskScore }}</td>
                  <td>{{ profile.nextBestAction.action }}</td>
                  <td><button class="ghost-button mini" type="button" (click)="select(profile.client.id)">Open</button></td>
                </tr>
                <tr *ngIf="!(summary()?.profiles || []).length"><td colspan="6"><div class="empty-state"><strong>No clients found</strong><span>Create a client or booking to generate customer intelligence.</span></div></td></tr>
              </tbody>
            </table>
          </div>
        </section>

        <section class="form-panel">
          <h3>Notes timeline</h3>
          <form [formGroup]="noteForm" (ngSubmit)="addNote()">
            <label class="field"><span>Title</span><input formControlName="title" /></label>
            <label class="field"><span>Type</span><select formControlName="type"><option value="note">Note</option><option value="preference">Preference</option><option value="follow-up">Follow-up</option></select></label>
            <label class="field full"><span>Body</span><textarea formControlName="body"></textarea></label>
            <div class="form-actions">
              <button class="ghost-button" type="button" (click)="snapshot()" [disabled]="!profile()">Generate snapshot</button>
              <button class="primary-button" type="submit" [disabled]="!profile() || noteForm.invalid">Add note</button>
            </div>
          </form>
        </section>
      </div>

      <ng-container *ngIf="profile() as profileData">
        <section class="profile-header">
          <span class="avatar large">{{ profileData.client.name.slice(0, 1) }}</span>
          <div>
            <span class="eyebrow">Selected customer</span>
            <h2>{{ profileData.client.name }}</h2>
            <p>{{ profileData.client.phone }} · {{ profileData.client.email || 'No email' }}</p>
            <div class="chip-row"><span class="badge" *ngFor="let tag of profileData.client.tags || []">{{ tag }}</span></div>
          </div>
          <div class="profile-stats">
            <span>LTV</span><strong>{{ profileData.metrics.lifetimeValue | currency: 'INR':'symbol':'1.0-0' }}</strong>
            <span>Risk</span><strong>{{ profileData.metrics.riskScore }}</strong>
            <a class="ghost-button mini" [routerLink]="['/clients', profileData.client.id]">Open Client 360 profile</a>
          </div>
        </section>

        <div class="metrics-grid">
  <aura-kpi-card tone="teal" target="/kpi-details/customer-360/last-visit"><span>Last visit</span><strong>{{ profileData.metrics.lastVisit ? (profileData.metrics.lastVisit | date: 'mediumDate') : 'Never' }}</strong><small>{{ profileData.metrics.inactiveDays }} inactive days</small></aura-kpi-card>
  <aura-kpi-card tone="blue" target="/kpi-details/customer-360/favorite-service"><span>Favorite service</span><strong>{{ profileData.metrics.favoriteService }}</strong><small>From visits and sales</small></aura-kpi-card>
  <aura-kpi-card tone="green" target="/kpi-details/customer-360/average-spend"><span>Average spend</span><strong>{{ profileData.metrics.averageSpend | currency: 'INR':'symbol':'1.0-0' }}</strong><small>{{ profileData.metrics.visitCount }} visits</small></aura-kpi-card>
  <aura-kpi-card tone="amber" target="/kpi-details/customer-360/preferred-staff"><span>Preferred staff</span><strong>{{ profileData.metrics.preferredStaffName || 'Unknown' }}</strong><small>Behavioral preference</small></aura-kpi-card>
  <aura-kpi-card tone="red" target="/kpi-details/customer-360/outstanding"><span>Outstanding</span><strong>{{ profileData.metrics.outstandingBalance | currency: 'INR':'symbol':'1.0-0' }}</strong><small>Open balance</small></aura-kpi-card>
  <aura-kpi-card tone="violet" target="/kpi-details/customer-360/loyalty"><span>Loyalty</span><strong>{{ profileData.metrics.loyaltyPoints }}</strong><small>{{ profileData.metrics.membershipStatus }}</small></aura-kpi-card>

  <aura-kpi-card tone="gold" target="/kpi-details/customer-360/lifetime-value"><span>Lifetime value</span><strong>{{ profileData.metrics.lifetimeValue | currency: 'INR':'symbol':'1.0-0' }}</strong><small>Since {{ profileData.metrics.firstVisitDate | date: 'MMM yyyy' }}</small></aura-kpi-card>
  <aura-kpi-card tone="emerald" target="/kpi-details/customer-360/this-month"><span>This month</span><strong>{{ profileData.metrics.monthToDateSpend | currency: 'INR':'symbol':'1.0-0' }}</strong><small [class.positive-delta]="spendDelta >= 0" [class.negative-delta]="spendDelta < 0">{{ spendDelta >= 0 ? '▲' : '▼' }} {{ spendDelta | number: '1.0-0' }}% vs last month</small></aura-kpi-card>
  <aura-kpi-card tone="indigo" target="/kpi-details/customer-360/highest-bill"><span>Highest bill</span><strong>{{ profileData.metrics.highestSingleBill | currency: 'INR':'symbol':'1.0-0' }}</strong><small>Peak single transaction</small></aura-kpi-card>
  <aura-kpi-card tone="orange" target="/kpi-details/customer-360/avg-discount"><span>Avg discount</span><strong>{{ profileData.metrics.averageDiscountPercent | number: '1.0-0' }}%</strong><small>Across all bills</small></aura-kpi-card>
  <aura-kpi-card tone="cyan" target="/kpi-details/customer-360/product-spend"><span>Product spend</span><strong>{{ profileData.metrics.productSpend | currency: 'INR':'symbol':'1.0-0' }}</strong><small>Retail purchases total</small></aura-kpi-card>
  <aura-kpi-card tone="pink" target="/kpi-details/customer-360/service-spend"><span>Service spend</span><strong>{{ profileData.metrics.serviceSpend | currency: 'INR':'symbol':'1.0-0' }}</strong><small>Services only total</small></aura-kpi-card>

  <aura-kpi-card tone="teal" target="/kpi-details/customer-360/visit-frequency"><span>Visit frequency</span><strong>Every {{ profileData.metrics.visitFrequencyDays }} days</strong><small>Avg gap between visits</small></aura-kpi-card>
  <aura-kpi-card tone="red" target="/kpi-details/customer-360/no-shows"><span>No-shows</span><strong>{{ profileData.metrics.noShowCount }}</strong><small>Appointments missed</small></aura-kpi-card>
  <aura-kpi-card tone="amber" target="/kpi-details/customer-360/cancellations"><span>Cancellations</span><strong>{{ profileData.metrics.cancellationRate | number: '1.0-0' }}%</strong><small>{{ profileData.metrics.cancellationCount }} total cancellations</small></aura-kpi-card>
  <aura-kpi-card tone="blue" target="/kpi-details/customer-360/visit-type"><span>Visit type</span><strong>{{ (profileData.metrics.walkInCount / (profileData.metrics.bookedCount + profileData.metrics.walkInCount) * 100) | number: '1.0-0' }}%</strong><small>{{ profileData.metrics.bookedCount }} booked · {{ profileData.metrics.walkInCount }} walk-in</small></aura-kpi-card>
  <aura-kpi-card tone="violet" target="/kpi-details/customer-360/peak-day"><span>Peak day</span><strong>{{ profileData.metrics.peakVisitDay }}</strong><small>{{ profileData.metrics.peakVisitTime }}</small></aura-kpi-card>
  <aura-kpi-card tone="green" target="/kpi-details/customer-360/client-since"><span>Client since</span><strong>{{ profileData.metrics.firstVisitDate | date: 'MMM yyyy' }}</strong><small>{{ profileData.metrics.visitCount }} total visits</small></aura-kpi-card>

  <aura-kpi-card tone="blue" target="/kpi-details/customer-360/top-3-services"><span>Top 3 services</span><strong>{{ profileData.metrics.topServices[0] || '—' }}</strong><small>{{ profileData.metrics.topServices[1] || '' }}{{ profileData.metrics.topServices[2] ? ' · ' + profileData.metrics.topServices[2] : '' }}</small></aura-kpi-card>
  <aura-kpi-card tone="orange" target="/kpi-details/customer-360/never-tried"><span>Never tried ⚡</span><strong>{{ profileData.metrics.untriedServices[0] || 'All tried!' }}</strong><small>{{ profileData.metrics.untriedServices.length > 1 ? (profileData.metrics.untriedServices.length - 1) + ' more upsell opps' : 'Upsell opportunity' }}</small></aura-kpi-card>
  <aura-kpi-card tone="pink" target="/kpi-details/customer-360/last-product"><span>Last product</span><strong>{{ profileData.metrics.lastProductPurchased || 'None' }}</strong><small>Retail cross-sell</small></aura-kpi-card>
  <aura-kpi-card tone="violet" target="/kpi-details/customer-360/colour-history"><span>Colour history</span><strong>{{ profileData.metrics.colorHistory[0] || 'No colour services' }}</strong><small>{{ profileData.metrics.colorHistory.length > 1 ? profileData.metrics.colorHistory.slice(1, 3).join(' → ') : 'First on record' }}</small></aura-kpi-card>
  <aura-kpi-card [tone]="{ 'green': profileData.metrics.allergyStatus === 'Clear', 'red': profileData.metrics.allergyStatus === 'Flagged', 'amber': profileData.metrics.allergyStatus === 'Not Tested' }" target="/kpi-details/customer-360/allergy-status"><span>Allergy status</span><strong>{{ profileData.metrics.allergyStatus }}</strong><small>Patch: {{ profileData.metrics.patchTestDate ? (profileData.metrics.patchTestDate | date: 'mediumDate') : 'Never done' }}</small></aura-kpi-card>

  <aura-kpi-card tone="green" target="/kpi-details/customer-360/referrals-given"><span>Referrals given</span><strong>{{ profileData.metrics.referralCount }}</strong><small>Friends referred</small></aura-kpi-card>
  <aura-kpi-card tone="gold" target="/kpi-details/customer-360/review-score"><span>Review score</span><strong>{{ profileData.metrics.reviewScore !== null ? (profileData.metrics.reviewScore | number: '1.1-1') + ' ★' : 'No review' }}</strong><small>{{ profileData.metrics.reviewCount }} reviews submitted</small></aura-kpi-card>
  <aura-kpi-card tone="cyan" target="/kpi-details/customer-360/campaign-opens"><span>Campaign opens</span><strong>{{ profileData.metrics.campaignOpenRate | number: '1.0-0' }}%</strong><small>Last: {{ profileData.metrics.lastCampaignOpened || 'None' }}</small></aura-kpi-card>
  <aura-kpi-card tone="pink" target="/kpi-details/customer-360/birthday"><span>Birthday @if (profileData.metrics.daysUntilBirthday !== null && profileData.metrics.daysUntilBirthday <= 7) {<span class="badge-alert">{{ profileData.metrics.daysUntilBirthday === 0 ? '🎂 Today!' : 'in ' + profileData.metrics.daysUntilBirthday + 'd' }}</span>}</span><strong>{{ profileData.metrics.birthday | date: 'd MMM' }}</strong><small>{{ profileData.metrics.anniversary ? 'Anniv: ' + (profileData.metrics.anniversary | date: 'd MMM') : 'No anniversary' }}</small></aura-kpi-card>
  <aura-kpi-card tone="indigo" target="/kpi-details/customer-360/prefers"><span>Prefers</span><strong>{{ profileData.metrics.communicationPreference }}</strong><small>Communication channel</small></aura-kpi-card>

  <aura-kpi-card [tone]="{ 'green': profileData.metrics.churnRiskScore === 'Low', 'amber': profileData.metrics.churnRiskScore === 'Medium', 'red': profileData.metrics.churnRiskScore === 'High' || profileData.metrics.churnRiskScore === 'Critical' }" target="/kpi-details/customer-360/churn-risk"><span>Churn risk</span><strong>{{ profileData.metrics.churnRiskScore }}</strong><small><span class="risk-bar"><span class="risk-fill" [style.width.%]="profileData.metrics.churnRiskPercent"></span></span> {{ profileData.metrics.churnRiskPercent }}% score</small></aura-kpi-card>
  <aura-kpi-card tone="blue" target="/kpi-details/customer-360/sentiment"><span>Sentiment</span><strong>{{ profileData.metrics.sentimentScore }}/100</strong><small>{{ profileData.metrics.sentimentScore >= 80 ? '😊 Positive' : profileData.metrics.sentimentScore >= 50 ? '😐 Neutral' : '😟 Negative' }}</small></aura-kpi-card>
  <aura-kpi-card tone="red" target="/kpi-details/customer-360/complaints"><span>Complaints</span><strong>{{ profileData.metrics.complaintCount }}</strong><small>{{ profileData.metrics.lastComplaintDate ? 'Last: ' + (profileData.metrics.lastComplaintDate | date: 'mediumDate') : 'No complaints' }}</small></aura-kpi-card>
  <aura-kpi-card [tone]="{ 'green': profileData.metrics.winBackStatus === 'Active', 'teal': profileData.metrics.winBackStatus === 'Recovering', 'amber': profileData.metrics.winBackStatus === 'Lapsed', 'red': profileData.metrics.winBackStatus === 'Churned' }" target="/kpi-details/customer-360/client-status"><span>Client status</span><strong>{{ profileData.metrics.winBackStatus }}</strong><small>Win-back flag</small></aura-kpi-card>

  @if (profileData.metrics.aiInsightSummary) {
    <aura-kpi-card tone="metric-card--ai-insight" target="/kpi-details/customer-360/ai-insight"><span>✨ AI Insight</span><strong class="ai-insight-text">{{ profileData.metrics.aiInsightSummary }}</strong><small>Generated from visit + spend + behaviour data</small></aura-kpi-card>
  }
</div>

        <div class="dashboard-grid">
          <section class="panel">
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
                <strong>{{ (profileData.wallet?.balance || 0) | currency: 'INR':'symbol':'1.0-0' }}</strong>
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
                    <td>{{ visit.startAt | date: 'mediumDate' }}</td>
                    <td>{{ visit.status }}</td>
                    <td>{{ (visit.services || []).join(', ') || 'No service linked' }}</td>
                    <td>{{ visit.amount | currency: 'INR':'symbol':'1.0-0' }}</td>
                    <td>{{ visit.balance | currency: 'INR':'symbol':'1.0-0' }}</td>
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
                <small>{{ review.reviewedAt | date: 'short' }}</small>
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
                <small>{{ item.createdAt | date: 'short' }}</small>
              </article>
              <article *ngIf="!profileData.timeline.length"><div><strong>No timeline yet</strong><span>Add a note or complete a booking.</span></div></article>
            </div>
          </section>
        </div>
      </ng-container>

      <pre class="result-json" *ngIf="result()">{{ result() | json }}</pre>
    </section>
  `,
  styles: [`
    .dashboard-grid > :only-child { grid-column: 1 / -1; }
    .page-stack { display: grid; gap: 16px; padding-block: 16px; }
    .module-hero { border-radius: 12px; padding: 16px 20px; min-height: auto; }
    .module-hero h2 { font-size: 22px; line-height: 1.15; }
    .module-hero p { font-size: 13px; margin-top: 4px; }
    .dashboard-grid { gap: 14px; }
    .dashboard-grid .panel, .dashboard-grid .form-panel { border-radius: 12px; padding: 16px; }
    .dashboard-grid .section-title { padding-bottom: 6px; margin-bottom: 8px; }
    .dashboard-grid .section-title h2 { font-size: 15px; }
    .table-wrap { border-radius: 8px; }
    .form-panel h3 { font-size: 15px; margin: 0 0 12px; }
  `]
})
export class Customer360Component implements OnInit {
  readonly summary = signal<ApiRecord | null>(null);
  readonly profile = signal<ApiRecord | null>(null);
  readonly result = signal<ApiRecord | null>(null);
  readonly loading = signal(false);
  readonly error = signal('');

  readonly noteForm = this.fb.group({
    title: ['Consultation note', Validators.required],
    type: ['note'],
    body: ['Prefers WhatsApp follow-up and evening appointments.', Validators.required]
  });

  constructor(private readonly api: ApiService, private readonly fb: UntypedFormBuilder) {}

  get spendDelta(): number {
    const metrics = this.profile()?.metrics || {};
    const current = Number(metrics.monthToDateSpend || 0);
    const previous = Number(metrics.previousMonthSpend || metrics.lastMonthSpend || 0);
    if (!previous) return current > 0 ? 100 : 0;
    return ((current - previous) / previous) * 100;
  }

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.api.list<ApiRecord>('customer-360/summary').subscribe({
      next: (summary) => {
        this.summary.set(summary);
        if (!this.profile() && summary.profiles?.[0]) this.select(summary.profiles[0].client.id);
        this.loading.set(false);
      },
      error: (error) => {
        this.error.set(error?.error?.error || 'Unable to load customer 360');
        this.loading.set(false);
      }
    });
  }

  select(clientId: string): void {
    this.api.list<ApiRecord>(`customer-360/clients/${clientId}`).subscribe((profile) => this.profile.set(profile));
  }

  addNote(): void {
    const clientId = this.profile()?.client?.id;
    if (!clientId) return;
    this.api.post<ApiRecord>(`customer-360/clients/${clientId}/timeline`, this.noteForm.value).subscribe((response) => {
      this.result.set(response);
      this.select(clientId);
    });
  }

  snapshot(): void {
    const clientId = this.profile()?.client?.id;
    if (!clientId) return;
    this.api.post<ApiRecord>(`customer-360/clients/${clientId}/snapshot`, {}).subscribe((response) => {
      this.result.set(response);
      this.load();
    });
  }
}
