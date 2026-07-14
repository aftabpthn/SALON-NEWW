import { CommonModule } from '@angular/common';
import { Component, OnDestroy, OnInit, signal } from '@angular/core';
import { FormsModule, ReactiveFormsModule, UntypedFormBuilder, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ApiRecord, ApiService } from '../core/api.service';
import { StateComponent } from '../shared/ui/state/state.component';
import { AuraKpiCardComponent } from '../shared/ui/aura-kpi-card/aura-kpi-card.component';
import { AuraMoneyPipe } from '../shared/pipes/aura-money.pipe';
import { AuraDatePipe } from '../shared/pipes/aura-date.pipe';

@Component({
  selector: 'app-customer-360',
  standalone: true,
  imports: [AuraDatePipe, AuraMoneyPipe, CommonModule, FormsModule, ReactiveFormsModule, RouterLink, StateComponent, AuraKpiCardComponent],
  template: `
    <section class="page-stack inner-page-shell">
      <div class="module-hero inner-page-header">
        <div>
          <h2>Lifetime value, visit behavior, preferences, risk score, timeline and AI next-best-action</h2>
        </div>
        <div class="customer-360-hero-actions">
          <button class="ghost-button" type="button" (click)="loadDuplicateGroups()" [disabled]="duplicateLoading()">{{ duplicateLoading() ? 'Scanning...' : 'Find duplicates' }}</button>
          <button class="ghost-button" type="button" (click)="load()">Refresh</button>
        </div>
      </div>

      <app-state [loading]="loading()" [error]="error()"></app-state>

      <section class="duplicate-merge-panel" *ngIf="duplicateLoading() || duplicateError() || duplicateMessage() || duplicateGroups().length">
        <div class="duplicate-panel-header">
          <div>
            <h3>Duplicate contacts</h3>
            <p>{{ duplicateGroups().length }} same-number group(s). Same email is allowed; same phone number should be merged.</p>
          </div>
          <div class="duplicate-panel-actions">
            <button class="primary-button mini" type="button" *ngIf="phoneDuplicateGroupCount()" (click)="mergeAllDuplicateGroups()" [disabled]="duplicateMergeAllLoading() || duplicateSaving()">{{ duplicateMergeAllLoading() ? 'Merging...' : 'Merge phone groups' }}</button>
            <button class="ghost-button mini" type="button" (click)="loadDuplicateGroups()" [disabled]="duplicateLoading()">Scan again</button>
          </div>
        </div>
        <app-state [loading]="duplicateLoading()" [error]="duplicateError()"></app-state>
        <p class="duplicate-message" *ngIf="duplicateMessage()">{{ duplicateMessage() }}</p>
        <p class="duplicate-message" *ngIf="duplicateGroups().length > visibleDuplicateGroups().length">Showing first {{ visibleDuplicateGroups().length }} groups. Merge phone groups only processes exact-phone groups.</p>
        <div class="duplicate-group-list" *ngIf="!duplicateLoading() && duplicateGroups().length">
          <article class="duplicate-group" *ngFor="let group of visibleDuplicateGroups()" [class.active]="activeDuplicateGroupKey() === group.groupKey">
            <div class="duplicate-group-header">
              <div>
                <strong>{{ group.matchLabel }}</strong>
                <small>{{ duplicateMatchValues(group) }}</small>
              </div>
              <button class="primary-button mini" type="button" (click)="mergeDuplicateGroup(group, $event)" [disabled]="duplicateSaving() || duplicateMergeAllLoading() || duplicateGroupClients(group).length < 2">Merge into selected</button>
            </div>
            <div class="duplicate-client-options">
              <button
                class="duplicate-client-option"
                type="button"
                *ngFor="let duplicateClient of duplicateGroupClients(group)"
                [class.primary]="duplicateGroupPrimaryId(group) === clientId(duplicateClient)"
                (click)="setDuplicatePrimary(group, clientId(duplicateClient), $event)"
              >
                <span class="avatar">{{ clientInitial(duplicateClient) }}</span>
                <span>
                  <strong>{{ clientName(duplicateClient) }}</strong>
                  <small>{{ clientContactLine(duplicateClient) }}</small>
                  <small>{{ duplicateClient.visitCount || 0 }} visits · {{ (duplicateClient.totalSpend || 0) | auraMoney:'1.0-0' }}</small>
                </span>
                <em>{{ duplicateGroupPrimaryId(group) === clientId(duplicateClient) ? 'Keep' : 'Merge' }}</em>
              </button>
            </div>
          </article>
        </div>
      </section>

      <div class="metrics-grid inner-stats-grid" *ngIf="summary()?.metrics as metrics">
        <aura-kpi-card tone="neutral" target="/kpi-details/customer-360/clients"><span>Clients</span><strong>{{ metrics.clients }}</strong></aura-kpi-card>
        <aura-kpi-card tone="neutral" target="/kpi-details/customer-360/total-ltv"><span>Total LTV</span><strong>{{ metrics.totalLtv | auraMoney:'1.0-0' }}</strong></aura-kpi-card>
        <aura-kpi-card tone="neutral" target="/kpi-details/customer-360/avg-spend"><span>Avg spend</span><strong>{{ metrics.avgSpend | auraMoney:'1.0-0' }}</strong></aura-kpi-card>
        <aura-kpi-card tone="neutral" target="/kpi-details/customer-360/high-risk"><span>High risk</span><strong>{{ metrics.highRisk }}</strong></aura-kpi-card>
      </div>

      <div class="dashboard-grid">
        <section class="panel inner-page-card">
          <div class="section-title"><h2>Customer intelligence list</h2><span class="badge">{{ totalClients() }} total clients</span></div>
          <div class="table-wrap inner-table-wrap">
            <table>
              <thead><tr><th>Client</th><th>LTV</th><th>Favorite</th><th>Risk</th><th>Next action</th><th></th></tr></thead>
              <tbody>
                <tr *ngFor="let profile of customerProfiles()">
                  <td><strong>{{ clientName(profile.client) }}</strong><small>{{ clientPhone(profile.client) }}</small></td>
                  <td>{{ (profile.metrics?.lifetimeValue || 0) | auraMoney:'1.0-0' }}</td>
                  <td>{{ profile.metrics?.favoriteService || "No favorite yet" }}</td>
                  <td>{{ profile.metrics?.riskScore || 0 }}</td>
                  <td>{{ profile.nextBestAction?.action || "Open client profile" }}</td>
                  <td><button class="ghost-button mini" type="button" (click)="select(clientId(profile.client))" [disabled]="!clientId(profile.client)">Open</button></td>
                </tr>
                <tr *ngIf="!customerProfiles().length"><td colspan="6"><div class="empty-state"><strong>No clients found</strong><span>Create a client or booking to generate customer intelligence.</span></div></td></tr>
              </tbody>
            </table>
          </div>
        </section>

        <section class="form-panel inner-form-grid">
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
          <span class="avatar large">{{ clientInitial(profileData.client) }}</span>
          <div>
            <h2>{{ clientName(profileData.client) }}</h2>
            <p>{{ clientContactLine(profileData.client) }}</p>
            <div class="chip-row"><span class="badge" *ngFor="let tag of clientTags(profileData.client)">{{ tag }}</span></div>
          </div>
          <div class="profile-stats">
            <span>LTV</span><strong>{{ profileData.metrics.lifetimeValue | auraMoney:'1.0-0' }}</strong>
            <span>Risk</span><strong>{{ profileData.metrics.riskScore }}</strong>
            <a class="ghost-button mini" [routerLink]="['/clients', profileData.client.id]">Open Client 360 profile</a>
          </div>
        </section>

        <div class="metrics-grid">
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
          </section>
        </div>
      </ng-container>

      <pre class="result-json" *ngIf="result()">{{ result() | json }}</pre>
    </section>
  `,
  styles: [`
    .customer-360-hero-actions {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: 10px;
      flex-wrap: wrap;
    }

    .duplicate-merge-panel {
      display: grid;
      gap: 12px;
      margin: 0 0 6px;
      padding: 12px;
      border: 1px solid #4B1238;
      border-radius: var(--radius-md);
      background: #F8EEF4;
    }

    .duplicate-panel-actions {
      display: flex;
      align-items: center;
      justify-content: flex-end;
      gap: 8px;
      flex-wrap: wrap;
    }

    .duplicate-panel-header,
    .duplicate-group-header,
    .duplicate-client-option {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
    }

    .duplicate-panel-header h3,
    .duplicate-panel-header p {
      margin: 0;
    }

    .duplicate-panel-header p,
    .duplicate-group-header small,
    .duplicate-client-option small {
      color: var(--muted);
      font-weight: 700;
    }

    .duplicate-group-list {
      display: grid;
      gap: 10px;
    }

    .duplicate-group {
      display: grid;
      gap: 10px;
      padding: 10px;
      border: 1px solid var(--line);
      border-radius: var(--radius-sm);
      background: var(--surface);
    }

    .duplicate-group.active {
      border-color: #4B1238;
      box-shadow: 0 0 0 2px color-mix(in srgb, #4B1238 12%, transparent);
    }

    .duplicate-client-options {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
      gap: 8px;
    }

    .duplicate-client-option {
      width: 100%;
      min-height: 74px;
      border: 1px solid var(--line);
      border-radius: var(--radius-sm);
      padding: 9px;
      color: inherit;
      background: color-mix(in srgb, var(--surface) 96%, white);
      font: inherit;
      text-align: left;
      cursor: pointer;
    }

    .duplicate-client-option.primary {
      border-color: #4B1238;
      background: #F8EEF4;
    }

    .duplicate-client-option > span:nth-child(2) {
      min-width: 0;
      display: grid;
      gap: 2px;
      flex: 1 1 auto;
    }

    .duplicate-client-option em {
      color: var(--muted);
      font-size: 12px;
      font-style: normal;
      font-weight: 900;
      text-transform: uppercase;
    }

    .duplicate-message {
      margin: 0;
      color: #4B1238;
      font-weight: 850;
    }

    @media (max-width: 760px) {
      .customer-360-hero-actions,
      .duplicate-panel-header,
      .duplicate-group-header,
      .duplicate-client-option {
        align-items: stretch;
        flex-direction: column;
      }

      .duplicate-panel-actions {
        justify-content: flex-start;
      }
    }
  `]
})
export class Customer360Component implements OnInit, OnDestroy {
  readonly summary = signal<ApiRecord | null>(null);
  readonly profile = signal<ApiRecord | null>(null);
  readonly result = signal<ApiRecord | null>(null);
  readonly loading = signal(false);
  readonly error = signal('');
  readonly duplicateGroups = signal<ApiRecord[]>([]);
  readonly duplicateLoading = signal(false);
  readonly duplicateMergeAllLoading = signal(false);
  readonly duplicateSaving = signal(false);
  readonly duplicateError = signal('');
  readonly duplicateMessage = signal('');
  readonly duplicatePrimarySelection = signal<Record<string, string>>({});
  readonly activeDuplicateGroupKey = signal('');
  private summaryLoadInFlight = false;
  private readonly summaryBatchSize = 500;
  private summaryLimit = this.summaryBatchSize;
  private summaryBatchTimer: ReturnType<typeof setTimeout> | undefined;
  private refreshTimer: ReturnType<typeof setInterval> | undefined;
  private readonly refreshOnFocus = () => this.refreshSummary(false);
  private readonly refreshOnVisibility = () => {
    if (document.visibilityState === 'visible') this.refreshSummary(false);
  };

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

