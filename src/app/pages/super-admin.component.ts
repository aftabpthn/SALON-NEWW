import { CommonModule, CurrencyPipe, DecimalPipe } from '@angular/common';
import { Component, OnInit, signal } from '@angular/core';
import { FormsModule, ReactiveFormsModule, UntypedFormBuilder, Validators } from '@angular/forms';
import { ApiRecord, ApiService } from '../core/api.service';
import { StateComponent } from '../shared/ui/state/state.component';
import { AuraKpiCardComponent } from '../shared/ui/aura-kpi-card/aura-kpi-card.component';

@Component({
  selector: 'app-super-admin',
  standalone: true,
  imports: [CommonModule, FormsModule, ReactiveFormsModule, CurrencyPipe, DecimalPipe, StateComponent, AuraKpiCardComponent],
  template: `
    <section class="page-stack">
      <div class="module-hero">
        <div>
          <span class="eyebrow">SaaS super admin</span>
          <h2>Manage salons, subscriptions, platform revenue, analytics and feature access</h2>
          <p>Global controls operate across all tenant data and persist audit, plan, toggle and analytics records.</p>
        </div>
        <button class="ghost-button" type="button" (click)="runAnalytics()">Run global analytics</button>
      </div>

      <app-state [loading]="loading()" [error]="error()"></app-state>

      <ng-container *ngIf="overview() as overview">
        <div class="metrics-grid">
          <aura-kpi-card tone="teal" target="/kpi-details/super-admin/salons"><span>Salons</span><strong>{{ overview.metrics.salons }}</strong><small>{{ overview.metrics.activeSalons }} active</small></aura-kpi-card>
          <aura-kpi-card tone="green" target="/kpi-details/super-admin/mrr"><span>MRR</span><strong>{{ overview.metrics.monthlyRecurringRevenue | currency: 'INR':'symbol':'1.0-0' }}</strong><small>{{ overview.metrics.meteredUsageRevenue | currency: 'INR':'symbol':'1.0-0' }} metered usage</small></aura-kpi-card>
          <aura-kpi-card tone="blue" target="/kpi-details/super-admin/tenant-sales"><span>Tenant sales</span><strong>{{ overview.metrics.transactionRevenue | currency: 'INR':'symbol':'1.0-0' }}</strong><small>Across salons</small></aura-kpi-card>
          <aura-kpi-card tone="red" target="/kpi-details/super-admin/suspended"><span>Suspended</span><strong>{{ overview.metrics.suspendedSalons }}</strong><small>Account risk</small></aura-kpi-card>
          <aura-kpi-card tone="amber" target="/kpi-details/super-admin/trials"><span>Trials</span><strong>{{ overview.metrics.trialSalons }}</strong><small>Trial system</small></aura-kpi-card>
          <aura-kpi-card tone="violet" target="/kpi-details/super-admin/health"><span>Health</span><strong>{{ overview.metrics.averageHealth | number: '1.0-1' }}</strong><small>Average score</small></aura-kpi-card>
        </div>

        <section class="panel" *ngIf="overview.revenueCommand as revenue">
          <div class="section-title">
            <div>
              <span class="eyebrow">Revenue command center</span>
              <h2>ARR, plan mix, revenue quality and billing risk</h2>
            </div>
          </div>
          <div class="quick-grid">
            <article class="action-card">
              <strong>{{ revenue.arr | currency: 'INR':'symbol':'1.0-0' }}</strong>
              <span>Annual recurring revenue</span>
            </article>
            <article class="action-card">
              <strong>{{ revenue.arpu | currency: 'INR':'symbol':'1.0-0' }}</strong>
              <span>Average revenue per active salon</span>
            </article>
            <article class="action-card">
              <strong>{{ revenue.revenueQuality | number: '1.0-1' }}%</strong>
              <span>MRR quality after outstanding exposure</span>
            </article>
            <article class="action-card">
              <strong>{{ revenue.outstanding | currency: 'INR':'symbol':'1.0-0' }}</strong>
              <span>Outstanding billing to collect</span>
            </article>
            <article class="action-card">
              <strong>{{ revenue.suspendedMrrAtRisk | currency: 'INR':'symbol':'1.0-0' }}</strong>
              <span>Suspended MRR at risk</span>
            </article>
            <article class="action-card">
              <strong>{{ revenue.trialMrr | currency: 'INR':'symbol':'1.0-0' }}</strong>
              <span>Trial MRR pipeline</span>
            </article>
          </div>

          <div class="dashboard-grid">
            <div class="activity-list">
              <article *ngFor="let plan of revenue.planMix" style="display:flex;align-items:center;justify-content:space-between;gap:12px">
                <div style="flex:1;min-width:0">
                  <strong>{{ plan.name }}</strong>
                  <span style="display:block;font-size:0.8em;color:var(--text-muted)">{{ plan.tenantCount }} salons · {{ plan.sharePct | number: '1.0-1' }}% MRR share · {{ plan.averageHealth | number: '1.0-1' }} health</span>
                </div>
                <div style="text-align:right;flex-shrink:0">
                  <strong>{{ plan.mrr | currency: 'INR':'symbol':'1.0-0' }}</strong>
                  <span style="display:block;font-size:0.78em;color:var(--text-muted)">{{ plan.arr | currency: 'INR':'symbol':'1.0-0' }} ARR</span>
                </div>
              </article>
            </div>

            <div class="activity-list">
              <article *ngFor="let tenant of revenue.topRevenueTenants" style="display:flex;align-items:center;justify-content:space-between;gap:12px">
                <div style="flex:1;min-width:0">
                  <strong>{{ tenant.name }}</strong>
                  <span style="display:block;font-size:0.8em;color:var(--text-muted)">{{ tenant.planName }} · {{ tenant.subscriptionStatus }} · {{ tenant.healthScore | number: '1.0-1' }} health</span>
                </div>
                <div style="text-align:right;flex-shrink:0">
                  <strong>{{ tenant.totalBillingAmount | currency: 'INR':'symbol':'1.0-0' }}</strong>
                  <span style="display:block;font-size:0.78em;color:var(--text-muted)">{{ tenant.transactionRevenue | currency: 'INR':'symbol':'1.0-0' }} sales</span>
                </div>
              </article>
            </div>
          </div>

          <div class="activity-list" style="margin-top:16px">
            <article *ngFor="let risk of revenue.revenueRisks" style="display:flex;align-items:center;justify-content:space-between;gap:12px">
              <div style="flex:1;min-width:0">
                <strong>{{ risk.tenantName }}</strong>
                <span style="display:block;font-size:0.8em;color:var(--text-muted)">{{ risk.reason }} · {{ risk.healthScore | number: '1.0-1' }} health</span>
              </div>
              <div style="display:flex;align-items:center;gap:8px;flex-shrink:0">
                <span class="badge" [style.background]="risk.severity === 'high' ? 'var(--danger,#dc2626)' : 'var(--warning,#f59e0b)'" style="color:#fff">{{ risk.severity }}</span>
                <strong>{{ risk.amountAtRisk | currency: 'INR':'symbol':'1.0-0' }}</strong>
              </div>
            </article>
          </div>
        </section>

        <section class="panel">
          <div class="section-title">
            <div>
              <span class="eyebrow">Global insights</span>
              <h2>Platform analytics</h2>
            </div>
          </div>
          <div class="quick-grid">
            <article class="action-card" *ngFor="let insight of overview.insights">
              <strong>{{ insight }}</strong>
              <span>Computed from persisted tenant, subscription, invoice and usage data</span>
            </article>
          </div>
        </section>

        <section class="panel">
          <div class="section-title"><h2>All salons</h2></div>
          <div class="table-wrap">
            <table>
              <thead>
                <tr><th>Salon</th><th>Plan</th><th>Status</th><th>Billing</th><th>Sales</th><th>Usage</th><th>Health</th><th></th></tr>
              </thead>
              <tbody>
                <tr *ngFor="let tenant of overview.tenants">
                  <td><strong>{{ tenant.name }}</strong><small>{{ tenant.ownerEmail }} · {{ tenant.primaryDomain }}</small></td>
                  <td>{{ tenant.planName }}</td>
                  <td><span class="badge">{{ tenant.subscriptionStatus }}</span></td>
                  <td>{{ tenant.totalBillingAmount | currency: 'INR':'symbol':'1.0-0' }}<small>{{ tenant.meteredUsageRevenue | currency: 'INR':'symbol':'1.0-0' }} usage</small></td>
                  <td>{{ tenant.transactionRevenue | currency: 'INR':'symbol':'1.0-0' }}</td>
                  <td>{{ tenant.usage.clients }} clients · {{ tenant.usage.appointments }} bookings</td>
                  <td>{{ tenant.healthScore | number: '1.0-1' }}</td>
                  <td>
                    <button class="ghost-button mini" type="button" (click)="toggleTenant(tenant)">
                      {{ tenant.subscriptionStatus === 'suspended' ? 'Reactivate' : 'Suspend' }}
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <div class="dashboard-grid">
          <section class="form-panel">
            <h3>Subscription management</h3>
            <form [formGroup]="subscriptionForm" (ngSubmit)="updateSubscription()">
              <label class="field">
                <span>Tenant</span>
                <select formControlName="tenantId">
                  <option value="">Select tenant</option>
                  <option *ngFor="let tenant of overview.tenants" [value]="tenant.id">{{ tenant.name }}</option>
                </select>
              </label>
              <label class="field">
                <span>Plan</span>
                <select formControlName="planId">
                  <option value="">Keep current</option>
                  <option *ngFor="let plan of overview.plans" [value]="plan.id">{{ plan.name }}</option>
                </select>
              </label>
              <label class="field">
                <span>Status</span>
                <select formControlName="status">
                  <option value="">Keep current</option>
                  <option value="trialing">Trialing</option>
                  <option value="active">Active</option>
                  <option value="suspended">Suspended</option>
                </select>
              </label>
              <div class="form-actions">
                <button class="primary-button" type="submit" [disabled]="subscriptionForm.invalid || saving()">Update subscription</button>
              </div>
            </form>
          </section>

          <section class="form-panel">
            <h3>Plan management</h3>
            <form [formGroup]="planForm" (ngSubmit)="createPlan()">
              <label class="field"><span>Name</span><input formControlName="name" /></label>
              <label class="field"><span>Code</span><input formControlName="code" /></label>
              <label class="field"><span>Monthly price</span><input type="number" formControlName="priceMonthly" /></label>
              <label class="field"><span>Trial days</span><input type="number" formControlName="trialDays" /></label>
              <label class="field full"><span>Features</span><textarea formControlName="featuresText"></textarea></label>
              <div class="form-actions">
                <button class="primary-button" type="submit" [disabled]="planForm.invalid || saving()">Create plan</button>
              </div>
            </form>
          </section>
        </div>

        <section class="form-panel">
          <h3>Feature toggles</h3>
          <form [formGroup]="toggleForm" (ngSubmit)="saveToggle()">
            <label class="field"><span>Key</span><input formControlName="key" /></label>
            <label class="field"><span>Name</span><input formControlName="name" /></label>
            <label class="field">
              <span>Scope</span>
              <select formControlName="scope">
                <option value="global">Global</option>
                <option value="tenant">Tenant</option>
                <option value="plan">Plan</option>
              </select>
            </label>
            <label class="field check-line"><input type="checkbox" formControlName="enabled" /><span>Enabled</span></label>
            <label class="field full"><span>Description</span><textarea formControlName="description"></textarea></label>
            <div class="form-actions"><button class="primary-button" type="submit" [disabled]="toggleForm.invalid || saving()">Save toggle</button></div>
          </form>
        </section>

        <section class="panel">
          <div class="section-title"><h2>Feature toggles and plans</h2></div>
          <div class="dashboard-grid">
            <div class="activity-list">
              <article *ngFor="let toggle of overview.featureToggles" style="display:flex;align-items:center;justify-content:space-between;gap:12px">
                <div style="flex:1;min-width:0">
                  <strong>{{ toggle.name }}</strong>
                  <span style="display:block;font-size:0.8em;color:var(--text-muted)">{{ toggle.key }} · {{ toggle.scope }}</span>
                  <span *ngIf="toggle.description" style="display:block;font-size:0.78em;color:var(--text-muted)">{{ toggle.description }}</span>
                </div>
                <div style="display:flex;align-items:center;gap:8px;flex-shrink:0">
                  <span class="badge" [style.background]="toggle.enabled ? 'var(--success,#16a34a)' : 'var(--muted,#6b7280)'" style="color:#fff">
                    {{ toggle.enabled ? 'ON' : 'OFF' }}
                  </span>
                  <button
                    type="button"
                    class="ghost"
                    style="padding:4px 10px;font-size:0.8em"
                    [disabled]="saving()"
                    (click)="toggleEnabled(toggle)">
                    {{ toggle.enabled ? 'Disable' : 'Enable' }}
                  </button>
                  <button
                    type="button"
                    style="padding:4px 8px;font-size:0.8em;background:none;border:1px solid var(--danger,#dc2626);color:var(--danger,#dc2626);border-radius:4px;cursor:pointer"
                    [disabled]="saving()"
                    (click)="deleteToggle(toggle)">
                    ✕
                  </button>
                </div>
              </article>
            </div>
            <div class="activity-list">
              <article *ngFor="let plan of overview.plans">
                <div>
                  <strong>{{ plan.name }}</strong>
                  <span>{{ plan.priceMonthly | currency: 'INR':'symbol':'1.0-0' }}/mo · {{ plan.trialDays }} trial days</span>
                </div>
                <span class="badge">{{ plan.status }}</span>
              </article>
            </div>
          </div>
        </section>
      </ng-container>
    </section>
  `
})
export class SuperAdminComponent implements OnInit {
  readonly overview = signal<ApiRecord | null>(null);
  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly error = signal('');

