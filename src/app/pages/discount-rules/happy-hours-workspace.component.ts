import { CommonModule } from '@angular/common';
import { Component, OnInit, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { catchError, forkJoin, of } from 'rxjs';
import { ApiRecord, ApiService } from '../../core/api.service';
import { DiscountAnomalyInboxComponent } from './anomaly-inbox.component';
import { BranchOfferLeaderboardComponent } from './branch-offer-leaderboard.component';
import { CampaignAudienceBuilderComponent } from './campaign-audience-builder.component';
import { ClientReturnTrackerComponent } from './client-return-tracker.component';
import { HappyHoursClientSegmentsComponent } from './client-segments.component';
import { CouponEngineComponent } from './coupon-engine.component';
import { CrossBranchAnalyticsComponent } from './cross-branch-analytics.component';
import { HappyHoursFraudGuardComponent } from './fraud-guard.component';
import { HappyHoursControlTowerComponent } from './happy-hours-control-tower.component';
import { OfferAutoSunsetComponent } from './offer-auto-sunset.component';
import { OfferHealthScoreComponent } from './offer-health-score.component';
import { OfferLifecycleComponent } from './offer-lifecycle.component';
import { OfferRoiScoreComponent } from './offer-roi-score.component';
import { PromotionCalendarComponent } from './promotion-calendar.component';
import { RuleConflictDetectorComponent } from './rule-conflict-detector.component';
import { RuleListComponent } from './rule-list.component';
import { DiscountSimulationSandboxComponent } from './simulation-sandbox.component';
import { HappyHoursStaffIncentivesComponent } from './staff-incentives.component';
import { WhiteLabelRulesComponent } from './white-label-rules.component';
import { DiscountAuditLogComponent } from './audit-log.component';
import { DiscountRuleApprovalsComponent } from './approvals.component';
import { PricingIncrementalityComponent } from '../pricing/incrementality.component';
import { Level6ReadinessComponent } from '../pricing/level6-readiness.component';
import { MarketIntelligenceComponent } from '../pricing/market-intelligence.component';

type WorkspaceKey =
  | 'control'
  | 'rules'
  | 'calendar'
  | 'coupons'
  | 'segments'
  | 'audience'
  | 'incentives'
  | 'lifecycle'
  | 'roi'
  | 'health'
  | 'returns'
  | 'leaderboard'
  | 'fraud'
  | 'conflicts'
  | 'sunset'
  | 'public'
  | 'audit'
  | 'approvals'
  | 'analytics'
  | 'simulations'
  | 'anomalies'
  | 'labels'
  | 'incrementality'
  | 'market'
  | 'readiness';

type WorkspaceItem = {
  key: WorkspaceKey;
  label: string;
  source: string;
  note: string;
  value: (metrics: ApiRecord) => string;
  status?: (metrics: ApiRecord) => 'live' | 'warn' | 'risk' | 'ready';
};

@Component({
  selector: 'app-happy-hours-workspace',
  standalone: true,
  imports: [
    CommonModule,
    RouterLink,
    DiscountAnomalyInboxComponent,
    BranchOfferLeaderboardComponent,
    CampaignAudienceBuilderComponent,
    ClientReturnTrackerComponent,
    HappyHoursClientSegmentsComponent,
    CouponEngineComponent,
    CrossBranchAnalyticsComponent,
    HappyHoursFraudGuardComponent,
    HappyHoursControlTowerComponent,
    OfferAutoSunsetComponent,
    OfferHealthScoreComponent,
    OfferLifecycleComponent,
    OfferRoiScoreComponent,
    PromotionCalendarComponent,
    RuleConflictDetectorComponent,
    RuleListComponent,
    DiscountSimulationSandboxComponent,
    HappyHoursStaffIncentivesComponent,
    WhiteLabelRulesComponent,
    DiscountAuditLogComponent,
    DiscountRuleApprovalsComponent,
    PricingIncrementalityComponent,
    Level6ReadinessComponent,
    MarketIntelligenceComponent
  ],
  templateUrl: './happy-hours-workspace.component.html',
  styleUrls: ['./happy-hours-workspace.component.css']
})
export class HappyHoursWorkspaceComponent implements OnInit {
  readonly selected = signal<WorkspaceKey>('control');
  readonly metrics = signal<ApiRecord>({});
  readonly loading = signal(false);
  readonly error = signal('');

  readonly items: WorkspaceItem[] = [
    { key: 'control', label: 'Control Tower', source: 'rules + coupons + budget + ROI', note: 'single dashboard', value: (m) => `${m.activeRules || 0} rules`, status: () => 'live' },
    { key: 'rules', label: 'Discount Rules', source: '/api/discount-rules', note: 'visual rule engine', value: (m) => `${m.activeRules || 0} active`, status: () => 'live' },
    { key: 'calendar', label: 'Promotion Calendar', source: 'promotionCalendar', note: 'scheduled offers', value: (m) => `${m.upcomingPromotions || 0}`, status: (m) => m.upcomingPromotions ? 'live' : 'ready' },
    { key: 'coupons', label: 'Coupon Engine', source: 'discountCoupons', note: 'promo codes', value: (m) => `${m.activeCoupons || 0} active`, status: (m) => m.activeCoupons ? 'live' : 'ready' },
    { key: 'segments', label: 'Client Segments', source: 'clientSegments', note: 'VIP/new/inactive', value: (m) => `${m.segments || 0}`, status: () => 'ready' },
    { key: 'audience', label: 'Audience Builder', source: 'campaign audiences', note: 'WhatsApp/SMS targets', value: (m) => `${m.audiences || 0}`, status: () => 'ready' },
    { key: 'incentives', label: 'Staff Incentives', source: 'staffDiscountIncentives', note: 'conversion payout', value: (m) => `${m.incentives || 0}`, status: () => 'ready' },
    { key: 'lifecycle', label: 'Offer Lifecycle', source: 'offer lifecycle + ROI', note: 'idea to report', value: (m) => `${m.lifecycle || 0}`, status: () => 'ready' },
    { key: 'roi', label: 'Offer ROI Score', source: 'offerRoiEvents', note: 'business result', value: (m) => `${m.roiOffers || 0} offers`, status: (m) => m.roiOffers ? 'live' : 'ready' },
    { key: 'health', label: 'Offer Health Score', source: 'ROI + margin + returns', note: 'single score', value: (m) => `${m.avgHealth || 0}`, status: (m) => Number(m.atRiskHealth || 0) ? 'risk' : 'live' },
    { key: 'returns', label: 'Client Return Tracker', source: 'offer outcomes + visits', note: 'retention signal', value: (m) => `${m.returnRate || 0}%`, status: (m) => Number(m.atRiskReturns || 0) ? 'warn' : 'live' },
    { key: 'leaderboard', label: 'Branch Leaderboard', source: 'branch offer performance', note: 'branch ranking', value: (m) => `${m.branchScore || 0}`, status: () => 'live' },
    { key: 'fraud', label: 'Fraud Guard', source: 'fraud cases + abuse alerts', note: 'abuse control', value: (m) => `${m.openAbuseAlerts || 0} open`, status: (m) => m.openAbuseAlerts ? 'risk' : 'live' },
    { key: 'conflicts', label: 'Rule Conflicts', source: 'rule overlap scanner', note: 'margin risk', value: (m) => `${m.conflicts || 0}`, status: (m) => m.conflicts ? 'warn' : 'live' },
    { key: 'sunset', label: 'Auto Sunset', source: 'auto-sunset decisions', note: 'review required', value: (m) => `${m.sunset || 0}`, status: (m) => m.sunset ? 'warn' : 'ready' },
    { key: 'public', label: 'Public Booking Offers', source: 'public offer wrapper', note: 'booking visibility', value: () => 'Live', status: () => 'live' },
    { key: 'audit', label: 'Audit Log', source: 'discountAuditLog', note: 'compliance trail', value: () => 'Log', status: () => 'live' },
    { key: 'approvals', label: 'Approvals', source: 'ruleApprovals', note: 'role limits', value: (m) => `${m.pendingApprovals || 0}`, status: (m) => m.pendingApprovals ? 'warn' : 'live' },
    { key: 'analytics', label: 'Branch Analytics', source: 'cross-branch analytics', note: 'region view', value: (m) => `${m.branchCount || 0} branches`, status: () => 'live' },
    { key: 'simulations', label: 'Simulations', source: 'discountSimulations', note: 'sandbox', value: (m) => `${m.savedSimulations || 0}`, status: () => 'ready' },
    { key: 'anomalies', label: 'Anomalies', source: 'discountAnomalies', note: 'unusual activity', value: (m) => `${m.openAnomalies || 0}`, status: (m) => m.openAnomalies ? 'risk' : 'live' },
    { key: 'labels', label: 'White-label Rules', source: 'public labels', note: 'customer-safe names', value: () => 'Brand', status: () => 'ready' },
    { key: 'incrementality', label: 'Incrementality', source: 'holdout uplift', note: 'true ROI', value: () => 'F2', status: () => 'ready' },
    { key: 'market', label: 'Market Intel', source: 'competitor prices', note: 'pricing context', value: () => 'F4', status: () => 'ready' },
    { key: 'readiness', label: 'Level 6 Readiness', source: 'ML readiness gates', note: 'data maturity', value: () => 'L6', status: () => 'ready' }
  ];

  constructor(private readonly api: ApiService) {}

  ngOnInit(): void {
    this.loadMetrics();
  }

  loadMetrics(): void {
    this.loading.set(true);
    this.error.set('');
    forkJoin({
      tower: this.safe('happy-hours-control-tower/summary'),
      roi: this.safe('happy-hours-roi-score/summary'),
      health: this.safe('happy-hours-offer-health/summary'),
      returns: this.safe('happy-hours-client-returns/summary'),
      branch: this.safe('happy-hours-branch-leaderboard/summary'),
      segments: this.safeRows('happy-hours-control-tower/segments'),
      incentives: this.safeRows('happy-hours-control-tower/staff-incentives'),
      audiences: this.safeRows('happy-hours-campaign-audiences'),
      lifecycle: this.safeRows('happy-hours-lifecycle'),
      conflicts: this.safe('discount-rules/conflicts'),
      sunset: this.safeRows('happy-hours-auto-sunset/decisions', { status: 'suggested' })
    }).subscribe({
      next: (result) => {
        const roi = result.roi as ApiRecord;
        const health = result.health as ApiRecord;
        const returns = result.returns as ApiRecord;
        const branch = result.branch as ApiRecord;
        const conflicts = result.conflicts as ApiRecord;
        this.metrics.set({
          ...result.tower,
          roiOffers: roi.summary?.offers || 0,
          avgHealth: health.summary?.averageHealthScore || 0,
          atRiskHealth: health.summary?.byStatus?.at_risk || 0,
          returnRate: returns.summary?.returnRatePercent || 0,
          atRiskReturns: returns.summary?.atRiskCount || 0,
          branchScore: branch.summary?.averageScore || 0,
          branchCount: branch.summary?.branches || 0,
          segments: this.rowCount(result.segments),
          incentives: this.rowCount(result.incentives),
          audiences: this.rowCount(result.audiences),
          lifecycle: this.rowCount(result.lifecycle),
          conflicts: conflicts.conflictCount || conflicts.conflicts?.length || 0,
          sunset: this.rowCount(result.sunset)
        });
        this.loading.set(false);
      },
      error: (error) => {
        this.error.set(this.api.errorText(error, 'Unable to load Happy Hours workspace'));
        this.loading.set(false);
      }
    });
  }

  selectedItem(): WorkspaceItem {
    return this.items.find((item) => item.key === this.selected()) || this.items[0];
  }

  itemState(item: WorkspaceItem): string {
    return item.status?.(this.metrics()) || 'ready';
  }

  statusLabel(item: WorkspaceItem): string {
    const state = this.itemState(item);
    if (state === 'risk') return 'Risk';
    if (state === 'warn') return 'Watch';
    if (state === 'live') return 'Live';
    return 'Ready';
  }

  private safe(path: string, params: ApiRecord = {}) {
    return this.api.list<ApiRecord>(path, params).pipe(catchError(() => of({} as ApiRecord)));
  }

  private safeRows(path: string, params: ApiRecord = {}) {
    return this.api.list<{ rows?: ApiRecord[] }>(path, params).pipe(
      catchError(() => of({ rows: [] } as { rows?: ApiRecord[] }))
    );
  }

  private rowCount(result?: { rows?: ApiRecord[] } | ApiRecord[]): number {
    if (Array.isArray(result)) return result.length;
    return result?.rows?.length || 0;
  }
}