  customerProfiles(): ApiRecord[] {
    const summary = this.summary();
    const profiles = Array.isArray(summary?.profiles) ? summary.profiles.filter((profile: ApiRecord) => profile && typeof profile === 'object') : [];
    if (profiles.length) return profiles;
    const clientList = Array.isArray(summary?.clientList) ? summary.clientList.filter((client: ApiRecord) => client && typeof client === 'object') : [];
    return clientList.map((client: ApiRecord) => ({
      client,
      metrics: {
        lifetimeValue: Number(client.totalSpend || client.lifetimeValue || 0),
        favoriteService: client.favoriteService || client.preferredService || 'No favorite yet',
        riskScore: 0
      },
      nextBestAction: { action: 'Open client profile' }
    }));
  }

  totalClients(): number {
    const metrics = this.summary()?.metrics || {};
    const metricCount = Number(metrics.clients || metrics.totalClients || 0);
    if (metricCount) return metricCount;
    const clientList = this.summary()?.clientList;
    return Array.isArray(clientList) ? clientList.length : this.customerProfiles().length;
  }

  clientId(client: ApiRecord | null | undefined): string {
    return String(client?.id || '');
  }

  clientName(client: ApiRecord | null | undefined): string {
    if (!client) return 'Client';
    return String(client.name || client.fullName || client.full_name || client.clientName || client.customerName || client.phone || client.email || client.id || 'Client').trim() || 'Client';
  }