  readonly subscriptionForm = this.fb.group({
    tenantId: ['', Validators.required],
    planId: [''],
    status: ['']
  });

  readonly planForm = this.fb.group({
    name: ['', Validators.required],
    code: ['', Validators.required],
    priceMonthly: [9999],
    trialDays: [14],
    featuresText: ['Advanced CRM, Marketing automation, Analytics']
  });

  readonly toggleForm = this.fb.group({
    key: ['ai.marketing', Validators.required],
    name: ['Marketing automation', Validators.required],
    scope: ['global'],
    enabled: [true],
    description: ['Enable AI campaign generation and retargeting workflows.']
  });

  constructor(private readonly api: ApiService, private readonly fb: UntypedFormBuilder) {}

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.error.set('');
    this.api.list<ApiRecord>('super-admin/overview').subscribe({
      next: (overview) => {
        this.overview.set(overview);
        this.loading.set(false);
      },
      error: (error) => {
        this.error.set(error?.error?.error || 'Unable to load super admin overview. Select Super admin role.');
        this.loading.set(false);
      }
    });
  }

  runAnalytics(): void {
    this.saving.set(true);
    this.api.post('super-admin/analytics/run', {}).subscribe({
      next: () => {
        this.saving.set(false);
        this.load();
      },
      error: (error) => {
        this.error.set(error?.error?.error || 'Unable to run platform analytics');
        this.saving.set(false);
      }
    });
  }

  toggleTenant(tenant: ApiRecord): void {
    const status = tenant.subscriptionStatus === 'suspended' ? 'active' : 'suspended';
    this.api.patch(`super-admin/tenants/${tenant.id}/suspension`, { status, reason: 'Super admin console action' }).subscribe({
      next: () => this.load(),
      error: (error) => this.error.set(error?.error?.error || 'Unable to update tenant status')
    });
  }

  updateSubscription(): void {
    if (this.subscriptionForm.invalid) return;
    this.saving.set(true);
    const tenantId = this.subscriptionForm.value.tenantId;
    this.api.patch(`super-admin/tenants/${tenantId}/subscription`, {
      planId: this.subscriptionForm.value.planId,
      status: this.subscriptionForm.value.status
    }).subscribe({
      next: () => {
        this.saving.set(false);
        this.load();
      },
      error: (error) => {
        this.error.set(error?.error?.error || 'Unable to update subscription');
        this.saving.set(false);
      }
    });
  }

  createPlan(): void {
    if (this.planForm.invalid) return;
    this.saving.set(true);
    const features = String(this.planForm.value.featuresText || '').split(',').map((item) => item.trim()).filter(Boolean);
    this.api.post('super-admin/plans', {
      name: this.planForm.value.name,
      code: this.planForm.value.code,
      priceMonthly: this.planForm.value.priceMonthly,
      trialDays: this.planForm.value.trialDays,
      features,
      limits: { branches: 3, staff: 25, clients: 5000, monthlyAppointments: 8000, campaigns: 50 }
    }).subscribe({
      next: () => {
        this.saving.set(false);
        this.load();
      },
      error: (error) => {
        this.error.set(error?.error?.error || 'Unable to create plan');
        this.saving.set(false);
      }
    });
  }

  saveToggle(): void {
    if (this.toggleForm.invalid) return;
    this.saving.set(true);
    this.api.post('super-admin/feature-toggles', { ...this.toggleForm.value, rules: {} }).subscribe({
      next: () => {
        this.saving.set(false);
        this.load();
      },
      error: (error) => {
        this.error.set(error?.error?.error || 'Unable to save feature toggle');
        this.saving.set(false);
      }
    });
  }

  toggleEnabled(toggle: { id: string; enabled: number | boolean; name: string }): void {
    this.saving.set(true);
    this.api.patch(`super-admin/feature-toggles/${toggle.id}/enabled`, { enabled: !toggle.enabled }).subscribe({
      next: () => {
        this.saving.set(false);
        this.load();
      },
      error: (error) => {
        this.error.set(error?.error?.error || 'Unable to update toggle');
        this.saving.set(false);
      }
    });
  }

  deleteToggle(toggle: { id: string; name: string }): void {
    if (!confirm(`Delete feature toggle "${toggle.name}"?`)) return;
    this.saving.set(true);
    this.api.delete('super-admin/feature-toggles', toggle.id).subscribe({
      next: () => {
        this.saving.set(false);
        this.load();
      },
      error: (error) => {
        this.error.set(error?.error?.error || 'Unable to delete toggle');
        this.saving.set(false);
      }
    });
  }
}
