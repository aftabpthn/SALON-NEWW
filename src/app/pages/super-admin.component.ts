import { CommonModule, CurrencyPipe, DecimalPipe } from '@angular/common';
import { Component, OnInit, computed, signal } from '@angular/core';
import { FormsModule, ReactiveFormsModule, UntypedFormBuilder, Validators } from '@angular/forms';
import { ApiRecord, ApiService } from '../core/api.service';
import { AuthSessionService } from '../core/auth-session.service';
import { AppStateService } from '../core/state/app-state.service';
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

        <section class="panel" *ngIf="overview.saasHealthEngine as health">
          <div class="section-title">
            <div>
              <span class="eyebrow">SaaS health engine</span>
              <h2>Platform health, tenant segments and recovery playbooks</h2>
            </div>
            <span class="badge" [style.background]="healthTone(health.platformScore)" style="color:#fff">Grade {{ health.grade }}</span>
          </div>
          <div class="quick-grid">
            <article class="action-card">
              <strong>{{ health.platformScore | number: '1.0-1' }}</strong>
              <span>Platform health score</span>
            </article>
            <article class="action-card">
              <strong>{{ health.segments.healthy }}</strong>
              <span>Healthy tenants</span>
            </article>
            <article class="action-card">
              <strong>{{ health.segments.watch }}</strong>
              <span>Watch tenants</span>
            </article>
            <article class="action-card">
              <strong>{{ health.segments.critical }}</strong>
              <span>Critical tenants</span>
            </article>
            <article class="action-card">
              <strong>{{ health.segments.trialing }}</strong>
              <span>Trialing tenants</span>
            </article>
            <article class="action-card">
              <strong>{{ health.segments.suspended }}</strong>
              <span>Suspended tenants</span>
            </article>
          </div>

          <div class="dashboard-grid">
            <div class="activity-list">
              <article *ngFor="let signal of health.signals" style="display:flex;align-items:center;justify-content:space-between;gap:12px">
                <div style="flex:1;min-width:0">
                  <strong>{{ signal.label }}</strong>
                  <span style="display:block;font-size:0.8em;color:var(--text-muted)">{{ signal.detail }}</span>
                  <span style="display:block;height:6px;background:var(--surface-muted,#e5e7eb);border-radius:999px;margin-top:8px;overflow:hidden">
                    <span [style.width.%]="signal.score" [style.background]="healthTone(signal.score)" style="display:block;height:100%"></span>
                  </span>
                </div>
                <div style="display:flex;align-items:center;gap:8px;flex-shrink:0">
                  <span class="badge" [style.background]="signal.status === 'critical' ? 'var(--danger,#dc2626)' : signal.status === 'watch' ? 'var(--warning,#f59e0b)' : 'var(--success,#16a34a)'" style="color:#fff">{{ signal.status }}</span>
                  <strong>{{ signal.score | number: '1.0-1' }}</strong>
                </div>
              </article>
            </div>

            <div class="activity-list">
              <article *ngFor="let tenant of health.watchlist" style="display:flex;align-items:center;justify-content:space-between;gap:12px">
                <div style="flex:1;min-width:0">
                  <strong>{{ tenant.name }}</strong>
                  <span style="display:block;font-size:0.8em;color:var(--text-muted)">{{ tenant.planName }} · {{ tenant.subscriptionStatus }} · {{ tenant.nextAction }}</span>
                </div>
                <div style="display:flex;align-items:center;gap:8px;flex-shrink:0">
                  <span class="badge" [style.background]="healthTone(tenant.healthScore)" style="color:#fff">{{ tenant.healthScore | number: '1.0-1' }}</span>
                  <button class="ghost-button mini" type="button" (click)="selectTenant(tenant.id)">Open 360</button>
                </div>
              </article>
            </div>
          </div>

          <div class="quick-grid" style="margin-top:16px">
            <article class="action-card" *ngFor="let playbook of health.playbooks">
              <strong>{{ playbook.title }}</strong>
              <span>{{ playbook.detail }}</span>
            </article>
          </div>
        </section>

        <section class="panel" *ngIf="overview.realtimeHealthAlerts as alerts">
          <div class="section-title">
            <div>
              <span class="eyebrow">Real-time health alerts</span>
              <h2>Critical tenant alerts ready for websocket broadcast</h2>
            </div>
            <button class="ghost-button" type="button" [disabled]="saving() || !alerts.length" (click)="broadcastHealthAlerts()">Broadcast alerts</button>
          </div>
          <div class="activity-list">
            <article *ngFor="let alert of alerts" style="display:flex;align-items:center;justify-content:space-between;gap:12px">
              <div style="flex:1;min-width:0">
                <strong>{{ alert.title }}</strong>
                <span style="display:block;font-size:0.8em;color:var(--text-muted)">{{ alert.tenantName }} · {{ alert.message }}</span>
              </div>
              <span class="badge" [style.background]="alert.severity === 'critical' ? 'var(--danger,#dc2626)' : 'var(--warning,#f59e0b)'" style="color:#fff">{{ alert.severity }}</span>
            </article>
            <article *ngIf="!alerts.length">
              <div>
                <strong>No live health alerts</strong>
                <span>Critical billing, health and suspension alerts will appear here.</span>
              </div>
            </article>
          </div>
        </section>

        <section class="panel" *ngIf="overview.actionSafetyCommand as safety">
          <div class="section-title">
            <div>
              <span class="eyebrow">Action safety</span>
              <h2>Dangerous actions require reason, confirmation and audit trail</h2>
            </div>
          </div>
          <div class="quick-grid">
            <article class="action-card">
              <strong>{{ safety.stats.pending }}</strong>
              <span>Pending approvals</span>
            </article>
            <article class="action-card">
              <strong>{{ safety.stats.requiredReviews }}</strong>
              <span>Required safety reviews</span>
            </article>
            <article class="action-card">
              <strong>{{ safety.stats.recentActions }}</strong>
              <span>Recent audit actions</span>
            </article>
          </div>

          <div class="dashboard-grid">
            <section class="form-panel">
              <h3>Safety confirmation</h3>
              <form [formGroup]="safetyForm">
                <label class="field full"><span>Reason</span><textarea formControlName="reason"></textarea></label>
                <label class="field"><span>Type CONFIRM</span><input formControlName="confirmation" /></label>
              </form>
            </section>

            <section class="form-panel">
              <h3>Approval request</h3>
              <form [formGroup]="approvalForm" (ngSubmit)="requestApproval()">
                <label class="field">
                  <span>Action</span>
                  <select formControlName="action">
                    <option value="tenant.suspension">Tenant suspension</option>
                    <option value="tenant.reactivation">Tenant reactivation</option>
                    <option value="subscription.plan_change">Subscription plan change</option>
                    <option value="feature.kill_switch">Feature kill switch</option>
                  </select>
                </label>
                <label class="field">
                  <span>Target type</span>
                  <select formControlName="targetType">
                    <option value="tenant">Tenant</option>
                    <option value="feature_toggle">Feature toggle</option>
                    <option value="subscription_plan">Subscription plan</option>
                  </select>
                </label>
                <label class="field"><span>Target ID</span><input formControlName="targetId" /></label>
                <label class="field">
                  <span>Priority</span>
                  <select formControlName="priority">
                    <option value="high">High</option>
                    <option value="medium">Medium</option>
                    <option value="low">Low</option>
                  </select>
                </label>
                <label class="field full"><span>Approval reason</span><textarea formControlName="reason"></textarea></label>
                <label class="field"><span>Type CONFIRM</span><input formControlName="confirmation" /></label>
                <div class="form-actions">
                  <button class="primary-button" type="submit" [disabled]="approvalForm.invalid || saving()">Request approval</button>
                </div>
              </form>
            </section>
          </div>

          <div class="dashboard-grid" style="margin-top:16px">
            <div class="activity-list">
              <article *ngFor="let approval of safety.pendingApprovals" style="display:flex;align-items:center;justify-content:space-between;gap:12px">
                <div style="flex:1;min-width:0">
                  <strong>{{ approval.action }}</strong>
                  <span style="display:block;font-size:0.8em;color:var(--text-muted)">{{ approval.targetType }} · {{ approval.targetId }} · {{ approval.reason }}</span>
                </div>
                <div style="display:flex;align-items:center;gap:8px;flex-shrink:0">
                  <span class="badge">{{ approval.priority }}</span>
                  <button class="ghost-button mini" type="button" [disabled]="saving()" (click)="resolveApproval(approval.id, 'approved')">Approve</button>
                  <button class="ghost-button mini" type="button" [disabled]="saving()" (click)="resolveApproval(approval.id, 'rejected')">Reject</button>
                </div>
              </article>
              <article *ngIf="!safety.pendingApprovals.length">
                <div>
                  <strong>No pending approvals</strong>
                  <span>New dangerous requests will appear here.</span>
                </div>
              </article>
            </div>

            <div class="activity-list">
              <article *ngFor="let event of safety.timeline">
                <div>
                  <strong>{{ event.action }}</strong>
                  <span>{{ event.targetType }} · {{ event.targetId }} · {{ event.reason || event.summary || event.status }}</span>
                </div>
                <small>{{ event.createdAt }}</small>
              </article>
            </div>
          </div>
        </section>

        <section class="panel" *ngIf="overview.actionSafetyCommand as safety">
          <div class="section-title">
            <div>
              <span class="eyebrow">Super-admin audit log</span>
              <h2>Who did what, when, and on which target</h2>
            </div>
          </div>
          <div class="table-wrap">
            <table>
              <thead>
                <tr><th>Time</th><th>Actor</th><th>Action</th><th>Target</th><th>Reason / Summary</th></tr>
              </thead>
              <tbody>
                <tr *ngFor="let event of safety.timeline">
                  <td>{{ event.createdAt }}</td>
                  <td>{{ event.actorUserId }}</td>
                  <td>{{ event.action }}</td>
                  <td>{{ event.targetType }} · {{ event.targetId }}</td>
                  <td>{{ event.reason || event.summary || event.status || 'Recorded' }}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <section class="panel" *ngIf="selectedTenant() as tenant">
          <div class="section-title">
            <div>
              <span class="eyebrow">Tenant 360</span>
              <h2>{{ tenant.name }} account health, billing risk and adoption</h2>
            </div>
            <label class="field" style="max-width:280px;margin:0">
              <span>Selected salon</span>
              <select [ngModel]="selectedTenantId()" (ngModelChange)="selectTenant($event)">
                <option *ngFor="let item of overview.tenants" [value]="item.id">{{ item.name }}</option>
              </select>
            </label>
          </div>

          <div class="quick-grid">
            <article class="action-card">
              <strong>{{ tenant.healthScore | number: '1.0-1' }}</strong>
              <span>Overall account health</span>
            </article>
            <article class="action-card">
              <strong>{{ tenant.tenant360.alertSummary.high }}</strong>
              <span>High-risk alerts</span>
            </article>
            <article class="action-card">
              <strong>{{ tenant.outstanding | currency: 'INR':'symbol':'1.0-0' }}</strong>
              <span>Outstanding billing exposure</span>
            </article>
            <article class="action-card">
              <strong>{{ tenant.monthlyRecurringRevenue | currency: 'INR':'symbol':'1.0-0' }}</strong>
              <span>Monthly recurring revenue</span>
            </article>
            <article class="action-card">
              <strong>{{ tenant.usage.clients }}</strong>
              <span>Clients using the tenant</span>
            </article>
            <article class="action-card">
              <strong>{{ tenant.usage.appointments }}</strong>
              <span>Appointment adoption</span>
            </article>
          </div>

          <div class="dashboard-grid">
            <div class="activity-list">
              <article>
                <div>
                  <strong>Account profile</strong>
                  <span>{{ tenant.ownerEmail }} · {{ tenant.primaryDomain || 'Domain pending' }}</span>
                </div>
                <span class="badge">{{ tenant.subscriptionStatus }}</span>
              </article>
              <article>
                <div>
                  <strong>{{ tenant.planName }}</strong>
                  <span>{{ tenant.status }} · trial ends {{ tenant.trialEndsAt || 'not set' }}</span>
                </div>
                <span class="badge">{{ tenant.tenant360.profile.trialDaysLeft ?? 'NA' }} days</span>
              </article>
              <article>
                <div>
                  <strong>Billing mix</strong>
                  <span>{{ tenant.meteredUsageRevenue | currency: 'INR':'symbol':'1.0-0' }} usage · {{ tenant.transactionRevenue | currency: 'INR':'symbol':'1.0-0' }} tenant sales</span>
                </div>
                <strong>{{ tenant.totalBillingAmount | currency: 'INR':'symbol':'1.0-0' }}</strong>
              </article>
            </div>

            <div class="activity-list">
              <article *ngFor="let score of tenantHealthRows(tenant)" style="display:flex;align-items:center;justify-content:space-between;gap:12px">
                <div style="flex:1;min-width:0">
                  <strong>{{ score.label }}</strong>
                  <span style="display:block;height:6px;background:var(--surface-muted,#e5e7eb);border-radius:999px;margin-top:8px;overflow:hidden">
                    <span [style.width.%]="score.value" style="display:block;height:100%;background:var(--accent,#2563eb)"></span>
                  </span>
                </div>
                <strong>{{ score.value | number: '1.0-1' }}</strong>
              </article>
            </div>
          </div>

          <div class="dashboard-grid" style="margin-top:16px">
            <div class="activity-list">
              <article *ngFor="let alert of tenant.tenant360.alerts" style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px">
                <div style="flex:1;min-width:0">
                  <strong>{{ alert.title }}</strong>
                  <span style="display:block;font-size:0.8em;color:var(--text-muted)">{{ alert.message }}</span>
                </div>
                <span class="badge" [style.background]="alert.severity === 'high' ? 'var(--danger,#dc2626)' : alert.severity === 'medium' ? 'var(--warning,#f59e0b)' : 'var(--muted,#6b7280)'" style="color:#fff">{{ alert.severity }}</span>
              </article>
              <article *ngIf="!tenant.tenant360.alerts.length">
                <div>
                  <strong>No open risk alerts</strong>
                  <span>Tenant is clear for normal monitoring.</span>
                </div>
                <span class="badge">healthy</span>
              </article>
            </div>

            <div class="activity-list">
              <article *ngFor="let action of tenant.tenant360.recommendedActions">
                <div>
                  <strong>{{ action }}</strong>
                  <span>Recommended super-admin follow-up</span>
                </div>
              </article>
            </div>
          </div>
        </section>

        <section class="panel" *ngIf="overview.tenantRiskCommand as riskCommand">
          <div class="section-title">
            <div>
              <span class="eyebrow">Risk alerts</span>
              <h2>{{ riskCommand.alertCount }} tenant alerts across the SaaS base</h2>
            </div>
          </div>
          <div class="activity-list">
            <article *ngFor="let risk of riskCommand.highRiskTenants" style="display:flex;align-items:center;justify-content:space-between;gap:12px">
              <div style="flex:1;min-width:0">
                <strong>{{ risk.name }}</strong>
                <span style="display:block;font-size:0.8em;color:var(--text-muted)">{{ risk.topAlert?.title || 'Health review' }} · {{ risk.healthScore | number: '1.0-1' }} health</span>
              </div>
              <div style="display:flex;align-items:center;gap:8px;flex-shrink:0">
                <span class="badge" style="background:var(--danger,#dc2626);color:#fff">{{ risk.alerts.high }} high</span>
                <button class="ghost-button mini" type="button" (click)="selectTenant(risk.id)">Open 360</button>
              </div>
            </article>
          </div>
        </section>

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

        <section class="panel" *ngIf="overview.revenueIntelligence as intel">
          <div class="section-title">
            <div>
              <span class="eyebrow">Tier 2 revenue intelligence</span>
              <h2>Expansion, churn risk, collection priority and plan opportunity</h2>
            </div>
          </div>
          <div class="quick-grid">
            <article class="action-card">
              <strong>{{ intel.expansionPipeline | currency: 'INR':'symbol':'1.0-0' }}</strong>
              <span>Estimated upsell pipeline</span>
            </article>
            <article class="action-card">
              <strong>{{ intel.netRevenueExposure | currency: 'INR':'symbol':'1.0-0' }}</strong>
              <span>Revenue exposure</span>
            </article>
            <article class="action-card">
              <strong>{{ intel.collectionPriority | currency: 'INR':'symbol':'1.0-0' }}</strong>
              <span>Collection priority</span>
            </article>
            <article class="action-card">
              <strong>{{ intel.concentrationRiskPct | number: '1.0-1' }}%</strong>
              <span>Top 3 MRR concentration</span>
            </article>
          </div>

          <div class="dashboard-grid">
            <div class="activity-list">
              <article *ngFor="let tenant of intel.expansionCandidates" style="display:flex;align-items:center;justify-content:space-between;gap:12px">
                <div style="flex:1;min-width:0">
                  <strong>{{ tenant.name }}</strong>
                  <span style="display:block;font-size:0.8em;color:var(--text-muted)">{{ tenant.planName }} · {{ tenant.signal }} · {{ tenant.healthScore | number: '1.0-1' }} health</span>
                </div>
                <strong>{{ tenant.estimatedUpsell | currency: 'INR':'symbol':'1.0-0' }}</strong>
              </article>
            </div>

            <div class="activity-list">
              <article *ngFor="let tenant of intel.churnRisks" style="display:flex;align-items:center;justify-content:space-between;gap:12px">
                <div style="flex:1;min-width:0">
                  <strong>{{ tenant.name }}</strong>
                  <span style="display:block;font-size:0.8em;color:var(--text-muted)">{{ tenant.reason }} · {{ tenant.planName }} · {{ tenant.healthScore | number: '1.0-1' }} health</span>
                </div>
                <strong>{{ tenant.mrrAtRisk + tenant.outstanding | currency: 'INR':'symbol':'1.0-0' }}</strong>
              </article>
            </div>
          </div>

          <div class="activity-list" style="margin-top:16px">
            <article *ngFor="let plan of intel.planOpportunities" style="display:flex;align-items:center;justify-content:space-between;gap:12px">
              <div style="flex:1;min-width:0">
                <strong>{{ plan.name }}</strong>
                <span style="display:block;font-size:0.8em;color:var(--text-muted)">{{ plan.tenants }} tenants · {{ plan.atRisk }} at risk · {{ plan.averageHealth | number: '1.0-1' }} avg health</span>
              </div>
              <strong>{{ plan.mrr | currency: 'INR':'symbol':'1.0-0' }}</strong>
            </article>
          </div>
        </section>

        <section class="panel" *ngIf="overview.revenueLeakageReport as leakage">
          <div class="section-title">
            <div>
              <span class="eyebrow">Revenue leakage report</span>
              <h2>{{ leakage.totalLeakage | currency: 'INR':'symbol':'1.0-0' }} leakage across billing, adoption and rollout gaps</h2>
            </div>
            <span class="badge" [style.background]="leakage.lowUsageExpiringCount ? 'var(--danger,#dc2626)' : 'var(--success,#16a34a)'" style="color:#fff">{{ leakage.lowUsageExpiringCount }} churn-risk badges</span>
          </div>
          <div class="quick-grid">
            <article class="action-card">
              <strong>{{ leakage.outstandingBilling | currency: 'INR':'symbol':'1.0-0' }}</strong>
              <span>Outstanding billing</span>
            </article>
            <article class="action-card">
              <strong>{{ leakage.suspendedMrr | currency: 'INR':'symbol':'1.0-0' }}</strong>
              <span>Suspended MRR</span>
            </article>
            <article class="action-card">
              <strong>{{ leakage.expiredTrialPipeline | currency: 'INR':'symbol':'1.0-0' }}</strong>
              <span>Expired trial pipeline</span>
            </article>
            <article class="action-card">
              <strong>{{ leakage.lowAdoptionMrr | currency: 'INR':'symbol':'1.0-0' }}</strong>
              <span>Low adoption MRR</span>
            </article>
          </div>

          <div class="dashboard-grid">
            <div class="activity-list">
              <article *ngFor="let item of leakage.lineItems" style="display:flex;align-items:center;justify-content:space-between;gap:12px">
                <div style="flex:1;min-width:0">
                  <strong>{{ item.label }}</strong>
                  <span style="display:block;font-size:0.8em;color:var(--text-muted)">{{ item.detail }} · {{ item.action }}</span>
                </div>
                <div style="text-align:right;flex-shrink:0">
                  <span class="badge" [style.background]="healthFlagTone(item.severity)" style="color:#fff">{{ item.severity }}</span>
                  <strong style="display:block">{{ item.amount | currency: 'INR':'symbol':'1.0-0' }}</strong>
                </div>
              </article>
            </div>

            <div class="activity-list">
              <article *ngFor="let tenant of leakage.atRiskTenants" style="display:flex;align-items:center;justify-content:space-between;gap:12px">
                <div style="flex:1;min-width:0">
                  <strong>{{ tenant.name }}</strong>
                  <span style="display:block;font-size:0.8em;color:var(--text-muted)">{{ tenant.planName }} · {{ tenant.daysLeft }} days left · {{ tenant.usage.appointments }} appts · {{ tenant.usage.clients }} clients</span>
                </div>
                <div style="text-align:right;flex-shrink:0">
                  <strong>{{ tenant.mrrAtRisk | currency: 'INR':'symbol':'1.0-0' }}</strong>
                  <button type="button" class="link-button" (click)="openTenantDrilldown(tenant.id)">Open 360</button>
                </div>
              </article>
              <article *ngIf="!leakage.atRiskTenants?.length">
                <strong>No low-usage expiring tenants</strong>
                <span style="display:block;font-size:0.8em;color:var(--text-muted)">No churn-risk badge triggered by usage and plan expiry.</span>
              </article>
            </div>
          </div>
        </section>

        <section class="panel" *ngIf="overview.billingOperationsReport as billingOps">
          <div class="section-title">
            <div>
              <span class="eyebrow">Billing operations</span>
              <h2>Failed payments, paused subscriptions and dunning status</h2>
            </div>
            <span class="badge" [style.background]="billingOps.criticalDunning ? 'var(--danger,#dc2626)' : 'var(--success,#16a34a)'" style="color:#fff">{{ billingOps.criticalDunning }} escalations</span>
          </div>
          <div class="quick-grid">
            <article class="action-card">
              <strong>{{ billingOps.failedPayments }}</strong>
              <span>Failed payments</span>
            </article>
            <article class="action-card">
              <strong>{{ billingOps.failedPaymentAmount | currency: 'INR':'symbol':'1.0-0' }}</strong>
              <span>Failed payment value</span>
            </article>
            <article class="action-card">
              <strong>{{ billingOps.pausedSubscriptions }}</strong>
              <span>Paused subscriptions</span>
            </article>
            <article class="action-card">
              <strong>{{ billingOps.dunningAmount | currency: 'INR':'symbol':'1.0-0' }}</strong>
              <span>Dunning amount</span>
            </article>
          </div>

          <div class="activity-list">
            <article *ngFor="let tenant of billingOps.tenants" style="display:grid;grid-template-columns:1fr 130px 150px 120px;gap:12px;align-items:center">
              <div style="min-width:0">
                <strong>{{ tenant.name }}</strong>
                <span style="display:block;font-size:0.8em;color:var(--text-muted)">{{ tenant.planName }} · {{ tenant.subscriptionStatus }} · {{ tenant.billingOps.nextAction }}</span>
              </div>
              <span class="badge" [style.background]="healthFlagTone(tenant.billingOps.dunningSeverity)" style="color:#fff">{{ tenant.billingOps.dunningStatus }}</span>
              <span>{{ tenant.billingOps.failedPaymentCount }} failed · {{ tenant.billingOps.unpaidInvoiceCount }} unpaid</span>
              <div style="text-align:right">
                <strong>{{ tenant.billingOps.outstanding | currency: 'INR':'symbol':'1.0-0' }}</strong>
                <button type="button" class="link-button" (click)="openTenantDrilldown(tenant.id)">Open 360</button>
              </div>
            </article>
            <article *ngIf="!billingOps.tenants?.length">
              <strong>No active dunning queue</strong>
              <span style="display:block;font-size:0.8em;color:var(--text-muted)">No failed payments, paused subscriptions or unpaid dunning items found.</span>
            </article>
          </div>
        </section>

        <section class="panel" *ngIf="overview.usageQuotaBillingAlerts as quota">
          <div class="section-title">
            <div>
              <span class="eyebrow">Usage quotas & billing alerts</span>
              <h2>{{ quota.quotaAlertCount }} quota alerts and {{ quota.billingAlertCount }} billing alerts</h2>
            </div>
            <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
              <span class="badge" [style.background]="quota.overLimitCount ? 'var(--danger,#dc2626)' : 'var(--success,#16a34a)'" style="color:#fff">{{ quota.overLimitCount }} over limit</span>
              <button class="ghost-button mini" type="button" [disabled]="!quota.overLimitCount || saving()" (click)="dispatchQuotaAlerts()">Auto email/webhook</button>
            </div>
          </div>
          <div class="dashboard-grid">
            <div class="activity-list">
              <article *ngFor="let alert of quota.quotaAlerts" style="display:grid;grid-template-columns:1fr 120px 110px;gap:12px;align-items:center">
                <div style="min-width:0">
                  <strong>{{ alert.tenantName }}</strong>
                  <span style="display:block;font-size:0.8em;color:var(--text-muted)">{{ alert.metric }} · {{ alert.used }}/{{ alert.limit }} · {{ alert.action }}</span>
                  <a [href]="alert.supportTicketLink" style="display:block;font-size:0.78em;color:var(--accent,#2563eb)">Support ticket link</a>
                </div>
                <span style="display:block;height:10px;background:var(--surface-muted,#e5e7eb);border-radius:999px;overflow:hidden">
                  <span [style.width.%]="alert.usagePct > 100 ? 100 : alert.usagePct" [style.background]="healthFlagTone(alert.severity)" style="display:block;height:100%"></span>
                </span>
                <span class="badge" [style.background]="healthFlagTone(alert.severity)" style="color:#fff">{{ alert.usagePct | number: '1.0-1' }}%</span>
              </article>
              <article *ngIf="!quota.quotaAlerts?.length">
                <strong>No quota alerts</strong>
                <span style="display:block;font-size:0.8em;color:var(--text-muted)">All tenants are below quota warning threshold.</span>
              </article>
            </div>

            <div class="activity-list">
              <article *ngFor="let alert of quota.billingAlerts" style="display:flex;align-items:center;justify-content:space-between;gap:12px">
                <div style="flex:1;min-width:0">
                  <strong>{{ alert.tenantName }}</strong>
                  <span style="display:block;font-size:0.8em;color:var(--text-muted)">{{ alert.dunningStatus }} · {{ alert.failedPayments }} failed payments · {{ alert.action }}</span>
                  <a [href]="alert.supportTicketLink" style="display:block;font-size:0.78em;color:var(--accent,#2563eb)">Support ticket link</a>
                </div>
                <div style="text-align:right;flex-shrink:0">
                  <span class="badge" [style.background]="healthFlagTone(alert.severity)" style="color:#fff">{{ alert.severity }}</span>
                  <strong style="display:block">{{ alert.outstanding | currency: 'INR':'symbol':'1.0-0' }}</strong>
                </div>
              </article>
              <article *ngIf="!quota.billingAlerts?.length">
                <strong>No billing alerts</strong>
                <span style="display:block;font-size:0.8em;color:var(--text-muted)">No active dunning or outstanding billing alerts.</span>
              </article>
            </div>
          </div>
        </section>

        <section class="panel" *ngIf="overview.revenueGrowthGraph as graph">
          <div class="section-title">
            <div>
              <span class="eyebrow">MRR / ARR growth</span>
              <h2>Month-wise revenue growth with churn overlay</h2>
            </div>
          </div>
          <div class="activity-list">
            <article *ngFor="let row of graph" style="display:grid;grid-template-columns:90px 1fr 160px;gap:12px;align-items:center">
              <strong>{{ row.month }}</strong>
              <div style="min-width:0">
                <span style="display:block;height:10px;background:var(--surface-muted,#e5e7eb);border-radius:999px;overflow:hidden">
                  <span [style.width.%]="revenueBarWidth(row.mrr, graph)" style="display:block;height:100%;background:var(--success,#16a34a)"></span>
                </span>
                <span *ngIf="row.churnedMrr" style="display:block;height:5px;background:var(--danger,#dc2626);border-radius:999px;margin-top:6px" [style.width.%]="revenueBarWidth(row.churnedMrr, graph)"></span>
                <small style="color:var(--text-muted)">Growth {{ row.growth | currency: 'INR':'symbol':'1.0-0' }} · churn {{ row.churnedMrr | currency: 'INR':'symbol':'1.0-0' }}</small>
              </div>
              <div style="text-align:right">
                <strong>{{ row.mrr | currency: 'INR':'symbol':'1.0-0' }}</strong>
                <span style="display:block;font-size:0.78em;color:var(--text-muted)">{{ row.arr | currency: 'INR':'symbol':'1.0-0' }} ARR</span>
              </div>
            </article>
          </div>
        </section>

        <section class="panel" *ngIf="overview.trialPaidFunnel as funnel">
          <div class="section-title">
            <div>
              <span class="eyebrow">Trial to paid funnel</span>
              <h2>{{ funnel.conversionRate | number: '1.0-1' }}% conversion with {{ funnel.trialLeakage }} expired trial leakages</h2>
            </div>
          </div>
          <div class="quick-grid">
            <article class="action-card">
              <strong>{{ funnel.convertedTrials }}</strong>
              <span>Trials converted</span>
            </article>
            <article class="action-card">
              <strong>{{ funnel.averageConversionDays | number: '1.0-1' }}</strong>
              <span>Average conversion days</span>
            </article>
            <article class="action-card">
              <strong>{{ funnel.paidMrr | currency: 'INR':'symbol':'1.0-0' }}</strong>
              <span>Paid MRR</span>
            </article>
            <article class="action-card">
              <strong>{{ funnel.trialPipelineMrr | currency: 'INR':'symbol':'1.0-0' }}</strong>
              <span>Trial pipeline MRR</span>
            </article>
          </div>
          <div class="activity-list">
            <article *ngFor="let stage of funnel.stages" style="display:grid;grid-template-columns:150px 1fr 80px;gap:12px;align-items:center">
              <strong>{{ stage.label }}</strong>
              <span style="display:block;height:10px;background:var(--surface-muted,#e5e7eb);border-radius:999px;overflow:hidden">
                <span [style.width.%]="stage.pct" style="display:block;height:100%;background:var(--accent,#2563eb)"></span>
              </span>
              <span style="text-align:right">{{ stage.count }} · {{ stage.pct | number: '1.0-1' }}%</span>
            </article>
          </div>
        </section>

        <section class="panel" *ngIf="overview.churnPrediction as churn">
          <div class="section-title">
            <div>
              <span class="eyebrow">Churn prediction</span>
              <h2>{{ churn.highRiskCount }} high-risk and {{ churn.mediumRiskCount }} medium-risk tenants</h2>
            </div>
            <span class="badge" style="background:var(--danger,#dc2626);color:#fff">{{ churn.mrrAtRisk | currency: 'INR':'symbol':'1.0-0' }} MRR at risk</span>
          </div>
          <div class="activity-list">
            <article *ngFor="let tenant of churn.tenants" style="display:grid;grid-template-columns:1fr 170px 120px;gap:12px;align-items:center">
              <div style="min-width:0">
                <strong>{{ tenant.name }}</strong>
                <span style="display:block;font-size:0.8em;color:var(--text-muted)">{{ tenant.planName }} · {{ tenant.drivers.join(' · ') || 'watch' }} · {{ tenant.recommendedAction }}</span>
              </div>
              <span style="display:block;height:10px;background:var(--surface-muted,#e5e7eb);border-radius:999px;overflow:hidden">
                <span [style.width.%]="tenant.churnScore" [style.background]="churnTone(tenant.probability)" style="display:block;height:100%"></span>
              </span>
              <div style="text-align:right">
                <span class="badge" [style.background]="churnTone(tenant.probability)" style="color:#fff">{{ tenant.probability }}</span>
                <strong style="display:block">{{ tenant.churnScore | number: '1.0-1' }}%</strong>
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
          <div class="section-title">
            <div>
              <span class="eyebrow">Bulk actions</span>
              <h2>All salons</h2>
            </div>
            <span class="badge">{{ selectedTenantIds().length }} selected</span>
          </div>
          <form [formGroup]="bulkActionForm" (ngSubmit)="applyBulkAction()" class="dashboard-grid" style="margin-bottom:16px">
            <label class="field">
              <span>Bulk action</span>
              <select formControlName="action">
                <option value="suspend">Suspend selected</option>
                <option value="reactivate">Reactivate selected</option>
                <option value="changePlan">Change plan</option>
                <option value="sendEmail">Send email</option>
              </select>
            </label>
            <label class="field" *ngIf="bulkActionForm.value.action === 'changePlan'">
              <span>Plan</span>
              <select formControlName="planId">
                <option value="">Select plan</option>
                <option *ngFor="let plan of overview.plans" [value]="plan.id">{{ plan.name }}</option>
              </select>
            </label>
            <label class="field" *ngIf="bulkActionForm.value.action === 'sendEmail'">
              <span>Email subject</span>
              <input formControlName="emailSubject" />
            </label>
            <label class="field full" *ngIf="bulkActionForm.value.action === 'sendEmail'">
              <span>Email body</span>
              <textarea formControlName="emailBody"></textarea>
            </label>
            <div class="form-actions">
              <button class="ghost-button" type="button" (click)="selectAllTenants(overview.tenants)">Select all</button>
              <button class="ghost-button" type="button" (click)="selectedTenantIds.set([])">Clear</button>
              <button class="primary-button" type="submit" [disabled]="!selectedTenantIds().length || saving()">Apply bulk action</button>
            </div>
          </form>
          <div class="table-wrap">
            <table>
              <thead>
                <tr><th></th><th>Salon</th><th>Plan</th><th>Status</th><th>Billing</th><th>Sales</th><th>Usage</th><th>Health</th><th>Flag</th><th></th></tr>
              </thead>
              <tbody>
                <tr *ngFor="let tenant of overview.tenants" style="cursor:pointer" (click)="openTenantDrilldown(tenant.id)">
                  <td>
                    <input type="checkbox" [checked]="isTenantSelected(tenant.id)" (click)="$event.stopPropagation()" (change)="toggleTenantSelection(tenant.id)" />
                  </td>
                  <td><strong>{{ tenant.name }}</strong><small>{{ tenant.ownerEmail }} · {{ tenant.primaryDomain }}</small></td>
                  <td>{{ tenant.planName }}</td>
                  <td>
                    <span class="badge">{{ tenant.subscriptionStatus }}</span>
                    <small style="display:block;color:var(--text-muted)">
                      <span class="badge" [style.background]="healthFlagTone(tenant.billingOps?.dunningSeverity)" style="color:#fff">{{ tenant.billingOps?.dunningStatus || 'Clear' }}</span>
                      {{ tenant.billingOps?.failedPaymentCount || 0 }} failed
                    </small>
                  </td>
                  <td>{{ tenant.totalBillingAmount | currency: 'INR':'symbol':'1.0-0' }}<small>{{ tenant.meteredUsageRevenue | currency: 'INR':'symbol':'1.0-0' }} usage</small></td>
                  <td>{{ tenant.transactionRevenue | currency: 'INR':'symbol':'1.0-0' }}</td>
                  <td>
                    {{ tenant.usage.clients }} clients · {{ tenant.usage.appointments }} bookings
                    <small style="display:block;color:var(--text-muted)">
                      {{ tenant.usage.branches }}/{{ tenant.tenantLimits?.branches }} branches · {{ tenant.usage.staff }}/{{ tenant.tenantLimits?.staff }} staff · {{ tenant.usage.clients }}/{{ tenant.tenantLimits?.clients }} clients
                    </small>
                  </td>
                  <td>{{ tenant.healthScore | number: '1.0-1' }}</td>
                  <td>
                    <span class="badge" [style.background]="healthFlagTone(tenant.healthFlag?.severity)" style="color:#fff">
                      {{ tenant.healthFlag?.label || 'Healthy' }}
                    </span>
                    <small style="display:block;color:var(--text-muted)">{{ tenant.healthFlag?.reason }}</small>
                  </td>
                  <td>
                    <button class="ghost-button mini" type="button" (click)="$event.stopPropagation(); openTenantDrilldown(tenant.id)">Profile</button>
                    <button class="ghost-button mini" type="button" (click)="$event.stopPropagation(); selectTenant(tenant.id)">360</button>
                    <button class="ghost-button mini" type="button" (click)="$event.stopPropagation(); editTenantLimits(tenant)">Limits</button>
                    <button class="ghost-button mini" type="button" (click)="$event.stopPropagation(); prepareTenantFeatureOverride(tenant)">Override</button>
                    <button class="ghost-button mini" type="button" (click)="$event.stopPropagation(); prepareImpersonation(tenant)">Impersonate</button>
                    <button class="ghost-button mini" type="button" (click)="$event.stopPropagation(); toggleTenant(tenant)">
                      {{ tenant.subscriptionStatus === 'suspended' ? 'Reactivate' : 'Suspend' }}
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <section
          *ngIf="drilldownOpen() && selectedTenant() as tenant"
          style="position:fixed;inset:0;z-index:1000;background:rgba(15,23,42,.52);display:flex;justify-content:flex-end"
          (click)="drilldownOpen.set(false)">
          <div
            class="panel"
            style="width:min(100%,1040px);height:100%;overflow:auto;border-radius:0;margin:0;background:var(--surface,#fff)"
            (click)="$event.stopPropagation()">
            <div class="section-title">
              <div>
                <span class="eyebrow">Tenant drill-down</span>
                <h2>{{ tenant.name }} full profile, usage, invoices and audit log</h2>
              </div>
              <button class="ghost-button mini" type="button" (click)="drilldownOpen.set(false)">Close</button>
            </div>

            <div class="quick-grid">
              <article class="action-card">
                <strong>{{ tenant.healthScore | number: '1.0-1' }}</strong>
                <span>Health score</span>
              </article>
              <article class="action-card">
                <strong>{{ tenant.drilldown.staffCount }}</strong>
                <span>Staff count</span>
              </article>
              <article class="action-card">
                <strong>{{ tenant.drilldown.tenantUserCount }}</strong>
                <span>Tenant users</span>
              </article>
              <article class="action-card">
                <strong>{{ tenant.drilldown.invoiceSummary.total }}</strong>
                <span>Invoices</span>
              </article>
              <article class="action-card">
                <strong>{{ tenant.drilldown.invoiceSummary.outstanding | currency: 'INR':'symbol':'1.0-0' }}</strong>
                <span>Outstanding</span>
              </article>
              <article class="action-card">
                <strong>{{ tenant.drilldown.lastLoginAt || 'No login' }}</strong>
                <span>Last login</span>
              </article>
            </div>

            <div class="dashboard-grid">
              <div class="activity-list">
                <article>
                  <div>
                    <strong>Profile</strong>
                    <span>{{ tenant.ownerEmail }} · {{ tenant.primaryDomain || 'Domain pending' }} · {{ tenant.planName }}</span>
                  </div>
                  <span class="badge">{{ tenant.subscriptionStatus }}</span>
                </article>
                <article *ngFor="let item of tenant.drilldown.usageGraph">
                  <div style="flex:1;min-width:0">
                    <strong>{{ item.label }}</strong>
                    <span style="display:block;height:6px;background:var(--surface-muted,#e5e7eb);border-radius:999px;margin-top:8px;overflow:hidden">
                      <span [style.width.%]="usageBarWidth(item.value, tenant.drilldown.usageGraph)" style="display:block;height:100%;background:var(--accent,#2563eb)"></span>
                    </span>
                  </div>
                  <strong>{{ item.value }}</strong>
                </article>
              </div>

              <div class="activity-list">
                <article *ngFor="let invoice of tenant.drilldown.recentInvoices">
                  <div>
                    <strong>{{ invoice.invoiceNumber }}</strong>
                    <span>{{ invoice.createdAt || 'No date' }} · paid {{ invoice.paid | currency: 'INR':'symbol':'1.0-0' }} · due {{ invoice.balance | currency: 'INR':'symbol':'1.0-0' }}</span>
                  </div>
                  <span class="badge">{{ invoice.status }}</span>
                </article>
                <article *ngIf="!tenant.drilldown.recentInvoices.length">
                  <div>
                    <strong>No invoices found</strong>
                    <span>Billing history will appear after invoices are created.</span>
                  </div>
                </article>
              </div>
            </div>

            <div class="dashboard-grid" style="margin-top:16px">
              <section class="form-panel">
                <h3>Support notes</h3>
                <form [formGroup]="supportNoteForm" (ngSubmit)="saveSupportNote(tenant.id)">
                  <label class="field full"><span>Internal note</span><textarea formControlName="note"></textarea></label>
                  <div class="form-actions">
                    <button class="primary-button" type="submit" [disabled]="supportNoteForm.invalid || saving()">Add note</button>
                  </div>
                </form>
                <div class="activity-list" style="margin-top:12px">
                  <article *ngFor="let note of tenant.drilldown.supportNotes">
                    <div>
                      <strong>{{ note.note }}</strong>
                      <span>{{ note.author }} · {{ note.createdAt }}</span>
                    </div>
                  </article>
                  <article *ngIf="!tenant.drilldown.supportNotes.length">
                    <div>
                      <strong>No support notes</strong>
                      <span>Internal notes added here are stored in audit history.</span>
                    </div>
                  </article>
                </div>
              </section>

              <div class="activity-list">
                <article *ngFor="let event of tenant.drilldown.auditLog">
                  <div>
                    <strong>{{ event.action }}</strong>
                    <span>{{ event.actorUserId }} · {{ event.summary || 'No details' }}</span>
                  </div>
                  <small>{{ event.createdAt }}</small>
                </article>
                <article *ngIf="!tenant.drilldown.auditLog.length">
                  <div>
                    <strong>No audit events</strong>
                    <span>Super-admin actions for this tenant will appear here.</span>
                  </div>
                </article>
              </div>
            </div>
          </div>
        </section>

        <div class="dashboard-grid">
          <section class="form-panel">
            <h3>Tenant limits</h3>
            <form [formGroup]="tenantLimitsForm" (ngSubmit)="saveTenantLimits()">
              <label class="field">
                <span>Tenant</span>
                <select formControlName="tenantId" (change)="loadTenantLimitForm()">
                  <option value="">Select tenant</option>
                  <option *ngFor="let tenant of overview.tenants" [value]="tenant.id">{{ tenant.name }}</option>
                </select>
              </label>
              <label class="field">
                <span>Branches: {{ tenantLimitsForm.value.branches }}</span>
                <input type="range" min="1" max="100" formControlName="branches" />
              </label>
              <label class="field">
                <span>Staff: {{ tenantLimitsForm.value.staff }}</span>
                <input type="range" min="1" max="500" formControlName="staff" />
              </label>
              <label class="field">
                <span>Clients: {{ tenantLimitsForm.value.clients }}</span>
                <input type="range" min="100" max="100000" step="100" formControlName="clients" />
              </label>
              <label class="field">
                <span>Support tier</span>
                <select formControlName="supportTier">
                  <option value="standard">Standard</option>
                  <option value="priority">Priority</option>
                  <option value="enterprise">Enterprise</option>
                </select>
              </label>
              <label class="field full"><span>Reason</span><textarea formControlName="reason"></textarea></label>
              <div class="form-actions">
                <button class="primary-button" type="submit" [disabled]="tenantLimitsForm.invalid || saving()">Save tenant limits</button>
              </div>
            </form>
          </section>

          <section class="form-panel">
            <h3>Per-Tenant Feature Override</h3>
            <form [formGroup]="tenantFeatureOverrideForm" (ngSubmit)="saveTenantFeatureOverride()">
              <label class="field">
                <span>Tenant</span>
                <select formControlName="tenantId">
                  <option value="">Select tenant</option>
                  <option *ngFor="let tenant of overview.tenants" [value]="tenant.id">{{ tenant.name }}</option>
                </select>
              </label>
              <label class="field">
                <span>Global feature</span>
                <select formControlName="key" (change)="selectTenantOverrideFeature(overview.tenantFeatureOverrides?.globalFeatures || [])">
                  <option value="">Select feature</option>
                  <option *ngFor="let feature of overview.tenantFeatureOverrides?.globalFeatures || []" [value]="feature.key">{{ feature.name }} · global {{ feature.enabled ? 'ON' : 'OFF' }}</option>
                </select>
              </label>
              <label class="field"><span>Feature key</span><input [value]="tenantFeatureOverrideForm.value.key || ''" readonly /></label>
              <label class="field"><span>Feature name</span><input formControlName="name" /></label>
              <label class="field">
                <span>Rollout %: {{ tenantFeatureOverrideForm.value.rolloutPercentage }}</span>
                <input type="range" min="0" max="100" formControlName="rolloutPercentage" />
              </label>
              <label class="field check-line"><input type="checkbox" formControlName="enabled" /><span>Enabled for tenant</span></label>
              <label class="field check-line"><input type="checkbox" formControlName="killSwitch" /><span>Kill switch</span></label>
              <label class="field full"><span>Description</span><textarea formControlName="description"></textarea></label>
              <div class="form-actions">
                <button class="primary-button" type="submit" [disabled]="tenantFeatureOverrideForm.invalid || saving()">Save override</button>
              </div>
            </form>
          </section>

          <section class="form-panel">
            <h3>Impersonate tenant</h3>
            <form [formGroup]="impersonationForm" (ngSubmit)="startImpersonation()">
              <label class="field">
                <span>Tenant</span>
                <select formControlName="tenantId">
                  <option value="">Select tenant</option>
                  <option *ngFor="let tenant of overview.tenants" [value]="tenant.id">{{ tenant.name }}</option>
                </select>
              </label>
              <label class="field"><span>Open path</span><input formControlName="returnPath" /></label>
              <label class="field full"><span>Debug reason</span><textarea formControlName="reason"></textarea></label>
              <label class="field"><span>Confirmation</span><input formControlName="confirmation" placeholder="Type IMPERSONATE" /></label>
              <div class="form-actions">
                <button class="primary-button" type="submit" [disabled]="impersonationForm.invalid || saving()">Start impersonation</button>
              </div>
            </form>
            <small style="display:block;color:var(--text-muted);margin-top:8px">Creates an audited tenant session for support debugging.</small>
          </section>

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
            <h3>Custom Plan Builder</h3>
            <form [formGroup]="planForm" (ngSubmit)="createPlan()">
              <label class="field"><span>Name</span><input formControlName="name" /></label>
              <label class="field"><span>Code</span><input formControlName="code" /></label>
              <label class="field"><span>Monthly price</span><input type="number" formControlName="priceMonthly" /></label>
              <label class="field"><span>Trial days</span><input type="number" formControlName="trialDays" /></label>
              <label class="field"><span>Branches</span><input type="number" formControlName="branches" /></label>
              <label class="field"><span>Staff</span><input type="number" formControlName="staff" /></label>
              <label class="field"><span>Clients</span><input type="number" formControlName="clients" /></label>
              <label class="field"><span>Monthly appointments</span><input type="number" formControlName="monthlyAppointments" /></label>
              <label class="field"><span>Campaigns</span><input type="number" formControlName="campaigns" /></label>
              <label class="field">
                <span>Support tier</span>
                <select formControlName="supportTier">
                  <option value="standard">Standard</option>
                  <option value="priority">Priority</option>
                  <option value="enterprise">Enterprise</option>
                </select>
              </label>
              <label class="field full"><span>Features</span><textarea formControlName="featuresText"></textarea></label>
              <div class="form-actions">
                <button class="primary-button" type="submit" [disabled]="planForm.invalid || saving()">Create custom plan</button>
              </div>
            </form>
          </section>
        </div>

        <section class="form-panel">
          <h3>Advanced feature flags</h3>
          <div class="quick-grid" *ngIf="overview.featureFlagCommand as flags">
            <article class="action-card">
              <strong>{{ flags.total }}</strong>
              <span>Total flags</span>
            </article>
            <article class="action-card">
              <strong>{{ flags.partialRollouts }}</strong>
              <span>Partial rollouts</span>
            </article>
            <article class="action-card">
              <strong>{{ flags.killSwitches }}</strong>
              <span>Kill switches armed</span>
            </article>
            <article class="action-card">
              <strong>{{ flags.expired }}</strong>
              <span>Expired flags</span>
            </article>
          </div>
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
            <label class="field" *ngIf="toggleForm.value.scope === 'tenant'">
              <span>Tenant target</span>
              <select formControlName="tenantId">
                <option value="">Select tenant</option>
                <option *ngFor="let tenant of overview.tenants" [value]="tenant.id">{{ tenant.name }}</option>
              </select>
            </label>
            <label class="field" *ngIf="toggleForm.value.scope === 'plan'">
              <span>Plan target</span>
              <select formControlName="planId">
                <option value="">Select plan</option>
                <option *ngFor="let plan of overview.plans" [value]="plan.id">{{ plan.name }}</option>
              </select>
            </label>
            <label class="field"><span>Rollout %</span><input type="number" min="0" max="100" formControlName="rolloutPercentage" /></label>
            <label class="field"><span>Expires on</span><input type="date" formControlName="expiresAt" /></label>
            <label class="field"><span>Dependency key</span><input formControlName="dependencyKey" /></label>
            <label class="field check-line"><input type="checkbox" formControlName="enabled" /><span>Enabled</span></label>
            <label class="field check-line"><input type="checkbox" formControlName="killSwitch" /><span>Kill switch</span></label>
            <label class="field full"><span>Description</span><textarea formControlName="description"></textarea></label>
            <div class="form-actions"><button class="primary-button" type="submit" [disabled]="toggleForm.invalid || saving()">Save toggle</button></div>
          </form>
        </section>

        <section class="panel" *ngIf="overview.tenantFeatureOverrides as overrides">
          <div class="section-title">
            <div>
              <span class="eyebrow">Tenant override precedence</span>
              <h2>Tenant-specific ON/OFF wins over global toggle</h2>
            </div>
            <span class="badge">{{ overrides.overrideCount }} overrides</span>
          </div>
          <div class="quick-grid">
            <article class="action-card">
              <strong>{{ overrides.tenantOnOverGlobalOff }}</strong>
              <span>Tenant ON over global OFF</span>
            </article>
            <article class="action-card">
              <strong>{{ overrides.tenantOffOverGlobalOn }}</strong>
              <span>Tenant OFF over global ON</span>
            </article>
          </div>
          <div class="activity-list">
            <article *ngFor="let item of overrides.overrides" style="display:grid;grid-template-columns:1fr 140px 140px 110px;gap:12px;align-items:center">
              <div style="min-width:0">
                <strong>{{ item.tenantName }}</strong>
                <span style="display:block;font-size:0.8em;color:var(--text-muted)">{{ item.name }} · {{ item.key }} · {{ item.rolloutPercentage }}% rollout</span>
              </div>
              <span class="badge" [style.background]="item.globalEnabled ? 'var(--success,#16a34a)' : 'var(--muted,#6b7280)'" style="color:#fff">Global {{ item.globalEnabled ? 'ON' : 'OFF' }}</span>
              <span class="badge" [style.background]="item.tenantEnabled ? 'var(--success,#16a34a)' : 'var(--danger,#dc2626)'" style="color:#fff">Tenant {{ item.tenantEnabled ? 'ON' : 'OFF' }}</span>
              <span class="badge">{{ item.precedence }}</span>
            </article>
            <article *ngIf="!overrides.overrides?.length">
              <strong>No tenant overrides yet</strong>
              <span style="display:block;font-size:0.8em;color:var(--text-muted)">Use Per-Tenant Feature Override to set tenant-specific ON/OFF above global flags.</span>
            </article>
          </div>
        </section>

        <section class="panel">
          <div class="section-title"><h2>Feature flags and plans</h2></div>
          <div class="dashboard-grid">
            <div class="activity-list">
              <article *ngFor="let toggle of overview.featureToggles" style="display:flex;align-items:center;justify-content:space-between;gap:12px">
                <div style="flex:1;min-width:0">
                  <strong>{{ toggle.name }}</strong>
                  <span style="display:block;font-size:0.8em;color:var(--text-muted)">
                    {{ toggle.key }} · {{ toggle.targetSummary }} · {{ toggle.rolloutPercentage }}% rollout
                  </span>
                  <span *ngIf="toggle.guardrails?.length" style="display:block;font-size:0.78em;color:var(--text-muted)">
                    {{ toggle.guardrails.join(' · ') }}
                  </span>
                  <span *ngIf="toggle.description" style="display:block;font-size:0.78em;color:var(--text-muted)">{{ toggle.description }}</span>
                </div>
                <div style="display:flex;align-items:center;gap:8px;flex-shrink:0">
                  <span class="badge" [style.background]="featureFlagTone(toggle)" style="color:#fff">
                    {{ toggle.statusLabel }}
                  </span>
                  <button
                    type="button"
                    class="ghost"
                    style="padding:4px 10px;font-size:0.8em"
                    [disabled]="saving()"
                    (click)="editToggle(toggle)">
                    Edit
                  </button>
                  <button
                    type="button"
                    class="ghost"
                    style="padding:4px 10px;font-size:0.8em"
                    [disabled]="saving() || toggle.killSwitch"
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
                  <span style="display:block;font-size:0.78em;color:var(--text-muted)">
                    {{ plan.limits?.branches || 0 }} branches · {{ plan.limits?.staff || 0 }} staff · {{ plan.limits?.clients || 0 }} clients · {{ plan.limits?.supportTier || 'standard' }}
                  </span>
                  <span *ngIf="plan.features?.length" style="display:block;font-size:0.78em;color:var(--text-muted)">{{ plan.features.join(' · ') }}</span>
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
  readonly selectedTenantId = signal('');
  readonly selectedTenantIds = signal<string[]>([]);
  readonly drilldownOpen = signal(false);
  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly error = signal('');
  readonly selectedTenant = computed(() => {
    const overview = this.overview();
    if (!overview?.tenants?.length) return null;
    return overview.tenants.find((tenant: ApiRecord) => tenant.id === this.selectedTenantId()) || overview.tenants[0];
  });

  readonly subscriptionForm = this.fb.group({
    tenantId: ['', Validators.required],
    planId: [''],
    status: ['']
  });

  readonly safetyForm = this.fb.group({
    reason: ['', Validators.required],
    confirmation: ['', Validators.required]
  });

  readonly approvalForm = this.fb.group({
    action: ['tenant.suspension', Validators.required],
    targetType: ['tenant', Validators.required],
    targetId: ['', Validators.required],
    priority: ['high'],
    reason: ['', Validators.required],
    confirmation: ['', Validators.required]
  });

  readonly bulkActionForm = this.fb.group({
    action: ['suspend', Validators.required],
    planId: [''],
    emailSubject: ['Aura platform update'],
    emailBody: ['']
  });

  readonly supportNoteForm = this.fb.group({
    note: ['', Validators.required]
  });

  readonly tenantLimitsForm = this.fb.group({
    tenantId: ['', Validators.required],
    branches: [3],
    staff: [25],
    clients: [5000],
    supportTier: ['standard'],
    reason: ['Enterprise limit override']
  });

  readonly tenantFeatureOverrideForm = this.fb.group({
    tenantId: ['', Validators.required],
    key: ['ai.marketing', Validators.required],
    name: ['Marketing automation override', Validators.required],
    rolloutPercentage: [100],
    enabled: [true],
    killSwitch: [false],
    description: ['Tenant-specific feature override']
  });

  readonly impersonationForm = this.fb.group({
    tenantId: ['', Validators.required],
    returnPath: ['/'],
    reason: ['Support debugging', Validators.required],
    confirmation: ['', Validators.required]
  });

  readonly planForm = this.fb.group({
    name: ['', Validators.required],
    code: ['', Validators.required],
    priceMonthly: [9999],
    trialDays: [14],
    branches: [3],
    staff: [25],
    clients: [5000],
    monthlyAppointments: [8000],
    campaigns: [50],
    supportTier: ['standard'],
    featuresText: ['Advanced CRM, Marketing automation, Analytics']
  });

  readonly toggleForm = this.fb.group({
    key: ['ai.marketing', Validators.required],
    name: ['Marketing automation', Validators.required],
    scope: ['global'],
    tenantId: [''],
    planId: [''],
    rolloutPercentage: [100],
    expiresAt: [''],
    dependencyKey: [''],
    enabled: [true],
    killSwitch: [false],
    description: ['Enable AI campaign generation and retargeting workflows.']
  });

  constructor(
    private readonly api: ApiService,
    private readonly fb: UntypedFormBuilder,
    private readonly authSession: AuthSessionService,
    private readonly appState: AppStateService
  ) {}

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.error.set('');
    this.api.list<ApiRecord>('super-admin/overview').subscribe({
      next: (overview) => {
        this.overview.set(overview);
        if (!this.selectedTenantId() && overview?.tenants?.length) {
          this.selectedTenantId.set(overview.tenants[0].id);
          this.editTenantLimits(overview.tenants[0]);
        }
        const limitTenantId = this.tenantLimitsForm.value.tenantId || this.selectedTenantId();
        const limitTenant = (overview?.tenants || []).find((tenant: ApiRecord) => tenant.id === limitTenantId);
        if (limitTenant) this.editTenantLimits(limitTenant);
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
    const safety = this.safetyPayload();
    this.api.patch(`super-admin/tenants/${tenant.id}/suspension`, { status, ...safety }).subscribe({
      next: () => this.load(),
      error: (error) => this.error.set(error?.error?.error || 'Unable to update tenant status')
    });
  }

  selectTenant(tenantId: string): void {
    this.selectedTenantId.set(tenantId);
  }

  openTenantDrilldown(tenantId: string): void {
    this.selectedTenantId.set(tenantId);
    this.drilldownOpen.set(true);
  }

  editTenantLimits(tenant: ApiRecord): void {
    this.selectedTenantId.set(tenant.id);
    this.tenantLimitsForm.patchValue({
      tenantId: tenant.id,
      branches: Number(tenant.tenantLimits?.branches || 3),
      staff: Number(tenant.tenantLimits?.staff || 25),
      clients: Number(tenant.tenantLimits?.clients || 5000),
      supportTier: tenant.tenantLimits?.supportTier || 'standard',
      reason: 'Enterprise limit override'
    });
  }

  loadTenantLimitForm(): void {
    const tenantId = this.tenantLimitsForm.value.tenantId || '';
    const tenant = (this.overview()?.tenants || []).find((item: ApiRecord) => item.id === tenantId);
    if (tenant) this.editTenantLimits(tenant);
  }

  saveTenantLimits(): void {
    if (this.tenantLimitsForm.invalid) return;
    this.saving.set(true);
    const tenantId = this.tenantLimitsForm.value.tenantId || '';
    this.api.patch(`super-admin/tenants/${tenantId}/limits`, {
      branches: this.tenantLimitsForm.value.branches,
      staff: this.tenantLimitsForm.value.staff,
      clients: this.tenantLimitsForm.value.clients,
      supportTier: this.tenantLimitsForm.value.supportTier,
      reason: this.tenantLimitsForm.value.reason || ''
    }).subscribe({
      next: () => {
        this.saving.set(false);
        this.load();
      },
      error: (error) => {
        this.error.set(error?.error?.error || 'Unable to save tenant limits');
        this.saving.set(false);
      }
    });
  }

  prepareTenantFeatureOverride(tenant: ApiRecord): void {
    this.selectedTenantId.set(tenant.id);
    this.tenantFeatureOverrideForm.patchValue({ tenantId: tenant.id });
    this.toggleForm.patchValue({ scope: 'tenant', tenantId: tenant.id });
  }

  selectTenantOverrideFeature(features: ApiRecord[] = []): void {
    const selected = features.find((feature) => feature.key === this.tenantFeatureOverrideForm.value.key);
    if (!selected) return;
    this.tenantFeatureOverrideForm.patchValue({
      key: selected.key,
      name: selected.name || selected.key,
      enabled: Boolean(selected.enabled)
    });
  }

  saveTenantFeatureOverride(): void {
    if (this.tenantFeatureOverrideForm.invalid) return;
    this.saving.set(true);
    const formValue = this.tenantFeatureOverrideForm.value;
    const rolloutPercentage = Math.max(0, Math.min(100, Number(formValue.rolloutPercentage || 0)));
    this.api.post('super-admin/feature-toggles', {
      key: formValue.key,
      name: formValue.name,
      scope: 'tenant',
      tenantId: formValue.tenantId,
      rolloutPercentage,
      enabled: Boolean(formValue.enabled),
      killSwitch: Boolean(formValue.killSwitch),
      description: formValue.description || '',
      rules: {
        rolloutPercentage,
        killSwitch: Boolean(formValue.killSwitch),
        baseKey: formValue.key
      }
    }).subscribe({
      next: () => {
        this.saving.set(false);
        this.load();
      },
      error: (error) => {
        this.error.set(error?.error?.error || 'Unable to save tenant feature override');
        this.saving.set(false);
      }
    });
  }

  prepareImpersonation(tenant: ApiRecord): void {
    this.impersonationForm.patchValue({ tenantId: tenant.id });
    if (this.impersonationForm.value.confirmation === 'IMPERSONATE') {
      this.startImpersonation();
      return;
    }
    this.error.set(`Type IMPERSONATE in the impersonation form to debug ${tenant.name}.`);
  }

  startImpersonation(): void {
    if (this.impersonationForm.invalid) return;
    this.saving.set(true);
    this.error.set('');
    const tenantId = this.impersonationForm.value.tenantId || '';
    this.api.post<ApiRecord>(`super-admin/tenants/${tenantId}/impersonation`, {
      reason: this.impersonationForm.value.reason || '',
      confirmation: this.impersonationForm.value.confirmation || '',
      returnPath: this.impersonationForm.value.returnPath || '/'
    }).subscribe({
      next: (result) => {
        const currentSession = localStorage.getItem('aura.authSession') || '';
        if (currentSession) localStorage.setItem('aura.superAdminSessionBackup', currentSession);
        localStorage.setItem('aura.impersonationContext', JSON.stringify({
          tenantId: result.tenantId,
          tenantName: result.tenantName,
          auditId: result.auditId,
          expiresAt: result.expiresAt,
          startedAt: new Date().toISOString()
        }));
        this.authSession.setSession(result.session);
        this.appState.setTenant(result.tenantId);
        this.appState.setRole(result.session?.user?.role || 'owner');
        window.location.assign(result.launchUrl || '/');
      },
      error: (error) => {
        this.error.set(error?.error?.error || 'Unable to start impersonation');
        this.saving.set(false);
      }
    });
  }

  usageBarWidth(value: number, rows: ApiRecord[] = []): number {
    const max = Math.max(1, ...rows.map((row) => Number(row.value || 0)));
    return Math.max(4, Math.round((Number(value || 0) / max) * 100));
  }

  revenueBarWidth(value: number, rows: ApiRecord[] = []): number {
    const max = Math.max(1, ...rows.map((row) => Math.max(Number(row.mrr || 0), Number(row.churnedMrr || 0))));
    return Math.max(4, Math.round((Number(value || 0) / max) * 100));
  }

  isTenantSelected(tenantId: string): boolean {
    return this.selectedTenantIds().includes(tenantId);
  }

  toggleTenantSelection(tenantId: string): void {
    const selected = new Set(this.selectedTenantIds());
    if (selected.has(tenantId)) selected.delete(tenantId);
    else selected.add(tenantId);
    this.selectedTenantIds.set([...selected]);
  }

  selectAllTenants(tenants: ApiRecord[]): void {
    this.selectedTenantIds.set((tenants || []).map((tenant) => tenant.id).filter(Boolean));
  }

  tenantHealthRows(tenant: ApiRecord): ApiRecord[] {
    const health = tenant?.tenant360?.health || tenant?.healthBreakdown || {};
    return [
      { label: 'Subscription', value: Number(health.subscriptionScore || 0) },
      { label: 'Usage adoption', value: Number(health.usageScore || 0) },
      { label: 'Billing hygiene', value: Number(health.billingScore || 0) },
      { label: 'Setup readiness', value: Number(health.readinessScore || 0) }
    ];
  }

  updateSubscription(): void {
    if (this.subscriptionForm.invalid) return;
    this.saving.set(true);
    const tenantId = this.subscriptionForm.value.tenantId;
    this.api.patch(`super-admin/tenants/${tenantId}/subscription`, {
      planId: this.subscriptionForm.value.planId,
      status: this.subscriptionForm.value.status,
      ...this.safetyPayload()
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

  safetyPayload(): ApiRecord {
    return {
      reason: this.safetyForm.value.reason || '',
      confirmation: this.safetyForm.value.confirmation || ''
    };
  }

  requestApproval(): void {
    if (this.approvalForm.invalid) return;
    this.saving.set(true);
    this.api.post('super-admin/action-approvals', this.approvalForm.value).subscribe({
      next: () => {
        this.saving.set(false);
        this.load();
      },
      error: (error) => {
        this.error.set(error?.error?.error || 'Unable to request approval');
        this.saving.set(false);
      }
    });
  }

  resolveApproval(id: string, status: 'approved' | 'rejected'): void {
    this.saving.set(true);
    this.api.post(`super-admin/action-approvals/${id}/resolve`, {
      status,
      ...this.safetyPayload()
    }).subscribe({
      next: () => {
        this.saving.set(false);
        this.load();
      },
      error: (error) => {
        this.error.set(error?.error?.error || 'Unable to resolve approval');
        this.saving.set(false);
      }
    });
  }

  applyBulkAction(): void {
    if (!this.selectedTenantIds().length) return;
    this.saving.set(true);
    this.api.post('super-admin/tenants/bulk-action', {
      action: this.bulkActionForm.value.action,
      planId: this.bulkActionForm.value.planId || '',
      emailSubject: this.bulkActionForm.value.emailSubject || '',
      emailBody: this.bulkActionForm.value.emailBody || '',
      tenantIds: this.selectedTenantIds(),
      ...this.safetyPayload()
    }).subscribe({
      next: () => {
        this.selectedTenantIds.set([]);
        this.saving.set(false);
        this.load();
      },
      error: (error) => {
        this.error.set(error?.error?.error || 'Unable to apply bulk action');
        this.saving.set(false);
      }
    });
  }

  broadcastHealthAlerts(): void {
    this.saving.set(true);
    this.api.post('super-admin/health-alerts/broadcast', {}).subscribe({
      next: () => {
        this.saving.set(false);
        this.load();
      },
      error: (error) => {
        this.error.set(error?.error?.error || 'Unable to broadcast health alerts');
        this.saving.set(false);
      }
    });
  }

  dispatchQuotaAlerts(): void {
    this.saving.set(true);
    this.api.post('super-admin/quota-alerts/dispatch', {}).subscribe({
      next: () => {
        this.saving.set(false);
        this.load();
      },
      error: (error) => {
        this.error.set(error?.error?.error || 'Unable to dispatch quota alerts');
        this.saving.set(false);
      }
    });
  }

  saveSupportNote(tenantId: string): void {
    if (this.supportNoteForm.invalid) return;
    this.saving.set(true);
    this.api.post(`super-admin/tenants/${tenantId}/support-notes`, this.supportNoteForm.value).subscribe({
      next: () => {
        this.supportNoteForm.reset({ note: '' });
        this.saving.set(false);
        this.load();
      },
      error: (error) => {
        this.error.set(error?.error?.error || 'Unable to add support note');
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
      limits: {
        branches: Number(this.planForm.value.branches || 0),
        staff: Number(this.planForm.value.staff || 0),
        clients: Number(this.planForm.value.clients || 0),
        monthlyAppointments: Number(this.planForm.value.monthlyAppointments || 0),
        campaigns: Number(this.planForm.value.campaigns || 0),
        supportTier: this.planForm.value.supportTier || 'standard'
      }
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
    const formValue = this.toggleForm.value;
    const rolloutPercentage = Math.max(0, Math.min(100, Number(formValue.rolloutPercentage || 0)));
    const payload = {
      ...formValue,
      tenantId: formValue.scope === 'tenant' ? formValue.tenantId : '',
      planId: formValue.scope === 'plan' ? formValue.planId : '',
      rolloutPercentage,
      rules: {
        rolloutPercentage,
        expiresAt: formValue.expiresAt || '',
        killSwitch: Boolean(formValue.killSwitch),
        dependencyKey: formValue.dependencyKey || ''
      }
    };
    this.api.post('super-admin/feature-toggles', payload).subscribe({
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

  editToggle(toggle: ApiRecord): void {
    this.toggleForm.patchValue({
      key: toggle.rules?.baseKey || String(toggle.key || '').split('::tenant::')[0].split('::plan::')[0],
      name: toggle.name || '',
      scope: toggle.scope || 'global',
      tenantId: toggle.tenantId || '',
      planId: toggle.planId || '',
      rolloutPercentage: toggle.rolloutPercentage ?? toggle.rules?.rolloutPercentage ?? 100,
      expiresAt: toggle.expiresAt || toggle.rules?.expiresAt || '',
      dependencyKey: toggle.dependencyKey || toggle.rules?.dependencyKey || '',
      enabled: Boolean(toggle.enabled),
      killSwitch: Boolean(toggle.killSwitch || toggle.rules?.killSwitch),
      description: toggle.description || ''
    });
  }

  featureFlagTone(toggle: ApiRecord): string {
    if (toggle.statusLabel === 'killed') return 'var(--danger,#dc2626)';
    if (toggle.statusLabel === 'expired') return 'var(--warning,#f59e0b)';
    if (toggle.statusLabel === 'partial') return 'var(--accent,#2563eb)';
    if (toggle.statusLabel === 'enabled') return 'var(--success,#16a34a)';
    return 'var(--muted,#6b7280)';
  }

  healthTone(score: number): string {
    if (Number(score || 0) >= 75) return 'var(--success,#16a34a)';
    if (Number(score || 0) >= 45) return 'var(--warning,#f59e0b)';
    return 'var(--danger,#dc2626)';
  }

  healthFlagTone(severity: string): string {
    if (severity === 'critical') return 'var(--danger,#dc2626)';
    if (severity === 'warning' || severity === 'watch') return 'var(--warning,#f59e0b)';
    return 'var(--success,#16a34a)';
  }

  churnTone(probability: string): string {
    if (probability === 'high') return 'var(--danger,#dc2626)';
    if (probability === 'medium') return 'var(--warning,#f59e0b)';
    return 'var(--success,#16a34a)';
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