  clientPhone(client: ApiRecord | null | undefined): string {
    return String(client?.phone || client?.mobile || client?.mobileNumber || client?.contactNumber || '').trim();
  }

  clientContactLine(client: ApiRecord | null | undefined): string {
    const phone = this.clientPhone(client) || 'No phone';
    const email = String(client?.email || '').trim() || 'No email';
    return `${phone} · ${email}`;
  }

  clientInitial(client: ApiRecord | null | undefined): string {
    return this.clientName(client).slice(0, 1).toUpperCase() || 'C';
  }

  clientTags(client: ApiRecord | null | undefined): string[] {
    const tags = client?.tags;
    if (Array.isArray(tags)) return tags.filter(Boolean).map(String);
    return tags ? [String(tags)] : [];
  }

  loadDuplicateGroups(successMessage = ''): void {
    if (this.duplicateLoading()) return;
    this.duplicateLoading.set(true);
    this.duplicateError.set('');
    if (!successMessage) this.duplicateMessage.set('');
    this.api.list<ApiRecord[]>('clients/duplicates', { matchType: 'phone' }).subscribe({
      next: (groups) => {
        const duplicateGroups = Array.isArray(groups) ? groups : [];
        this.duplicateGroups.set(duplicateGroups);
        const selection: Record<string, string> = {};
        for (const group of duplicateGroups) {
          const key = String(group.groupKey || '');
          if (!key) continue;
          selection[key] = String(group.suggestedPrimaryId || this.duplicateGroupClients(group)[0]?.id || '');
        }
        this.duplicatePrimarySelection.set(selection);
        this.duplicateMessage.set(successMessage || (duplicateGroups.length ? '' : 'No duplicate contacts found.'));
        this.duplicateLoading.set(false);
      },
      error: (error) => {
        this.duplicateError.set(this.api.errorText(error, 'Unable to scan duplicate clients'));
        this.duplicateLoading.set(false);
      }
    });
  }

