import { CommonModule } from '@angular/common';
import { Component, OnInit, signal } from '@angular/core';
import { ReactiveFormsModule, UntypedFormBuilder, Validators } from '@angular/forms';
import { ApiRecord, ApiService } from '../core/api.service';
import { AppStateService } from '../core/state/app-state.service';
import { StateComponent } from '../shared/ui/state/state.component';
import { AuraMoneyPipe } from '../shared/pipes/aura-money.pipe';
import { AuraDatePipe } from '../shared/pipes/aura-date.pipe';

type SaasViewKey = 'overview' | 'usage' | 'metering' | 'health' | 'features' | 'brand' | 'onboarding' | 'plans';

@Component({
  selector: 'app-saas-onboarding',
  standalone: true,
  imports: [AuraDatePipe, AuraMoneyPipe, CommonModule, ReactiveFormsModule, StateComponent],
  template: `
    <section class="saas-workspace">
      <div class="page-heading">
        <div>
          <h1>SaaS control plane</h1>
        </div>
        <label class="search-field">
          <span>Current tenant</span>
          <input [value]="context()?.tenant?.name || 'Tenant context loading'" readonly />
        </label>
      </div>

      <app-state [loading]="loading()" [error]="error()"></app-state>

      <ng-container *ngIf="context() as context">
        <div class="metric-strip">
          <article>
            <span>Current tenant</span>
            <strong>{{ context.tenant?.name || '-' }}</strong>
            <small>{{ context.tenant?.subscriptionStatus }} · {{ context.tenant?.slug }}</small>
          </article>
          <article>
            <span>Trial ends</span>
            <strong>{{ context.tenant?.trialEndsAt | auraDate:'date' }}</strong>
            <small>{{ context.plan?.name }} plan</small>
          </article>
          <article>
            <span>Primary domain</span>
            <strong>{{ context.tenant?.primaryDomain || 'Not mapped' }}</strong>
            <small>{{ context.domains?.length || 0 }} domain records</small>
          </article>
          <article>
            <span>Role scope</span>
            <strong>{{ context.access?.role }}</strong>
            <small>{{ context.access?.branchId || 'All permitted branches' }}</small>
          </article>
          <article>
            <span>Billing preview</span>
            <strong>{{ (context.billingPreview?.totalAmount || 0) | auraMoney:'1.0-0' }}</strong>
            <small>{{ (context.billingPreview?.baseAmount || 0) | auraMoney:'1.0-0' }} base + {{ (context.billingPreview?.usageAmount || 0) | auraMoney:'1.0-0' }} usage</small>
          </article>
          <article>
            <span>Tenant health</span>
            <strong>{{ context.tenantHealth?.score || 0 }}%</strong>
            <small>{{ context.tenantHealth?.status || 'Not checked' }}</small>
          </article>
        </div>

        <div class="saas-section-workspace">
          <aside class="saas-side-nav" aria-label="SaaS sections">
            <button
              class="saas-nav-card"
              type="button"
              *ngFor="let view of saasViews"
              [class.active]="activeSaasView() === view.key"
              (click)="setSaasView(view.key)"
            >
              <span class="saas-nav-icon">{{ view.icon }}</span>
              <span>
                <strong>{{ view.label }}</strong>
                <small>{{ view.description }}</small>
              </span>
              <em>{{ view.badge }}</em>
            </button>
          </aside>

          <main class="saas-detail">
        <section class="panel" *ngIf="visibleSaasView('usage')">
          <div class="section-title">
            <div>
              <h2>Plan consumption</h2>
            </div>
          </div>
          <div class="quick-grid">
            <article class="action-card" *ngFor="let item of usageRows(context.usage)">
              <strong>{{ item.label }}</strong>
              <span>{{ item.used }} used / {{ item.limit || 'unlimited' }} allowed</span>
              <div class="stage-track"><span [style.width.%]="item.percent"></span></div>
            </article>
          </div>
        </section>

        <section class="panel" *ngIf="visibleSaasView('metering')">
          <div class="section-title">
            <div>
              <h2>Current period metering</h2>
            </div>
            <small>{{ context.billingPreview?.periodStart }} · {{ context.billingPreview?.status }}</small>
          </div>
          <div class="quick-grid">
            <article class="action-card" *ngFor="let row of context.billingPreview?.usageRows || []">
              <strong>{{ row.label }}</strong>
              <span>{{ row.used }} used · {{ row.included }} included · {{ row.overage }} billable</span>
              <small>{{ row.amount | auraMoney:'1.0-0' }} usage amount</small>
            </article>
          </div>
        </section>

        <section class="panel" *ngIf="visibleSaasView('health')">
          <div class="section-title">
            <div>
              <h2>Tenant health, subscription limits and usage-based billing</h2>
            </div>
            <small>{{ context.usageBasedBilling?.invoiceMode }} · {{ context.usageBasedBilling?.status }}</small>
          </div>
          <div class="quick-grid">
            <article class="action-card" *ngFor="let signal of context.tenantHealth?.signals || []">
              <strong>{{ signal.label }}</strong>
              <span>{{ signal.score }}% · {{ signal.status }}</span>
            </article>
            <article class="action-card">
              <strong>Next invoice estimate</strong>
              <span>{{ (context.usageBasedBilling?.nextInvoiceEstimate || 0) | auraMoney:'1.0-0' }}</span>
              <small>{{ (context.usageBasedBilling?.projectedUsageAmount || 0) | auraMoney:'1.0-0' }} projected usage</small>
            </article>
          </div>
          <div class="activity-list" *ngIf="context.subscriptionLimits?.rows?.length">
            <article *ngFor="let row of context.subscriptionLimits.rows">
              <div>
                <strong>{{ row.metric }}</strong>
                <span>{{ row.used }} used / {{ row.limit || 'unlimited' }} · {{ row.remaining ?? 'unlimited' }} remaining</span>
              </div>
              <span class="badge">{{ row.status }}</span>
            </article>
          </div>
        </section>

        <section class="panel" *ngIf="visibleSaasView('features')">
          <div class="section-title">
            <div>
              <h2>Feature access for this tenant</h2>
            </div>
          </div>
          <div class="activity-list">
            <article *ngFor="let feature of context.featureAccess || []">
              <div>
                <strong>{{ feature.name }}</strong>
                <span>{{ feature.key }} · {{ feature.reason }}</span>
              </div>
              <span class="badge">{{ feature.allowed ? 'enabled' : 'locked' }}</span>
            </article>
          </div>
        </section>

        <section class="panel" *ngIf="visibleSaasView('brand')">
          <div class="section-title">
            <div>
              <h2>Brand, domain and theme setup</h2>
            </div>
            <small>{{ context.whiteLabelReadiness?.score || 0 }}% · {{ context.whiteLabelReadiness?.status }}</small>
          </div>
          <div class="quick-grid">
            <article class="action-card" *ngFor="let check of context.whiteLabelReadiness?.checks || []">
              <strong>{{ check.label }}</strong>
              <span>{{ check.evidence }}</span>
              <span class="badge">{{ check.status }}</span>
            </article>
          </div>
        </section>

      <div class="dashboard-grid workdesk" *ngIf="visibleSaasView('onboarding')">
        <section class="form-panel">
          <h3>Onboard a salon tenant</h3>
          <form [formGroup]="onboardingForm" (ngSubmit)="onboard()">
            <label class="field"><span>Salon name</span><input formControlName="salonName" /></label>
            <label class="field"><span>Slug</span><input formControlName="slug" placeholder="my-salon" /></label>
            <label class="field"><span>Owner name</span><input formControlName="ownerName" /></label>
            <label class="field"><span>Owner email</span><input type="email" formControlName="ownerEmail" /></label>
            <label class="field"><span>Main branch</span><input formControlName="branchName" /></label>
            <label class="field"><span>City</span><input formControlName="city" /></label>
            <label class="field"><span>GSTIN</span><input formControlName="gstin" /></label>
            <label class="field">
              <span>Plan</span>
              <select formControlName="planId">
                <option *ngFor="let plan of plans()" [value]="plan.id">{{ plan.name }} - {{ plan.priceMonthly | auraMoney:'1.0-0' }}/mo</option>
              </select>
            </label>
            <label class="field full"><span>Domain</span><input formControlName="domain" placeholder="salon.example.com" /></label>
            <div class="form-actions">
              <button class="primary-button" type="submit" [disabled]="onboardingForm.invalid || saving()">Create tenant</button>
            </div>
          </form>
        </section>

        <section class="form-panel">
          <h3>Domain mapping</h3>
          <form [formGroup]="domainForm" (ngSubmit)="addDomain()">
            <label class="field"><span>Domain</span><input formControlName="domain" placeholder="booking.salon.com" /></label>
            <label class="field check-line"><input type="checkbox" formControlName="isPrimary" /><span>Make primary domain</span></label>
            <button class="primary-button" type="submit" [disabled]="domainForm.invalid || saving()">Add domain</button>
          </form>

          <div class="activity-list" *ngIf="context.domains?.length">
            <article *ngFor="let domain of context.domains">
              <div>
                <strong>{{ domain.domain }}</strong>
                <span>{{ domain.status }} · {{ domain.isPrimary ? 'primary' : 'secondary' }}</span>
              </div>
              <button class="ghost-button mini" type="button" (click)="verifyDomain(domain.id)" *ngIf="domain.status !== 'verified'">Verify</button>
            </article>
          </div>
        </section>
      </div>

      <section class="panel" *ngIf="visibleSaasView('plans')">
        <div class="section-title">
          <div>
            <h2>Trial and plan catalogue</h2>
          </div>
        </div>
        <div class="quick-grid">
          <article class="action-card" *ngFor="let plan of plans()">
            <strong>{{ plan.name }}</strong>
            <span>{{ plan.priceMonthly | auraMoney:'1.0-0' }}/month · {{ plan.trialDays }} day trial</span>
            <small>{{ plan.features?.join(', ') }}</small>
            <button class="ghost-button mini" type="button" (click)="switchPlan(plan.id)">Switch current tenant</button>
          </article>
        </div>
      </section>
          </main>
        </div>
      </ng-container>
    </section>
  `,
  styles: [`
    .saas-workspace { display: grid; gap: 8px; padding: 8px; color: #1d2430; background: #f0f2f5; min-height: calc(100vh - 20px); }
    .command-bar { display: flex; justify-content: space-between; align-items: center; gap: 16px; padding: 14px 20px; background: #111827; color: #fff; border-bottom: 1px solid #d8e1ea; }
    .brand-block, .top-actions, .center-line, .header-actions, .form-actions, .check-line { display: flex; align-items: center; gap: 10px; }
    .brand-mark { width: 34px; height: 34px; display: grid; place-items: center; border-radius: 8px; background: #6d5bd0; color: #fff; font-weight: 900; }
    .brand-block small, .field span, .search-field span, .section-title span { display: block; color: #5f6f85; font-size: 11px; font-weight: 800; text-transform: uppercase; }
    .brand-block small { color: #8fa1b8; }
    .brand-block strong { display: block; color: #fff; font-size: 15px; }
    .zenoti-button, .primary-button, .ghost-button { border: 1px solid #b9cbe0; background: #fff; color: #0065a8; border-radius: 3px; padding: 8px 13px; font-weight: 800; cursor: pointer; }
    .zenoti-button.primary, .primary-button { background: #55173D; border-color: #55173D; color: #fff; }
    .zenoti-header { background: #fff; display: grid; gap: 10px; padding: 18px 16px 12px; }
    .page-heading { background: #fff; border: 1px solid #d8e1ea; }
    .metric-strip { background: #fff; border: 1px solid #d8e1ea; }
    .saas-section-workspace { display: grid; grid-template-columns: minmax(260px, 320px) minmax(0, 1fr); gap: 14px; align-items: start; }
    .saas-side-nav { position: sticky; top: 92px; display: grid; gap: 10px; }
    .saas-nav-card { display: grid; grid-template-columns: 44px minmax(0, 1fr) auto; gap: 11px; align-items: center; width: 100%; min-height: 92px; padding: 13px; border: 1px solid #d8e1ea; border-left: 4px solid #55173D; border-radius: 8px; background: #fff; color: #172033; text-align: left; box-shadow: 0 10px 24px rgba(15,23,42,.06); cursor: pointer; }
    .saas-nav-card:hover, .saas-nav-card.active { background: linear-gradient(135deg, #F8EEF4, #FAF8F6); border-color: #D4C0CF; transform: translateY(-1px); }
    .saas-nav-icon { display: grid; place-items: center; width: 44px; height: 44px; border-radius: 8px; background: #F1E8EE; color: #3D0F2C; font-weight: 950; font-size: 12px; }
    .saas-nav-card strong, .saas-nav-card small { display: block; }
    .saas-nav-card small { margin-top: 4px; color: #5f6f85; font-size: 12px; font-weight: 700; line-height: 1.3; }
    .saas-nav-card em { align-self: start; padding: 4px 7px; border-radius: 999px; background: #F1E8EE; color: #3D0F2C; font-size: 10px; font-style: normal; font-weight: 900; text-transform: uppercase; }
    .saas-detail { display: grid; gap: 8px; min-width: 0; }    .panel, .form-panel { background: #fff; border: 1px solid #d8e1ea; }
    .center-line { justify-content: space-between; }
    .center-line strong { font-size: 15px; }
    .command-select { width: 100%; padding: 9px 12px; border: 1px solid #b9cbe0; border-radius: 3px; color: #111827; font-weight: 800; background: #fff; }
    .page-heading { display: flex; justify-content: space-between; gap: 16px; padding: 16px; align-items: end; }
    .page-heading h1 { margin: 0; font-size: 22px; color: #172033; }
    .page-heading p { margin: 6px 0 0; color: #36506d; font-size: 13px; }
    .search-field { width: min(100%, 350px); display: grid; gap: 5px; }
    .search-field input, .field input, .field select { width: 100%; border: 1px solid #cbd8e5; border-radius: 3px; padding: 9px 11px; font: inherit; background: #fff; color: #172033; }
    .metric-strip { display: grid; grid-template-columns: repeat(6, minmax(155px, 1fr)); gap: 0; overflow-x: auto; background: #fff; border-left: 1px solid #d8e1ea; border-right: 1px solid #d8e1ea; border-bottom: 1px solid #d8e1ea; }
    .metric-strip article { min-width: 155px; padding: 13px 16px; border-right: 1px solid #d8e1ea; border-top: 3px solid #55173D; }
    .metric-strip article:nth-child(2) { border-top-color: #bd7400; }
    .metric-strip article:nth-child(3) { border-top-color: #2b61d1; }
    .metric-strip article:nth-child(4) { border-top-color: #16834f; }
    .metric-strip article:nth-child(5) { border-top-color: #7046d8; }
    .metric-strip article:nth-child(6) { border-top-color: #bb241a; }
    .metric-strip span, .metric-strip small, .action-card small, .activity-list span { display: block; color: #5f6f85; font-size: 12px; }
    .metric-strip strong { display: block; margin: 6px 0 2px; color: #172033; font-size: 24px; overflow-wrap: anywhere; }
    .panel, .form-panel { border-radius: 0; box-shadow: none; padding: 16px; }
    .section-title { display: flex; justify-content: space-between; gap: 12px; align-items: end; margin-bottom: 12px; }
    .section-title h2, .form-panel h3 { margin: 3px 0 0; color: #172033; font-size: 18px; }
    .quick-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 10px; }
    .action-card { border: 1px solid #d8e1ea; border-radius: 0; background: #fbfcfe; padding: 12px; display: grid; gap: 6px; }
    .activity-list { display: grid; gap: 0; border: 1px solid #d8e1ea; background: #fff; }
    .activity-list article { display: flex; justify-content: space-between; gap: 12px; padding: 12px; border-bottom: 1px solid #dfe7ef; }
    .activity-list article:last-child { border-bottom: 0; }
    .dashboard-grid { display: grid; grid-template-columns: minmax(420px, 1.2fr) minmax(320px, .8fr); gap: 0; border-bottom: 1px solid #d8e1ea; }
    .dashboard-grid .form-panel:first-child { border-right: 1px solid #d8e1ea; }
    form { display: grid; grid-template-columns: repeat(2, minmax(180px, 1fr)); gap: 10px; }
    .field { display: grid; gap: 5px; }
    .field.full, .form-actions { grid-column: 1 / -1; }
    .form-actions { justify-content: flex-end; }
    .badge { display: inline-flex; width: max-content; padding: 4px 9px; border-radius: 999px; background: #FBF0E8; color: #7A4A28; font-weight: 800; font-size: 12px; }
    .stage-track { height: 7px; border-radius: 999px; background: #e5edf3; overflow: hidden; }
    .stage-track span { display: block; height: 100%; background: #55173D; }
    app-state { display: block; }
    @media (max-width: 1050px) {
      .saas-section-workspace, .dashboard-grid { grid-template-columns: 1fr; }
      .saas-side-nav { position: static; grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .dashboard-grid .form-panel:first-child { border-right: 0; }
      .metric-strip { grid-template-columns: repeat(2, minmax(155px, 1fr)); }
    }
    @media (max-width: 760px) {
      .command-bar, .page-heading, .center-line, .section-title, .activity-list article { display: grid; align-items: start; }
      .top-actions, .header-actions, .form-actions { flex-wrap: wrap; }
      .search-field { width: 100%; }
      .saas-section-workspace, .saas-side-nav, .metric-strip, form { grid-template-columns: 1fr; }
    }
  `]
})
export class SaasOnboardingComponent implements OnInit {
  readonly context = signal<ApiRecord | null>(null);
  readonly plans = signal<ApiRecord[]>([]);
  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly error = signal('');
  readonly activeSaasView = signal<SaasViewKey>('overview');
  readonly saasViews: Array<{ key: SaasViewKey; label: string; description: string; icon: string; badge: string }> = [
    { key: 'overview', label: 'Overview', description: 'All SaaS control sections', icon: 'OV', badge: 'All' },
    { key: 'usage', label: 'Plan usage', description: 'Subscription consumption', icon: 'PU', badge: 'Use' },
    { key: 'metering', label: 'Metering', description: 'Current billing period', icon: 'MT', badge: 'Bill' },
    { key: 'health', label: 'Health', description: 'Limits and tenant score', icon: 'HT', badge: 'Risk' },
    { key: 'features', label: 'Features', description: 'Feature access control', icon: 'FA', badge: 'Gate' },
    { key: 'brand', label: 'Brand setup', description: 'Domain and white-label status', icon: 'BD', badge: 'DNS' },
    { key: 'onboarding', label: 'Onboarding', description: 'Create tenant and map domain', icon: 'ON', badge: 'New' },
    { key: 'plans', label: 'Plans', description: 'Trial and plan catalogue', icon: 'PL', badge: 'SaaS' }
  ];
  readonly onboardingForm = this.fb.group({
    salonName: ['', Validators.required],
    slug: [''],
    ownerName: [''],
    ownerEmail: ['', Validators.required],
    branchName: ['Main Branch'],
    city: [''],
    gstin: [''],
    planId: ['plan_starter'],
    domain: ['']
  });

