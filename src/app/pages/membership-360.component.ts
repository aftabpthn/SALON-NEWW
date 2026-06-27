import { CommonModule, CurrencyPipe, DatePipe } from '@angular/common';
import { Component, OnInit, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { catchError } from 'rxjs';
import { ApiRecord, ApiService } from '../core/api.service';
import { StateComponent } from '../shared/ui/state/state.component';

@Component({
  selector: 'app-membership-360',
  standalone: true,
  imports: [CommonModule, RouterLink, CurrencyPipe, DatePipe, StateComponent],
  template: `
    <section class="page-stack">
      <div class="module-hero compact-hero">
        <div>
          <span class="eyebrow">{{ isMembershipProfile() ? 'Member 360 timeline' : 'Membership plan 360' }}</span>
          <h2>{{ pageTitle() }}</h2>
          <p *ngIf="isMembershipProfile(); else planHeroCopy">
            Client membership profile, payments, lifecycle, invoices, staff attribution, audit and WhatsApp reminders.
          </p>
          <ng-template #planHeroCopy>
            <p>Plan performance, sold clients, revenue, discount liability and invoice snapshots.</p>
          </ng-template>
        </div>
        <div class="hero-actions">
          <a class="ghost-button" routerLink="/memberships">Back to memberships</a>
          <a class="ghost-button" routerLink="/pos">Sell in POS</a>
        </div>
      </div>

      <app-state [loading]="loading()" [error]="error()"></app-state>

      <ng-container *ngIf="isMembershipProfile(); else plan360View">
        <section class="stats-grid" *ngIf="metrics() as metric">
          <article class="metric-card"><span>Timeline</span><strong>{{ metric.timelineEvents || 0 }}</strong><small>Ledger, audit and reminders</small></article>
          <article class="metric-card"><span>Payments</span><strong>{{ metric.payments || 0 }}</strong><small>Sold, renewed, upgraded</small></article>
          <article class="metric-card"><span>Invoices</span><strong>{{ metric.invoices || 0 }}</strong><small>Linked billing records</small></article>
          <article class="metric-card"><span>Risk signals</span><strong>{{ metric.riskSignals || 0 }}</strong><small>Needs review</small></article>
        </section>

        <div class="two-grid">
          <section class="panel">
            <div class="section-title"><h2>Membership profile</h2></div>
            <div class="detail-grid">
              <div><span>Status</span><strong>{{ membershipProfile().status || '-' }}</strong></div>
              <div><span>Branch</span><strong>{{ membershipProfile().branchId || '-' }}</strong></div>
              <div><span>Taken on</span><strong>{{ membershipProfile().takenDate || '-' }}</strong></div>
              <div><span>Expires on</span><strong>{{ membershipProfile().expiryDate || '-' }}</strong></div>
              <div><span>Days left</span><strong>{{ membershipProfile().daysLeft ?? '-' }}</strong></div>
              <div><span>Auto-renew</span><strong>{{ membershipProfile().autoRenew ? 'On' : 'Off' }}</strong></div>
              <div><span>Credits</span><strong>{{ membershipProfile().creditsRemaining || 0 }} / {{ membershipProfile().planCredits || 0 }}</strong></div>
              <div><span>Price</span><strong>{{ membershipProfile().price | currency: 'INR':'symbol':'1.0-0' }}</strong></div>
              <div><span>Plan type</span><strong>{{ label(wallet().activeMembership?.planType || wallet().memberships?.[0]?.planType || currentPlan().benefitRules?.planType) }}</strong></div>
              <div><span>Business label</span><strong>{{ wallet().businessLabel || wallet().memberships?.[0]?.businessLabel || '-' }}</strong></div>
            </div>
          </section>

          <section class="panel">
            <div class="section-title"><h2>Client info</h2></div>
            <div class="profile-card">
              <strong>{{ client().name || client().id || 'Client' }}</strong>
              <span>{{ client().phone || 'No phone saved' }}</span>
              <span>{{ client().email || 'No email saved' }}</span>
              <span>Branch {{ client().branchId || membershipProfile().branchId || '-' }}</span>
            </div>
          </section>
        </div>

        <div class="two-grid">
          <section class="panel">
            <div class="section-title"><h2>Current plan</h2></div>
            <div class="detail-grid">
              <div><span>Plan</span><strong>{{ currentPlan().name || '-' }}</strong></div>
              <div><span>Price</span><strong>{{ currentPlan().price | currency: 'INR':'symbol':'1.0-0' }}</strong></div>
              <div><span>Service discount</span><strong>{{ currentPlan().discountPercent || membershipProfile().discountPercent || 0 }}%</strong></div>
              <div><span>Product discount</span><strong>{{ currentPlan().productDiscountPercent || membershipProfile().productDiscountPercent || 0 }}%</strong></div>
              <div><span>Validity</span><strong>{{ currentPlan().validityDays || '-' }} days</strong></div>
              <div><span>Status</span><strong>{{ currentPlan().status || '-' }}</strong></div>
            </div>
          </section>

          <section class="panel">
            <div class="section-title"><h2>Wallet snapshot</h2></div>
            <div class="detail-grid" *ngIf="wallet(); else noWallet">
              <div><span>Wallet balance</span><strong>{{ wallet().walletBalance | currency: 'INR':'symbol':'1.0-0' }}</strong></div>
              <div><span>Service credits</span><strong>{{ wallet().serviceCredits?.remaining || 0 }} left</strong></div>
              <div><span>Credits used</span><strong>{{ wallet().serviceCredits?.used || 0 }}</strong></div>
              <div><span>Active packages</span><strong>{{ wallet().packageSummary?.activeCount || 0 }}</strong></div>
              <div><span>Package credits</span><strong>{{ wallet().packageSummary?.creditsRemaining || 0 }}</strong></div>
              <div><span>Family sharing</span><strong>{{ wallet().familySharing?.status || 'not_shared' }}</strong></div>
              <div><span>Fair usage</span><strong>{{ fairUsageLabel(wallet()) }}</strong></div>
              <div><span>Corporate rule</span><strong>{{ corporateLabel(wallet()) }}</strong></div>
              <div><span>Occasion benefit</span><strong>{{ occasionBenefitLabel(wallet()) }}</strong></div>
              <div><span>Tier status</span><strong>{{ tierLabel(wallet()) }}</strong></div>
            </div>
            <ng-template #noWallet>
              <div class="empty-panel compact-empty"><strong>No wallet snapshot.</strong><span>Client wallet record was not found.</span></div>
            </ng-template>
          </section>
        </div>

        <section class="panel">
          <div class="section-title"><h2>Lifecycle timeline</h2></div>
          <div class="timeline-list" *ngIf="lifecycleTimeline().length; else noTimeline">
            <article class="timeline-event" *ngFor="let event of lifecycleTimeline()">
              <div class="timeline-dot" [ngClass]="eventTone(event)"></div>
              <div>
                <strong>{{ event.label || label(event.action) }}</strong>
                <span>{{ event.createdAt | date: 'medium' }} · {{ event.source }}</span>
                <small>{{ event.note || event.invoiceId || event.actor?.label || 'Audit-backed membership activity' }}</small>
                <a *ngIf="event.invoiceRoute" [routerLink]="event.invoiceRoute">Open invoice {{ event.invoiceId }}</a>
              </div>
              <b *ngIf="event.paidAmount || event.amount">{{ (event.paidAmount || event.amount) | currency: 'INR':'symbol':'1.0-0' }}</b>
            </article>
          </div>
          <ng-template #noTimeline>
            <div class="empty-panel compact-empty"><strong>No lifecycle timeline yet.</strong><span>Ledger, audit, invoice and WhatsApp records will appear here.</span></div>
          </ng-template>
        </section>

        <div class="two-grid">
          <section class="panel">
            <div class="section-title"><h2>Payment history</h2></div>
            <div class="table-wrap">
              <table>
                <thead><tr><th>When</th><th>Action</th><th>Mode</th><th>Paid</th><th>Invoice</th><th>Actor</th></tr></thead>
                <tbody>
                  <tr *ngFor="let payment of paymentHistory()">
                    <td>{{ payment.createdAt | date: 'short' }}</td>
                    <td>{{ label(payment.action) }}</td>
                    <td>{{ payment.paymentMode || '-' }}</td>
                    <td>{{ payment.paidAmount | currency: 'INR':'symbol':'1.0-0' }}</td>
                    <td><a *ngIf="payment.invoiceId; else noInvoice" [routerLink]="['/billing/invoices', payment.invoiceId]">{{ payment.invoiceId }}</a><ng-template #noInvoice>-</ng-template></td>
                    <td>{{ payment.actorUserId || payment.actorRole || 'System' }}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </section>

          <section class="panel">
            <div class="section-title"><h2>Invoice links</h2></div>
            <div class="quick-grid" *ngIf="invoiceLinks().length; else noInvoices">
              <article class="action-card" *ngFor="let invoice of invoiceLinks()">
                <strong>{{ invoice.invoiceId }}</strong>
                <span>{{ invoice.amount | currency: 'INR':'symbol':'1.0-0' }} · Discount {{ invoice.discountAmount | currency: 'INR':'symbol':'1.0-0' }}</span>
                <a [routerLink]="invoice.route">Open invoice detail</a>
              </article>
            </div>
            <ng-template #noInvoices>
              <div class="empty-panel compact-empty"><strong>No invoice links yet.</strong><span>Membership POS usage will create invoice snapshots.</span></div>
            </ng-template>
          </section>
        </div>

        <div class="two-grid">
          <section class="panel">
            <div class="section-title"><h2>Staff attribution</h2></div>
            <div class="quick-grid" *ngIf="staffAttribution().length; else noStaff">
              <article class="action-card" *ngFor="let actor of staffAttribution()">
                <strong>{{ actor.name || actor.userId || 'System' }}</strong>
                <span>{{ actor.role || 'user' }} · {{ actor.actions || 0 }} action{{ actor.actions === 1 ? '' : 's' }}</span>
                <span>{{ actor.sources?.join(', ') || 'membership activity' }}</span>
              </article>
            </div>
            <ng-template #noStaff>
              <div class="empty-panel compact-empty"><strong>No staff attribution yet.</strong><span>Actor IDs will show once staff/user is saved on ledger or audit rows.</span></div>
            </ng-template>
          </section>

          <section class="panel">
            <div class="section-title"><h2>Risk signals</h2></div>
            <div class="quick-grid" *ngIf="riskSignals().length; else noRisk">
              <article class="action-card risk-card" *ngFor="let risk of riskSignals()">
                <strong><span class="badge" [ngClass]="riskTone(risk)">{{ risk.riskLevel || 'low' }}</span> {{ label(risk.code) }}</strong>
                <span>{{ risk.reason }}</span>
                <small>{{ risk.suggestedAction }}</small>
              </article>
            </div>
            <ng-template #noRisk>
              <div class="empty-panel compact-empty"><strong>No risk signals.</strong><span>This membership currently has no detected payment, expiry or usage risk.</span></div>
            </ng-template>
          </section>
        </div>

        <div class="two-grid">
          <section class="panel">
            <div class="section-title"><h2>Audit trail</h2></div>
            <div class="quick-grid" *ngIf="auditTrail().length; else noAudit">
              <article class="action-card" *ngFor="let audit of auditTrail()">
                <strong>{{ label(audit.action) }}</strong>
                <span>{{ audit.createdAt | date: 'short' }} · {{ audit.actor?.label || audit.actorUserId || 'System' }}</span>
                <small *ngIf="audit.riskFlags?.length">{{ audit.riskFlags.length }} risk flag{{ audit.riskFlags.length === 1 ? '' : 's' }}</small>
              </article>
            </div>
            <ng-template #noAudit>
              <div class="empty-panel compact-empty"><strong>No audit rows yet.</strong><span>Lifecycle actions will append immutable audit records.</span></div>
            </ng-template>
          </section>

          <section class="panel">
            <div class="section-title"><h2>WhatsApp reminders</h2></div>
            <div class="quick-grid" *ngIf="whatsappReminders().length; else noReminders">
              <article class="action-card" *ngFor="let reminder of whatsappReminders()">
                <strong>{{ label(reminder.reminderType) }}</strong>
                <span>Due {{ reminder.dueOn || '-' }} · {{ reminder.status }}</span>
                <small>{{ reminder.message }}</small>
              </article>
            </div>
            <ng-template #noReminders>
              <div class="empty-panel compact-empty"><strong>No WhatsApp reminders.</strong><span>Renewal and auto-renew reminders will show here.</span></div>
            </ng-template>
          </section>
        </div>
      </ng-container>

      <ng-template #plan360View>
        <section class="stats-grid" *ngIf="metrics() as metric">
          <article class="metric-card"><span>Sold clients</span><strong>{{ metric.soldClients || 0 }}</strong><small>Unique clients</small></article>
          <article class="metric-card"><span>Active</span><strong>{{ metric.active || 0 }}</strong><small>Currently valid</small></article>
          <article class="metric-card"><span>Revenue</span><strong>{{ (metric.revenue || 0) | currency: 'INR':'symbol':'1.0-0' }}</strong><small>Sold, renewed, upgraded</small></article>
          <article class="metric-card"><span>Renewal risk</span><strong>{{ metric.renewalRisk || 0 }}</strong><small>Expiring soon</small></article>
        </section>

        <div class="two-grid" *ngIf="plan() as planData">
          <section class="panel">
            <div class="section-title"><h2>Plan details</h2></div>
            <div class="detail-grid">
              <div><span>Code</span><strong>{{ planData.code || '-' }}</strong></div>
              <div><span>Price</span><strong>{{ planData.price | currency: 'INR':'symbol':'1.0-0' }}</strong></div>
              <div><span>Service discount</span><strong>{{ planData.discountPercent }}%</strong></div>
              <div><span>Product discount</span><strong>{{ planData.productDiscountPercent || 0 }}%</strong></div>
              <div><span>Validity</span><strong>{{ planData.validityDays }} days</strong></div>
              <div><span>Status</span><strong>{{ planData.status }}</strong></div>
              <div><span>Plan type</span><strong>{{ label(planData.benefitRules?.planType) }}</strong></div>
              <div><span>Business label</span><strong>{{ planBusinessLabel(planData) }}</strong></div>
            </div>
          </section>
          <section class="panel">
            <div class="section-title"><h2>Benefit rules snapshot</h2></div>
            <pre class="json-preview">{{ planData.benefitRules | json }}</pre>
          </section>
        </div>

        <section class="panel">
          <div class="section-title"><h2>Sold client memberships</h2></div>
          <div class="table-wrap">
            <table>
              <thead><tr><th>Client</th><th>Plan</th><th>Status</th><th>Credits</th><th>Expiry</th><th>Price</th><th>360</th></tr></thead>
              <tbody>
                <tr *ngFor="let membership of memberships()">
                  <td>{{ membership.clientId }}</td>
                  <td>{{ membership.planName }}</td>
                  <td><span class="badge">{{ membership.status }}</span></td>
                  <td>{{ membership.creditsRemaining || 0 }} / {{ membership.planCredits || 0 }}</td>
                  <td>{{ membership.validityDate || '-' }}</td>
                  <td>{{ membership.price | currency: 'INR':'symbol':'1.0-0' }}</td>
                  <td><a [routerLink]="['/memberships', membership.id]">Open</a></td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <section class="panel">
          <div class="section-title"><h2>Membership wallet snapshots</h2></div>
          <div class="quick-grid" *ngIf="wallets().length; else noWalletSnapshots">
            <article class="action-card" *ngFor="let wallet of wallets()">
              <strong>{{ wallet.clientName || wallet.clientId }}</strong>
              <span>{{ wallet.activePlanName || 'No active benefits' }} · Wallet {{ wallet.walletBalance | currency: 'INR':'symbol':'1.0-0' }}</span>
              <span>Credits {{ wallet.serviceCredits?.remaining || 0 }} left / {{ wallet.serviceCredits?.used || 0 }} used · Product {{ wallet.productDiscount || wallet.productDiscountPercent || 0 }}%</span>
              <span>Packages {{ wallet.packageSummary?.activeCount || 0 }} · Expiry {{ wallet.expiryDate || '-' }} · Auto-renew {{ wallet.autoRenew ? 'On' : 'Off' }} · Family {{ wallet.familySharing?.status || 'not_shared' }}</span>
              <span>{{ fairUsageLabel(wallet) }} · {{ corporateLabel(wallet) }} · {{ tierLabel(wallet) }}</span>
            </article>
          </div>
          <ng-template #noWalletSnapshots>
            <div class="empty-panel">
              <strong>No wallet snapshots yet.</strong>
              <span>Client wallet updates appear here after membership sell, renew or upgrade.</span>
            </div>
          </ng-template>
        </section>

        <div class="two-grid">
          <section class="panel">
            <div class="section-title"><h2>Audit ledger</h2></div>
            <div class="quick-grid">
              <article class="action-card" *ngFor="let row of ledger()">
                <strong>{{ row.action }}</strong>
                <span>{{ row.createdAt | date: 'short' }} · {{ (row.paidAmount || row.amount) | currency: 'INR':'symbol':'1.0-0' }}</span>
                <span>{{ row.note || row.invoiceId || row.membershipId }}</span>
              </article>
            </div>
          </section>
          <section class="panel">
            <div class="section-title"><h2>Invoice snapshots</h2></div>
            <div class="quick-grid">
              <article class="action-card" *ngFor="let snapshot of snapshots()">
                <strong>{{ snapshot.invoiceId }}</strong>
                <span>Discount {{ snapshot.discountAmount | currency: 'INR':'symbol':'1.0-0' }} · Invoice {{ snapshot.invoiceTotal | currency: 'INR':'symbol':'1.0-0' }}</span>
                <span>{{ snapshot.createdAt | date: 'short' }}</span>
              </article>
            </div>
          </section>
        </div>
      </ng-template>
    </section>
  `,
  styles: [`
    .compact-hero p { max-width: 780px; }
    .profile-card {
      display: grid;
      gap: 8px;
      padding: 16px;
      border: 1px solid var(--border, #dbe3df);
      border-radius: 8px;
      background: #fff;
    }
    .profile-card strong { font-size: 1.15rem; }
    .profile-card span { color: #526176; }
    .timeline-list {
      display: grid;
      gap: 12px;
    }
    .timeline-event {
      display: grid;
      grid-template-columns: 16px minmax(0, 1fr) auto;
      gap: 14px;
      align-items: start;
      padding: 14px;
      border: 1px solid var(--border, #dbe3df);
      border-radius: 8px;
      background: #fff;
    }
    .timeline-event > div:nth-child(2) {
      display: grid;
      gap: 4px;
      min-width: 0;
    }
    .timeline-event span,
    .timeline-event small {
      color: #526176;
      overflow-wrap: anywhere;
    }
    .timeline-event a,
    .action-card a {
      color: #087f75;
      font-weight: 700;
      text-decoration: none;
    }
    .timeline-dot {
      width: 10px;
      height: 10px;
      margin-top: 5px;
      border-radius: 999px;
      background: #6b7280;
    }
    .timeline-dot.success { background: #0f8f71; }
    .timeline-dot.warning { background: #b7791f; }
    .timeline-dot.danger { background: #b42318; }
    .timeline-dot.info { background: #2563eb; }
    .risk-card .badge.high,
    .risk-card .badge.critical,
    .badge.high,
    .badge.critical { background: #fee2e2; color: #991b1b; }
    .badge.medium { background: #fef3c7; color: #92400e; }
    .badge.low { background: #e0f2fe; color: #075985; }
    @media (max-width: 760px) {
      .timeline-event { grid-template-columns: 12px minmax(0, 1fr); }
      .timeline-event > b { grid-column: 2; }
    }
  `]
})
export class Membership360Component implements OnInit {
  readonly data = signal<ApiRecord | null>(null);
  readonly loading = signal(true);
  readonly error = signal('');

  constructor(private readonly api: ApiService, private readonly route: ActivatedRoute) {}

  ngOnInit(): void {
    const id = this.route.snapshot.paramMap.get('id') || '';
    this.api.list<ApiRecord>(`membership-enterprise/memberships/${id}/360`).pipe(
      catchError(() => this.api.list<ApiRecord>(`membership-enterprise/plans/${id}/360`))
    ).subscribe({
      next: (data) => {
        this.data.set(data);
        this.loading.set(false);
      },
      error: (error) => {
        this.error.set(error?.error?.error || error?.message || 'Unable to load Membership 360');
        this.loading.set(false);
      }
    });
  }

  isMembershipProfile(): boolean {
    return this.data()?.['type'] === 'membership';
  }

  pageTitle(): string {
    if (this.isMembershipProfile()) {
      return `${this.client().name || this.client().id || 'Client'} - ${this.currentPlan().name || 'Membership'}`;
    }
    return String(this.plan()?.['name'] || 'Membership plan');
  }

  membershipProfile(): ApiRecord {
    return (this.data()?.['membershipProfile'] as ApiRecord) || {};
  }

  client(): ApiRecord {
    return (this.data()?.['client'] as ApiRecord) || {};
  }

  currentPlan(): ApiRecord {
    return (this.data()?.['currentPlan'] as ApiRecord) || {};
  }

  wallet(): ApiRecord {
    return (this.data()?.['wallet'] as ApiRecord) || {};
  }

  paymentHistory(): ApiRecord[] {
    return (this.data()?.['paymentHistory'] as ApiRecord[]) || [];
  }

  lifecycleTimeline(): ApiRecord[] {
    return (this.data()?.['lifecycleTimeline'] as ApiRecord[]) || [];
  }

  invoiceLinks(): ApiRecord[] {
    return (this.data()?.['invoiceLinks'] as ApiRecord[]) || [];
  }

  staffAttribution(): ApiRecord[] {
    return (this.data()?.['staffAttribution'] as ApiRecord[]) || [];
  }

  auditTrail(): ApiRecord[] {
    return (this.data()?.['auditTrail'] as ApiRecord[]) || [];
  }

  riskSignals(): ApiRecord[] {
    return (this.data()?.['riskSignals'] as ApiRecord[]) || [];
  }

  whatsappReminders(): ApiRecord[] {
    return (this.data()?.['whatsappReminders'] as ApiRecord[]) || [];
  }

  plan(): ApiRecord | null {
    return (this.data()?.['plan'] as ApiRecord) || null;
  }

  metrics(): ApiRecord {
    return (this.data()?.['metrics'] as ApiRecord) || {};
  }

  memberships(): ApiRecord[] {
    return (this.data()?.['memberships'] as ApiRecord[]) || [];
  }

  wallets(): ApiRecord[] {
    return (this.data()?.['wallets'] as ApiRecord[]) || [];
  }

  ledger(): ApiRecord[] {
    return (this.data()?.['ledger'] as ApiRecord[]) || [];
  }

  snapshots(): ApiRecord[] {
    return (this.data()?.['snapshots'] as ApiRecord[]) || [];
  }

  label(value: unknown): string {
    return String(value || '-').replace(/[_\-.]+/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
  }

  fairUsageLabel(wallet: ApiRecord): string {
    const rows = Array.isArray(wallet['fairUsage']) ? wallet['fairUsage'] as ApiRecord[] : [];
    const row = rows[0] || ((wallet['memberships'] as ApiRecord[] | undefined)?.find((item) => item['fairUsage'])?.['fairUsage'] as ApiRecord | undefined);
    if (!row || !Number(row['monthlyCap'] || 0)) return 'No cap';
    return `${row['monthlyUsed'] || 0}/${row['monthlyCap']} this month`;
  }

  corporateLabel(wallet: ApiRecord): string {
    const rows = Array.isArray(wallet['corporate']) ? wallet['corporate'] as ApiRecord[] : [];
    const corporate = rows[0] || ((wallet['memberships'] as ApiRecord[] | undefined)?.find((item) => item['corporate'])?.['corporate'] as ApiRecord | undefined);
    if (!corporate || !Object.keys(corporate).length) return 'Not linked';
    return `${corporate['label'] || corporate['domain'] || 'Corporate'}${corporate['employeeIdRequired'] ? ' ID required' : ''}`;
  }

  occasionBenefitLabel(wallet: ApiRecord): string {
    const rows = Array.isArray(wallet['occasionBenefits']) ? wallet['occasionBenefits'] as ApiRecord[] : [];
    const benefit = rows[0] || ((wallet['memberships'] as ApiRecord[] | undefined)?.find((item) => item['occasionBenefits'])?.['occasionBenefits'] as ApiRecord | undefined);
    if (!benefit || !Object.keys(benefit).length) return 'None';
    return [benefit['birthday'] ? 'Birthday' : '', benefit['anniversary'] ? 'Anniversary' : ''].filter(Boolean).join(' + ') || 'Configured';
  }

  tierLabel(wallet: ApiRecord): string {
    const rows = Array.isArray(wallet['tierSuggestions']) ? wallet['tierSuggestions'] as ApiRecord[] : [];
    const tier = rows[0] || ((wallet['memberships'] as ApiRecord[] | undefined)?.find((item) => item['tierSuggestion'])?.['tierSuggestion'] as ApiRecord | undefined);
    if (!tier || !Object.keys(tier).length) return 'No tier';
    return tier['eligible'] ? `${tier['tierName'] || 'Next tier'} ready` : `${tier['gapSpend'] || 0} spend gap`;
  }

  planBusinessLabel(plan: ApiRecord): string {
    const rules = (plan['benefitRules'] || {}) as ApiRecord;
    const planType = String(rules['planType'] || 'discount');
    const credits = Number(rules['creditAmount'] || 0);
    if (planType === 'prepaid_credit') return `Get ${(credits || 0).toLocaleString('en-IN')} credit`;
    if (planType === 'visit_pack') return `${credits || 10} visits`;
    if (planType === 'service_credit') return `${credits || 1} service credits`;
    if (planType === 'combo') return `${credits || 1} combo credits`;
    if (planType === 'unlimited') return `Unlimited ${Number((rules['fairUsage'] as ApiRecord | undefined)?.['monthlyCap'] || 4)} / month`;
    if (planType === 'family') return `Family ${Number((rules['family'] as ApiRecord | undefined)?.['memberLimit'] || 4)} members`;
    if (planType === 'corporate') return `Corporate ${(rules['corporate'] as ApiRecord | undefined)?.['label'] || plan['name'] || ''}`;
    if (planType === 'tiered') return `Tier ${(rules['tier'] as ApiRecord | undefined)?.['name'] || plan['name'] || ''}`;
    return `${plan['discountPercent'] || 0}% discount`;
  }

  eventTone(event: ApiRecord): string {
    const action = String(event['action'] || '').toLowerCase();
    if (action.includes('cancel') || action.includes('failed')) return 'danger';
    if (action.includes('renew') || action.includes('sold') || action.includes('upgrade')) return 'success';
    if (action.includes('reminder') || action.includes('whatsapp')) return 'info';
    if (action.includes('downgrade') || action.includes('risk')) return 'warning';
    return '';
  }

  riskTone(risk: ApiRecord): string {
    return String(risk['riskLevel'] || 'low').toLowerCase();
  }
}