  visibleDuplicateGroups(): ApiRecord[] {
    return this.duplicateGroups().slice(0, 100);
  }

  phoneDuplicateGroupCount(): number {
    return this.phoneDuplicateGroups().length;
  }

  private phoneDuplicateGroups(): ApiRecord[] {
    return this.duplicateGroups().filter((group) => this.isPhoneDuplicateGroup(group));
  }

  private isPhoneDuplicateGroup(group: ApiRecord | null | undefined): boolean {
    const type = String(group?.matchType || '').toLowerCase();
    const key = String(group?.groupKey || '').toLowerCase();
    return type === 'phone' || key.startsWith('phone:');
  }

  duplicateGroupClients(group: ApiRecord | null | undefined): ApiRecord[] {
    return Array.isArray(group?.clients) ? group.clients : [];
  }

  duplicateMatchValues(group: ApiRecord | null | undefined): string {
    const values = Array.isArray(group?.matchValues) ? group.matchValues.filter(Boolean).map(String) : [];
    return values.length ? values.join(', ') : 'Matching contact details';
  }

  duplicateGroupPrimaryId(group: ApiRecord | null | undefined): string {
    const key = String(group?.groupKey || '');
    const selection = this.duplicatePrimarySelection();
    return String(selection[key] || group?.suggestedPrimaryId || this.duplicateGroupClients(group)[0]?.id || '');
  }