  readonly domainForm = this.fb.group({
    domain: ['', Validators.required],
    isPrimary: [false]
  });

  constructor(
    private readonly api: ApiService,
    private readonly fb: UntypedFormBuilder,
    private readonly state: AppStateService
  ) {}

  ngOnInit(): void {
    this.load();
  }

  setSaasView(view: SaasViewKey): void {
    this.activeSaasView.set(view);
  }

  visibleSaasView(view: SaasViewKey): boolean {
    return this.activeSaasView() === 'overview' || this.activeSaasView() === view;
  }
  load(): void {
    this.loading.set(true);
    this.error.set('');
    Promise.all([
      this.api.list<ApiRecord>('saas/context').toPromise(),
      this.api.list<ApiRecord[]>('saas/plans').toPromise()
    ])
      .then(([context, plans]) => {
        this.context.set(context || null);
        this.plans.set(plans || []);
        if (!this.onboardingForm.value.planId && plans?.[0]?.id) this.onboardingForm.patchValue({ planId: plans[0].id });
        this.loading.set(false);
      })
      .catch((error) => {
        this.error.set(error?.error?.error || 'Unable to load SaaS context');
        this.loading.set(false);
      });
  }

  onboard(): void {
    if (this.onboardingForm.invalid) return;
    this.saving.set(true);
    this.api.post<ApiRecord>('saas/onboarding', this.onboardingForm.value).subscribe({
      next: (result) => {
        this.state.setTenant(result.tenant.id);
        this.saving.set(false);
        this.load();
      },
      error: (error) => {
        this.error.set(error?.error?.error || 'Unable to create tenant');
        this.saving.set(false);
      }
    });
  }

  addDomain(): void {
    if (this.domainForm.invalid) return;
    this.saving.set(true);
    this.api.post('saas/domain-mappings', this.domainForm.value).subscribe({
      next: () => {
        this.saving.set(false);
        this.load();
      },
      error: (error) => {
        this.error.set(error?.error?.error || 'Unable to add domain');
        this.saving.set(false);
      }
    });
  }

  verifyDomain(domainId: string): void {
    this.api.post(`saas/domain-mappings/${domainId}/verify`, {}).subscribe({
      next: () => this.load(),
      error: (error) => this.error.set(error?.error?.error || 'Unable to verify domain')
    });
  }

  switchPlan(planId: string): void {
    this.api.patch('saas/subscription', { planId }).subscribe({
      next: () => this.load(),
      error: (error) => this.error.set(error?.error?.error || 'Unable to switch plan')
    });
  }

  runQuickAction(event: Event): void {
    const select = event.target as HTMLSelectElement;
    const action = select.value;
    if (action === 'refresh') this.load();
    if (action === 'tenant') this.onboard();
    if (action === 'domain') this.addDomain();
    if (action === 'starter' && this.plans()[0]?.id) this.switchPlan(String(this.plans()[0].id));
    select.selectedIndex = 0;
  }

  usageRows(usage: ApiRecord = {}): Array<{ label: string; used: number; limit: number | null; percent: number }> {
    return Object.entries(usage).map(([label, value]: [string, any]) => ({
      label,
      used: Number(value.used || 0),
      limit: value.limit ?? null,
      percent: value.limit ? Math.min(100, Math.round((Number(value.used || 0) / Number(value.limit)) * 100)) : 12
    }));
  }
}