  setDuplicatePrimary(group: ApiRecord, clientId: string, event?: Event): void {
    event?.stopPropagation();
    const key = String(group?.groupKey || '');
    const id = String(clientId || '');
    if (!key || !id) return;
    this.activeDuplicateGroupKey.set(key);
    this.duplicatePrimarySelection.set({ ...this.duplicatePrimarySelection(), [key]: id });
  }

  mergeAllDuplicateGroups(): void {
    if (this.duplicateMergeAllLoading()) return;
    const groupCount = this.phoneDuplicateGroupCount();
    if (!groupCount) {
      this.duplicateMessage.set('No same-phone duplicate groups to merge.');
      return;
    }
    const totals = {
      mergedClients: 0,
      mergedGroups: 0,
      skippedGroups: 0,
      processedGroups: 0,
      skippedGroupKeys: [] as string[]
    };
    this.duplicateSaving.set(true);
    this.duplicateMergeAllLoading.set(true);
    this.duplicateError.set('');
    this.duplicateMessage.set(`Merging duplicate contacts... 0 clients merged across 0 groups. ${groupCount} groups remaining.`);
    this.runDuplicateMergeBatch(totals);
  }

  private runDuplicateMergeBatch(totals: { mergedClients: number; mergedGroups: number; skippedGroups: number; processedGroups: number; skippedGroupKeys: string[] }): void {
    this.api.post<ApiRecord>('clients/duplicates/merge-all', {
      matchType: 'phone',
      limit: 25,
      skipGroupKeys: totals.skippedGroupKeys,
      reason: 'Merged by customer 360 duplicate merge all'
    }).subscribe({
      next: (result) => {
        const mergedClients = Number(result?.mergedClients || 0);
        const mergedGroups = Number(result?.mergedGroups || 0);
        const skippedGroups = Number(result?.skippedGroups || 0);
        const processedGroups = Number(result?.processedGroups || result?.scannedGroups || 0);
        const remainingGroups = Number(result?.remainingGroups || 0);
        const skippedGroupKeys = Array.isArray(result?.skippedGroupKeys) ? result.skippedGroupKeys.map(String).filter(Boolean) : [];
        totals.mergedClients += mergedClients;
        totals.mergedGroups += mergedGroups;
        totals.skippedGroups += skippedGroups;
        totals.processedGroups += processedGroups;
        totals.skippedGroupKeys = [...new Set([...totals.skippedGroupKeys, ...skippedGroupKeys])];
        this.duplicateMessage.set(`Merging duplicate contacts... ${totals.mergedClients} clients merged across ${totals.mergedGroups} groups. ${remainingGroups} groups remaining.`);
        if (remainingGroups > 0 && processedGroups > 0) {
          this.runDuplicateMergeBatch(totals);
          return;
        }
        this.duplicateMessage.set(`Merge complete: ${totals.mergedClients} duplicate client(s) merged across ${totals.mergedGroups} group(s). ${totals.skippedGroups} group(s) skipped.`);
        this.duplicateSaving.set(false);
        this.duplicateMergeAllLoading.set(false);
        this.duplicateGroups.set([]);
        this.load(false);
      },
      error: (error) => {
        this.duplicateError.set(this.api.errorText(error, 'Unable to merge all duplicate clients'));
        this.duplicateSaving.set(false);
        this.duplicateMergeAllLoading.set(false);
      }
    });
  }

  mergeDuplicateGroup(group: ApiRecord, event?: Event): void {
    event?.stopPropagation();
    const clients = this.duplicateGroupClients(group);
    const primaryId = this.duplicateGroupPrimaryId(group);
    const duplicateClientIds = clients.map((client) => this.clientId(client)).filter((id) => id && id !== primaryId);
    if (!primaryId || !duplicateClientIds.length) return;
    const primary = clients.find((client) => this.clientId(client) === primaryId);
    if (!window.confirm(`Merge ${duplicateClientIds.length} duplicate client(s) into "${this.clientName(primary)}"?`)) return;
    this.duplicateSaving.set(true);
    this.duplicateError.set('');
    this.duplicateMessage.set('');
    this.api.post<ApiRecord>(`clients/${encodeURIComponent(primaryId)}/merge-duplicates`, {
      duplicateClientIds,
      reason: 'Merged from customer 360 duplicate client panel'
    }).subscribe({
      next: (result) => {
        const archivedIds = Array.isArray(result?.archivedClientIds) ? result.archivedClientIds.map(String) : duplicateClientIds;
        const successMessage = `Merged ${archivedIds.length} duplicate client(s).`;
        this.result.set(result);
        this.duplicateMessage.set(successMessage);
        this.duplicateSaving.set(false);
        this.select(primaryId);
        this.load(false);
        this.loadDuplicateGroups(successMessage);
      },
      error: (error) => {
        this.duplicateError.set(this.api.errorText(error, 'Unable to merge duplicate clients'));
        this.duplicateSaving.set(false);
      }
    });
  }

  ngOnInit(): void {
    this.load();
    this.startAutoRefresh();
  }

  ngOnDestroy(): void {
    if (this.refreshTimer) clearInterval(this.refreshTimer);
    if (this.summaryBatchTimer) clearTimeout(this.summaryBatchTimer);
    window.removeEventListener('focus', this.refreshOnFocus);
    document.removeEventListener('visibilitychange', this.refreshOnVisibility);
  }

  load(showSpinner = true): void {
    this.refreshSummary(showSpinner);
  }

  private refreshSummary(showSpinner = true): void {
    if (this.summaryLoadInFlight) return;
    this.summaryLoadInFlight = true;
    if (showSpinner) {
      this.loading.set(true);
      this.error.set('');
    }
    this.api.list<ApiRecord>('customer-360/summary', { limit: this.summaryLimit }).subscribe({
      next: (summary) => {
        this.summary.set(summary);
        const profiles = Array.isArray(summary.profiles) ? summary.profiles.filter((item: ApiRecord) => item && typeof item === 'object') : [];
        const currentClientId = String(this.profile()?.client?.id || '');
        const currentStillVisible = currentClientId && profiles.some((item: ApiRecord) => String(item.client?.id || '') === currentClientId);
        const firstProfileWithClient = profiles.find((item: ApiRecord) => String(item.client?.id || ''));
        const nextClientId = currentStillVisible ? currentClientId : String(firstProfileWithClient?.client?.id || '');
        this.scheduleNextSummaryBatch(profiles.length);
        if (nextClientId) {
          this.select(nextClientId);
        } else {
          this.profile.set(null);
        }
        this.summaryLoadInFlight = false;
        this.loading.set(false);
      },
      error: (error) => {
        this.error.set(error?.error?.error || 'Unable to load customer 360');
        this.summaryLoadInFlight = false;
        this.loading.set(false);
      }
    });
  }
  private scheduleNextSummaryBatch(loadedCount: number): void {
    if (loadedCount < this.summaryLimit || this.summaryBatchTimer) return;
    this.summaryBatchTimer = setTimeout(() => {
      this.summaryBatchTimer = undefined;
      this.summaryLimit += this.summaryBatchSize;
      this.refreshSummary(false);
    }, 1000);
  }

  select(clientId: string): void {
    if (!clientId) return;
    this.api.list<ApiRecord>(`customer-360/clients/${encodeURIComponent(clientId)}`).subscribe({
      next: (profile) => this.profile.set(profile),
      error: (error) => this.error.set(this.api.errorText(error, 'Unable to load customer profile'))
    });
  }
  private startAutoRefresh(): void {
    if (this.refreshTimer) return;
    this.refreshTimer = setInterval(() => this.refreshSummary(false), 30000);
    window.addEventListener('focus', this.refreshOnFocus);
    document.addEventListener('visibilitychange', this.refreshOnVisibility);
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
