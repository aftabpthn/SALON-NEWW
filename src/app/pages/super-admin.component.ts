import { CommonModule, CurrencyPipe, DecimalPipe } from '@angular/common';
import { Component, OnInit, computed, signal } from '@angular/core';
import { FormsModule, ReactiveFormsModule, UntypedFormBuilder, Validators } from '@angular/forms';
import { ApiRecord, ApiService } from '../core/api.service';
import { AuthSessionService } from '../core/auth-session.service';
import { AppStateService } from '../core/state/app-state.service';
import { StateComponent } from '../shared/ui/state/state.component';
import { AuraKpiCardComponent } from '../shared/ui/aura-kpi-card/aura-kpi-card.component';

type TenantFilter = 'all' | 'active' | 'trial' | 'suspended' | 'risk' | 'paymentDue';
type AdminFormTab = 'subscription' | 'limits' | 'security' | 'sso' | 'exports' | 'features' | 'impersonation' | 'plans';
type DrawerTab = 'profile' | 'billing' | 'users' | 'branches' | 'limits' | 'audit' | 'support' | 'impersonation';

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

        <section class="super-admin-command" *ngIf="commandMetrics(overview) as command">
          <div class="command-heading">
            <div>
              <span class="eyebrow">Executive command center</span>
              <h2>Revenue, tenant risk and platform control</h2>
            </div>
            <div class="command-live">
              <span class="badge">{{ filteredTenants(overview.tenants).length }} visible</span>
              <span class="badge">{{ selectedTenantIds().length }} selected</span>
            </div>
          </div>
          <div class="command-kpi-grid">
            <article class="command-kpi accent">
              <span>MRR</span>
              <strong>{{ command.mrr | currency: 'INR':'symbol':'1.0-0' }}</strong>
              <small>{{ command.activeSalons }} active salons</small>
            </article>
            <article class="command-kpi danger">
              <span>Churn risk</span>
              <strong>{{ command.churnRisk }}</strong>
              <small>{{ command.mrrAtRisk | currency: 'INR':'symbol':'1.0-0' }} MRR at risk</small>
            </article>
            <article class="command-kpi warning">
              <span>Unpaid amount</span>
              <strong>{{ command.unpaid | currency: 'INR':'symbol':'1.0-0' }}</strong>
              <small>{{ command.paymentDue }} payment due</small>
            </article>
            <article class="command-kpi success">
              <span>Trials expiring</span>
              <strong>{{ command.trialsExpiring }}</strong>
              <small>{{ command.trials }} total trials</small>
            </article>
            <article class="command-kpi neutral">
              <span>Health score</span>
              <strong>{{ command.health | number: '1.0-1' }}</strong>
              <small>{{ command.highRisk }} high-risk tenants</small>
            </article>
            <article class="command-kpi security">
              <span>Security alerts</span>
              <strong>{{ command.securityAlerts }}</strong>
              <small>{{ command.securityGaps }} setup gaps</small>
            </article>
          </div>
        </section>

        <section class="ops-intel-grid">
          <article class="ops-intel-card" *ngFor="let item of operationalIntelligence(overview)">
            <div>
              <span class="eyebrow">{{ item.kind }}</span>
              <strong>{{ item.title }}</strong>
              <small>{{ item.detail }}</small>
            </div>
            <span class="ops-count" [class.is-danger]="item.tone === 'danger'" [class.is-warning]="item.tone === 'warning'">{{ item.count }}</span>
          </article>
        </section>

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
                  <strong>{{ tenantLabel(tenant) }}</strong>
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

        <section class="panel" *ngIf="overview.securityRiskCenter as risk">
          <div class="section-title">
            <div>
              <span class="eyebrow">Security Risk Center</span>
              <h2>Login risk, enterprise gaps and sensitive actions</h2>
            </div>
            <span class="badge" [style.background]="risk.metrics.criticalLogins ? 'var(--danger,#dc2626)' : risk.metrics.suspiciousLogins ? 'var(--warning,#f59e0b)' : 'var(--success,#16a34a)'" style="color:#fff">{{ risk.metrics.suspiciousLogins }} suspicious</span>
          </div>
          <div class="quick-grid">
            <article class="action-card">
              <strong>{{ risk.metrics.criticalLogins }}</strong>
              <span>Critical logins</span>
            </article>
            <article class="action-card">
              <strong>{{ risk.metrics.ipGaps }}</strong>
              <span>IP restriction gaps</span>
            </article>
            <article class="action-card">
              <strong>{{ risk.metrics.ssoGaps }}</strong>
              <span>SSO gaps</span>
            </article>
            <article class="action-card">
              <strong>{{ risk.metrics.exportGaps }}</strong>
              <span>Export control gaps</span>
            </article>
          </div>
          <div class="dashboard-grid">
            <div class="activity-list">
              <article *ngFor="let incident of risk.incidents">
                <div style="min-width:0">
                  <strong>{{ incident.tenantName }}</strong>
                  <span style="display:block;font-size:0.8em;color:var(--text-muted)">{{ incident.signal }} · {{ incident.summary }} · {{ incident.action }}</span>
                </div>
                <span class="badge" [style.background]="incident.severity === 'critical' ? 'var(--danger,#dc2626)' : 'var(--warning,#f59e0b)'" style="color:#fff">{{ incident.severity }}</span>
              </article>
              <article *ngIf="!risk.incidents.length">
                <div>
                  <strong>No security incidents</strong>
                  <span>SSO, IP, export and login risks are clear.</span>
                </div>
              </article>
            </div>
            <div class="activity-list">
              <article *ngFor="let action of risk.sensitiveActions">
                <div style="min-width:0">
                  <strong>{{ action.action }}</strong>
                  <span style="display:block;font-size:0.8em;color:var(--text-muted)">{{ action.tenantId }} · {{ action.summary }}</span>
                </div>
                <small>{{ action.createdAt }}</small>
              </article>
              <article *ngIf="!risk.sensitiveActions.length">
                <div>
                  <strong>No sensitive actions</strong>
                  <span>Impersonation, GDPR export and security-policy changes will appear here.</span>
                </div>
              </article>
            </div>
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
          <form [formGroup]="auditFilterForm" class="dashboard-grid" style="margin-bottom:16px">
            <label class="field"><span>Search action/target</span><input formControlName="query" /></label>
            <label class="field"><span>Actor</span><input formControlName="actor" /></label>
            <label class="field"><span>From</span><input type="date" formControlName="fromDate" /></label>
            <label class="field"><span>To</span><input type="date" formControlName="toDate" /></label>
            <div class="form-actions">
              <button class="ghost-button" type="button" (click)="auditFilterForm.reset({ query: '', actor: '', fromDate: '', toDate: '' })">Clear filters</button>
            </div>
          </form>
          <div class="table-wrap">
            <table>
              <thead>
                <tr><th>Time</th><th>Actor</th><th>Action</th><th>Target</th><th>Reason / Summary</th></tr>
              </thead>
              <tbody>
                <tr *ngFor="let event of filteredAuditTimeline(safety)">
                  <td>{{ event.createdAt }}</td>
                  <td>{{ event.actorUserId }}</td>
                  <td>{{ event.action }}</td>
                  <td>{{ event.targetType }} · {{ event.targetId }}</td>
                  <td>{{ event.reason || event.summary || event.status || 'Recorded' }}</td>
                </tr>
                <tr *ngIf="!filteredAuditTimeline(safety).length">
                  <td colspan="5">No audit events match these filters.</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <section class="panel" *ngIf="selectedTenant() as tenant">
          <div class="section-title">
            <div>
              <span class="eyebrow">Tenant 360</span>
              <h2>{{ tenantLabel(tenant) }} account health, billing risk and adoption</h2>
            </div>
            <label class="field" style="max-width:280px;margin:0">
              <span>Selected salon</span>
              <select [ngModel]="selectedTenantId()" (ngModelChange)="selectTenant($event)">
                <option *ngFor="let item of overview.tenants" [value]="item.id">{{ tenantLabel(item) }}</option>
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
          <div class="quick-grid" *ngIf="overview.revenueGrowthSummary as summary">
            <article class="action-card">
              <strong>{{ summary.latestMrr | currency: 'INR':'symbol':'1.0-0' }}</strong>
              <span>{{ summary.latestMonth }} MRR · {{ summary.momentum }}</span>
            </article>
            <article class="action-card">
              <strong>{{ summary.latestArr | currency: 'INR':'symbol':'1.0-0' }}</strong>
              <span>Current ARR run-rate</span>
            </article>
            <article class="action-card">
              <strong>{{ summary.netGrowth | currency: 'INR':'symbol':'1.0-0' }}</strong>
              <span>Net MRR growth vs previous month</span>
            </article>
            <article class="action-card">
              <strong>{{ summary.totalChurnedMrr | currency: 'INR':'symbol':'1.0-0' }}</strong>
              <span>6-month churn overlay</span>
            </article>
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
          <div class="quick-grid" *ngIf="churn.riskMix">
            <article class="action-card">
              <strong>{{ churn.riskMix.highMrr | currency: 'INR':'symbol':'1.0-0' }}</strong>
              <span>High-risk MRR</span>
            </article>
            <article class="action-card">
              <strong>{{ churn.riskMix.mediumMrr | currency: 'INR':'symbol':'1.0-0' }}</strong>
              <span>Medium-risk MRR</span>
            </article>
            <article class="action-card">
              <strong>{{ churn.urgentActions?.length || 0 }}</strong>
              <span>Retention actions due</span>
            </article>
          </div>
          <div class="activity-list" *ngIf="churn.urgentActions?.length" style="margin-bottom:16px">
            <article *ngFor="let action of churn.urgentActions" style="display:grid;grid-template-columns:1fr 150px 120px;gap:12px;align-items:center">
              <div style="min-width:0">
                <strong>{{ action.name }}</strong>
                <span style="display:block;font-size:0.8em;color:var(--text-muted)">{{ action.recommendedAction }} · {{ action.ownerQueue }}</span>
              </div>
              <span class="badge" [style.background]="churnTone(action.probability)" style="color:#fff">{{ action.dueInDays }}d SLA</span>
              <strong style="text-align:right">{{ action.mrrAtRisk | currency: 'INR':'symbol':'1.0-0' }}</strong>
            </article>
          </div>
          <div class="activity-list">
            <article *ngFor="let tenant of churn.tenants" style="display:grid;grid-template-columns:1fr 170px 120px;gap:12px;align-items:center">
              <div style="min-width:0">
                <strong>{{ tenant.name }}</strong>
                <span style="display:block;font-size:0.8em;color:var(--text-muted)">{{ tenant.planName }} · {{ tenant.drivers.join(' · ') || 'watch' }} · {{ tenant.recommendedAction }}</span>
                <span style="display:block;font-size:0.78em;color:var(--text-muted)">Playbook: {{ tenant.playbook?.join(' · ') || 'Monitor' }} · confidence {{ tenant.confidence || 0 }}%</span>
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
              <h2>Tenant Command Table 2.0</h2>
            </div>
            <span class="badge">{{ selectedTenantIds().length }} selected</span>
          </div>
          <div class="tenant-command-toolbar">
            <label class="tenant-search">
              <span>Search tenant</span>
              <input
                [ngModel]="tenantSearch()"
                (ngModelChange)="tenantSearch.set($event)"
                [ngModelOptions]="{ standalone: true }"
                placeholder="Salon, domain, email, plan" />
            </label>
            <div class="filter-strip" role="group" aria-label="Tenant filters">
              <button type="button" [class.active]="tenantFilter() === 'all'" (click)="tenantFilter.set('all')">All <span>{{ tenantFilterCount(overview.tenants, 'all') }}</span></button>
              <button type="button" [class.active]="tenantFilter() === 'active'" (click)="tenantFilter.set('active')">Active <span>{{ tenantFilterCount(overview.tenants, 'active') }}</span></button>
              <button type="button" [class.active]="tenantFilter() === 'trial'" (click)="tenantFilter.set('trial')">Trial <span>{{ tenantFilterCount(overview.tenants, 'trial') }}</span></button>
              <button type="button" [class.active]="tenantFilter() === 'suspended'" (click)="tenantFilter.set('suspended')">Suspended <span>{{ tenantFilterCount(overview.tenants, 'suspended') }}</span></button>
              <button type="button" [class.active]="tenantFilter() === 'risk'" (click)="tenantFilter.set('risk')">High Risk <span>{{ tenantFilterCount(overview.tenants, 'risk') }}</span></button>
              <button type="button" [class.active]="tenantFilter() === 'paymentDue'" (click)="tenantFilter.set('paymentDue')">Payment Due <span>{{ tenantFilterCount(overview.tenants, 'paymentDue') }}</span></button>
            </div>
          </div>
          <form [formGroup]="bulkActionForm" (ngSubmit)="applyBulkAction()" class="dashboard-grid" style="margin-bottom:16px">
            <label class="field">
              <span>Bulk action</span>
              <select formControlName="action">
                <option value="suspend">Suspend selected</option>
                <option value="reactivate">Reactivate selected</option>
                <option value="changePlan">Change plan</option>
                <option value="sendEmail">Send email</option>
                <option value="export">Queue data export</option>
                <option value="assignOwner">Assign support owner</option>
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
            <label class="field" *ngIf="bulkActionForm.value.action === 'assignOwner'">
              <span>Support owner / queue</span>
              <input formControlName="supportOwner" placeholder="customer_success_urgent" />
            </label>
            <div class="form-actions">
              <button class="ghost-button" type="button" (click)="selectAllTenants(filteredTenants(overview.tenants))">Select visible</button>
              <button class="ghost-button" type="button" (click)="selectedTenantIds.set([])">Clear</button>
              <button class="primary-button" type="submit" [disabled]="!selectedTenantIds().length || saving()">Apply bulk action</button>
            </div>
          </form>
          <div class="bulk-command-bar" *ngIf="selectedTenantIds().length">
            <strong>{{ selectedTenantIds().length }} selected</strong>
            <button type="button" (click)="prepareBulkCommand('changePlan')">Change plan</button>
            <button type="button" (click)="runBulkCommand('suspend')" [disabled]="saving()">Suspend</button>
            <button type="button" (click)="runBulkCommand('reactivate')" [disabled]="saving()">Reactivate</button>
            <button type="button" (click)="prepareBulkCommand('sendEmail')">Send email</button>
            <button type="button" (click)="prepareBulkCommand('export')">Export</button>
            <button type="button" (click)="prepareBulkCommand('assignOwner')">Assign owner</button>
            <span>Dangerous actions need CONFIRM</span>
          </div>
          <div class="quick-grid" *ngIf="bulkSelectionSummary(filteredTenants(overview.tenants)) as bulk">
            <article class="action-card">
              <strong>{{ bulk.count }}</strong>
              <span>Selected tenants</span>
            </article>
            <article class="action-card">
              <strong>{{ bulk.mrr | currency: 'INR':'symbol':'1.0-0' }}</strong>
              <span>Selected MRR impact</span>
            </article>
            <article class="action-card">
              <strong>{{ bulk.highRisk }}</strong>
              <span>High-risk selected</span>
            </article>
            <article class="action-card">
              <strong>{{ bulk.outstanding | currency: 'INR':'symbol':'1.0-0' }}</strong>
              <span>Outstanding exposure</span>
            </article>
          </div>
          <div class="activity-list" *ngIf="selectedTenants(filteredTenants(overview.tenants)).length" style="margin-bottom:16px">
            <article *ngFor="let tenant of selectedTenants(filteredTenants(overview.tenants)).slice(0, 6)" style="display:flex;align-items:center;justify-content:space-between;gap:12px">
              <div style="min-width:0">
                <strong>{{ tenant.name }}</strong>
                <span style="display:block;font-size:0.8em;color:var(--text-muted)">{{ tenant.planName }} · {{ tenant.subscriptionStatus }} · health {{ tenant.healthScore | number: '1.0-1' }}</span>
              </div>
              <span class="badge" [style.background]="healthFlagTone(tenant.healthFlag?.severity)" style="color:#fff">{{ tenant.healthFlag?.label || 'Healthy' }}</span>
            </article>
          </div>
          <div class="table-wrap super-admin-tenant-wrap">
            <table class="super-admin-tenant-table">
              <thead>
                <tr><th class="select-col"></th><th class="salon-col">Salon</th><th class="plan-col">Plan</th><th class="status-col">Status</th><th class="money-col">Billing</th><th class="money-col">Sales</th><th class="usage-col">Usage</th><th class="health-col">Health</th><th class="flag-col">Flag</th><th class="actions-col">Actions</th></tr>
              </thead>
              <tbody>
                <tr *ngFor="let tenant of filteredTenants(overview.tenants)" style="cursor:pointer" (click)="openTenantDrilldown(tenant.id)">
                  <td class="select-col">
                    <input type="checkbox" [checked]="isTenantSelected(tenant.id)" (click)="$event.stopPropagation()" (change)="toggleTenantSelection(tenant.id)" />
                  </td>
                  <td class="salon-cell"><strong>{{ tenantLabel(tenant) }}</strong><small>{{ tenant.ownerEmail }} · {{ tenant.primaryDomain }}</small></td>
                  <td class="plan-cell">{{ tenant.planName }}</td>
                  <td class="status-cell">
                    <span class="badge">{{ tenant.subscriptionStatus }}</span>
                    <small style="display:block;color:var(--text-muted)">
                      <span class="badge" [style.background]="healthFlagTone(tenant.billingOps?.dunningSeverity)" style="color:#fff">{{ tenant.billingOps?.dunningStatus || 'Clear' }}</span>
                      {{ tenant.billingOps?.failedPaymentCount || 0 }} failed
                    </small>
                    <small style="display:block;color:var(--text-muted)">
                      IP {{ tenant.enterpriseSecurity?.ipRestrictionStatus || tenant.ipAllowlist?.status || 'disabled' }} · SSO {{ tenant.enterpriseSecurity?.ssoStatus || 'not_configured' }} · Export {{ tenant.enterpriseSecurity?.dataExportStatus || tenant.dataExportControls?.status || 'open' }}
                    </small>
                    <small style="display:block;color:var(--text-muted)">Roles {{ tenant.rolePermissionMatrix?.summary || 'default matrix' }}</small>
                  </td>
                  <td class="money-cell">{{ tenant.totalBillingAmount | currency: 'INR':'symbol':'1.0-0' }}<small>{{ tenant.meteredUsageRevenue | currency: 'INR':'symbol':'1.0-0' }} usage</small></td>
                  <td class="money-cell">{{ tenant.transactionRevenue | currency: 'INR':'symbol':'1.0-0' }}</td>
                  <td class="usage-cell">
                    {{ tenant.usage.clients }} clients · {{ tenant.usage.appointments }} bookings
                    <small style="display:block;color:var(--text-muted)">
                      {{ tenant.usage.branches }}/{{ tenant.tenantLimits?.branches }} branches · {{ tenant.usage.staff }}/{{ tenant.tenantLimits?.staff }} staff · {{ tenant.usage.clients }}/{{ tenant.tenantLimits?.clients }} clients
                    </small>
                  </td>
                  <td class="health-cell">{{ tenant.healthScore | number: '1.0-1' }}</td>
                  <td class="flag-cell">
                    <span class="badge" [style.background]="tenantRiskTone(tenant)" style="color:#fff">{{ tenantRiskLabel(tenant) }}</span>
                    <span class="badge" [style.background]="healthFlagTone(tenant.healthFlag?.severity)" style="color:#fff">
                      {{ tenant.healthFlag?.label || 'Healthy' }}
                    </span>
                    <small style="display:block;color:var(--text-muted)">{{ tenant.healthFlag?.reason }}</small>
                  </td>
                  <td class="actions-cell">
                    <div class="row-action-shell">
                      <button class="icon-menu-button" type="button" title="Tenant actions" (click)="$event.stopPropagation(); toggleActionMenu(tenant.id)">
                        ...
                      </button>
                      <div class="row-action-menu" *ngIf="actionMenuTenantId() === tenant.id" (click)="$event.stopPropagation()">
                        <button type="button" (click)="openTenantDrilldown(tenant.id); closeActionMenu()">Open Tenant 360</button>
                        <button type="button" (click)="selectTenant(tenant.id); setDrawerTab('profile'); closeActionMenu()">Profile</button>
                        <button type="button" (click)="editTenantLimits(tenant); setAdminFormTab('limits'); closeActionMenu()">Limits</button>
                        <button type="button" (click)="editIpAllowlist(tenant); setAdminFormTab('security'); closeActionMenu()">IP rules</button>
                        <button type="button" (click)="editTenantSso(tenant); setAdminFormTab('sso'); closeActionMenu()">SSO</button>
                        <button type="button" (click)="editDataExportControls(tenant); setAdminFormTab('exports'); closeActionMenu()">Export controls</button>
                        <button type="button" (click)="editRolePermissionMatrix(tenant); setAdminFormTab('security'); closeActionMenu()">Roles</button>
                        <button type="button" (click)="prepareTenantFeatureOverride(tenant); setAdminFormTab('features'); closeActionMenu()">Override</button>
                        <button type="button" (click)="prepareImpersonation(tenant); setAdminFormTab('impersonation'); closeActionMenu()">Impersonate</button>
                        <a [href]="tenant.supportLinks?.intercom" target="_blank" rel="noreferrer">Intercom</a>
                        <a [href]="tenant.supportLinks?.zendesk" target="_blank" rel="noreferrer">Zendesk</a>
                        <button type="button" class="danger-action" (click)="toggleTenant(tenant); closeActionMenu()">{{ tenant.subscriptionStatus === 'suspended' ? 'Reactivate' : 'Suspend' }}</button>
                      </div>
                    </div>
                  </td>
                </tr>
                <tr *ngIf="!filteredTenants(overview.tenants).length">
                  <td colspan="10" class="empty-command-row">No tenants match this command filter.</td>
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
                <h2>{{ tenantLabel(tenant) }} full profile, usage, invoices and audit log</h2>
              </div>
              <button class="ghost-button mini" type="button" (click)="drilldownOpen.set(false)">Close</button>
            </div>
            <div class="drawer-tabs" role="tablist" aria-label="Tenant 360 sections">
              <button type="button" [class.active]="drawerTab() === 'profile'" (click)="setDrawerTab('profile')">Profile</button>
              <button type="button" [class.active]="drawerTab() === 'billing'" (click)="setDrawerTab('billing')">Billing</button>
              <button type="button" [class.active]="drawerTab() === 'users'" (click)="setDrawerTab('users')">Users</button>
              <button type="button" [class.active]="drawerTab() === 'branches'" (click)="setDrawerTab('branches')">Branches</button>
              <button type="button" [class.active]="drawerTab() === 'limits'" (click)="setDrawerTab('limits')">Limits</button>
              <button type="button" [class.active]="drawerTab() === 'audit'" (click)="setDrawerTab('audit')">Audit</button>
              <button type="button" [class.active]="drawerTab() === 'support'" (click)="setDrawerTab('support')">Support</button>
              <button type="button" [class.active]="drawerTab() === 'impersonation'" (click)="setDrawerTab('impersonation')">Impersonation</button>
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

            <div class="drawer-focus-card">
              <ng-container [ngSwitch]="drawerTab()">
                <article *ngSwitchCase="'profile'">
                  <strong>Profile</strong>
                  <span>{{ tenant.ownerEmail || 'Owner pending' }} · {{ tenant.primaryDomain || 'Domain pending' }} · {{ tenant.planName || 'No plan' }}</span>
                </article>
                <article *ngSwitchCase="'billing'">
                  <strong>Billing</strong>
                  <span>{{ tenant.drilldown?.invoiceSummary?.outstanding | currency: 'INR':'symbol':'1.0-0' }} outstanding · {{ tenant.billingOps?.dunningStatus || 'Clear' }} · {{ tenant.billingOps?.failedPaymentCount || 0 }} failed payments</span>
                </article>
                <article *ngSwitchCase="'users'">
                  <strong>Users</strong>
                  <span>{{ tenant.drilldown?.tenantUserCount || 0 }} tenant users · {{ tenant.drilldown?.staffCount || 0 }} staff · last login {{ tenant.drilldown?.lastLoginAt || 'No login' }}</span>
                </article>
                <article *ngSwitchCase="'branches'">
                  <strong>Branches</strong>
                  <span>{{ tenant.usage?.branches || 0 }} used / {{ tenant.tenantLimits?.branches || 0 }} allowed · support tier {{ tenant.tenantLimits?.supportTier || 'standard' }}</span>
                </article>
                <article *ngSwitchCase="'limits'">
                  <strong>Limits</strong>
                  <span>{{ tenant.usage?.staff || 0 }}/{{ tenant.tenantLimits?.staff || 0 }} staff · {{ tenant.usage?.clients || 0 }}/{{ tenant.tenantLimits?.clients || 0 }} clients · {{ tenant.usage?.appointments || 0 }} bookings</span>
                </article>
                <article *ngSwitchCase="'audit'">
                  <strong>Audit</strong>
                  <span>{{ tenant.drilldown?.auditTrail?.length || 0 }} audit events · IP {{ tenant.enterpriseSecurity?.ipRestrictionStatus || 'not_required' }} · SSO {{ tenant.enterpriseSecurity?.ssoStatus || 'not_configured' }}</span>
                </article>
                <article *ngSwitchCase="'support'">
                  <strong>Support notes</strong>
                  <span>{{ tenant.drilldown?.supportNotes?.length || 0 }} notes · {{ tenant.supportLinks?.internal || 'No internal ticket linked' }}</span>
                </article>
                <article *ngSwitchCase="'impersonation'">
                  <strong>Impersonation controls</strong>
                  <span>Audited session with restricted refunds, payroll, password changes and destructive deletes.</span>
                </article>
              </ng-container>
            </div>

            <div class="dashboard-grid">
              <div class="activity-list">
                <article>
                  <div>
                    <strong>Profile</strong>
                    <span>{{ tenant.ownerEmail }} · {{ tenant.primaryDomain || 'Domain pending' }} · {{ tenant.planName }}</span>
                    <span style="display:block;font-size:0.8em;color:var(--text-muted)">IP allowlist: {{ tenant.ipAllowlist?.summary || 'disabled' }} · {{ tenant.ipAllowlist?.mode || 'enforce' }}</span>
                    <span style="display:block;font-size:0.8em;color:var(--text-muted)">Enterprise security: IP {{ tenant.enterpriseSecurity?.ipRestrictionStatus || 'not_required' }} · SSO {{ tenant.enterpriseSecurity?.ssoStatus || 'not_configured' }} · Export {{ tenant.enterpriseSecurity?.dataExportStatus || 'not_required' }}</span>
                    <span style="display:block;font-size:0.8em;color:var(--text-muted)">Data export: {{ tenant.dataExportControls?.summary || 'default controls' }}</span>
                    <span style="display:flex;gap:8px;flex-wrap:wrap;margin-top:8px">
                      <a class="ghost-button mini" [href]="tenant.supportLinks?.internal" target="_blank" rel="noreferrer">Support ticket</a>
                      <a class="ghost-button mini" [href]="tenant.supportLinks?.intercom" target="_blank" rel="noreferrer">Intercom</a>
                      <a class="ghost-button mini" [href]="tenant.supportLinks?.zendesk" target="_blank" rel="noreferrer">Zendesk</a>
                    </span>
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

              <div class="activity-list">
                <article *ngFor="let user of tenant.drilldown.recentUsers">
                  <div>
                    <strong>{{ user.name }}</strong>
                    <span>{{ user.email }} · {{ user.role }} · {{ user.branchIds.join(', ') || 'All branches' }}</span>
                    <span style="display:block;font-size:0.78em;color:var(--text-muted)">Last login {{ user.lastLoginAt || 'No login' }} · failed {{ user.failedLoginCount || 0 }}</span>
                  </div>
                  <span class="badge">{{ user.status || 'active' }}</span>
                </article>
                <article *ngIf="!tenant.drilldown.recentUsers.length">
                  <div>
                    <strong>No tenant users found</strong>
                    <span>Staff and owner users will appear here.</span>
                  </div>
                </article>
              </div>
            </div>

            <div class="dashboard-grid" style="margin-top:16px">
              <section class="form-panel">
                <h3>Login Activity Map</h3>
                <div class="quick-grid">
                  <article class="action-card">
                    <strong>{{ tenant.drilldown.loginActivityMap?.activeUsers || 0 }}</strong>
                    <span>Active users</span>
                  </article>
                  <article class="action-card">
                    <strong>{{ tenant.drilldown.loginActivityMap?.trustedDevices || 0 }}</strong>
                    <span>Trusted devices</span>
                  </article>
                  <article class="action-card">
                    <strong>{{ tenant.drilldown.loginActivityMap?.riskEvents || 0 }}</strong>
                    <span>Risk events</span>
                  </article>
                  <article class="action-card">
                    <strong>{{ tenant.drilldown.loginActivityMap?.suspiciousLogins || 0 }}</strong>
                    <span>Suspicious logins</span>
                  </article>
                </div>
                <div class="activity-list" style="margin-top:12px">
                  <article *ngFor="let geo of tenant.drilldown.loginActivityMap?.geoMap || []" style="display:grid;grid-template-columns:1fr 130px;gap:12px;align-items:center">
                    <div style="min-width:0">
                      <strong>{{ geo.label }}</strong>
                      <span style="display:block;font-size:0.8em;color:var(--text-muted)">{{ geo.users.join(', ') || 'No user' }} · {{ geo.ipAddresses.join(', ') || 'No IP' }}</span>
                      <span style="display:block;height:6px;background:var(--surface-muted,#e5e7eb);border-radius:999px;margin-top:8px;overflow:hidden">
                        <span [style.width.%]="usageBarWidth(geo.value, tenant.drilldown.loginActivityMap?.geoMap || [])" [style.background]="geo.critical ? 'var(--danger,#dc2626)' : geo.suspicious ? 'var(--warning,#f59e0b)' : 'var(--success,#16a34a)'" style="display:block;height:100%"></span>
                      </span>
                    </div>
                    <div style="text-align:right">
                      <span class="badge" [style.background]="geo.critical ? 'var(--danger,#dc2626)' : geo.suspicious ? 'var(--warning,#f59e0b)' : 'var(--success,#16a34a)'" style="color:#fff">{{ geo.suspicious }} suspicious</span>
                      <strong style="display:block">{{ geo.value }}</strong>
                    </div>
                  </article>
                  <article *ngFor="let location of tenant.drilldown.loginActivityMap?.locations || []" style="display:grid;grid-template-columns:1fr 120px;gap:12px;align-items:center">
                    <div style="min-width:0">
                      <strong>{{ location.label }}</strong>
                      <span style="display:block;font-size:0.8em;color:var(--text-muted)">{{ location.users.join(', ') || 'No user' }} · {{ location.ipAddresses.join(', ') || 'No IP' }}</span>
                      <span style="display:block;height:6px;background:var(--surface-muted,#e5e7eb);border-radius:999px;margin-top:8px;overflow:hidden">
                        <span [style.width.%]="usageBarWidth(location.value, tenant.drilldown.loginActivityMap?.locations || [])" style="display:block;height:100%;background:var(--accent,#2563eb)"></span>
                      </span>
                    </div>
                    <div style="text-align:right">
                      <strong>{{ location.value }}</strong>
                      <span style="display:block;font-size:0.78em;color:var(--text-muted)">{{ location.riskEvents }} risk · {{ location.suspicious || 0 }} suspicious</span>
                    </div>
                  </article>
                  <article *ngFor="let event of tenant.drilldown.loginActivityMap?.suspiciousActivity || []" style="display:grid;grid-template-columns:1fr 100px;gap:12px;align-items:center">
                    <div style="min-width:0">
                      <strong>{{ event.userName }}</strong>
                      <span style="display:block;font-size:0.8em;color:var(--text-muted)">{{ event.ipAddress || 'No IP' }} · {{ event.geo?.label || 'Unknown location' }} · {{ event.reasons.join(' · ') || 'watch' }}</span>
                    </div>
                    <span class="badge" [style.background]="event.level === 'critical' ? 'var(--danger,#dc2626)' : event.level === 'suspicious' ? 'var(--warning,#f59e0b)' : 'var(--accent,#2563eb)'" style="color:#fff">{{ event.level }} {{ event.score }}</span>
                  </article>
                  <article *ngIf="!(tenant.drilldown.loginActivityMap?.locations || []).length">
                    <div>
                      <strong>No login activity mapped</strong>
                      <span>Recent login/device signals will appear here.</span>
                    </div>
                  </article>
                </div>
              </section>

              <section class="form-panel">
                <h3>GDPR Tenant Export</h3>
                <form [formGroup]="gdprExportForm" (ngSubmit)="initiateGdprExport(tenant)">
                  <label class="field full"><span>Reason</span><textarea formControlName="reason"></textarea></label>
                  <label class="field"><span>Confirmation</span><input formControlName="confirmation" /></label>
                  <div class="form-actions">
                    <button class="primary-button" type="submit" [disabled]="gdprExportForm.invalid || saving()">Initiate export</button>
                  </div>
                </form>
                <div class="activity-list" style="margin-top:12px">
                  <article *ngFor="let request of tenant.drilldown.gdprExportRequests">
                    <div>
                      <strong>{{ request.status }}</strong>
                      <span>{{ request.summary }}</span>
                    </div>
                    <small>{{ request.createdAt }}</small>
                  </article>
                  <article *ngIf="!tenant.drilldown.gdprExportRequests.length">
                    <div>
                      <strong>No GDPR export requests</strong>
                      <span>Initiated exports will appear in privacy request history.</span>
                    </div>
                  </article>
                </div>
              </section>
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

        <div class="admin-form-tabs" role="tablist" aria-label="Advanced admin forms">
          <button type="button" [class.active]="adminFormTab() === 'subscription'" (click)="setAdminFormTab('subscription')">Subscription</button>
          <button type="button" [class.active]="adminFormTab() === 'limits'" (click)="setAdminFormTab('limits')">Limits</button>
          <button type="button" [class.active]="adminFormTab() === 'security'" (click)="setAdminFormTab('security')">Security</button>
          <button type="button" [class.active]="adminFormTab() === 'sso'" (click)="setAdminFormTab('sso')">SSO</button>
          <button type="button" [class.active]="adminFormTab() === 'exports'" (click)="setAdminFormTab('exports')">Export controls</button>
          <button type="button" [class.active]="adminFormTab() === 'features'" (click)="setAdminFormTab('features')">Feature overrides</button>
          <button type="button" [class.active]="adminFormTab() === 'impersonation'" (click)="setAdminFormTab('impersonation')">Impersonation</button>
          <button type="button" [class.active]="adminFormTab() === 'plans'" (click)="setAdminFormTab('plans')">Plans</button>
        </div>

        <div class="dashboard-grid admin-form-grid">
          <section class="form-panel" *ngIf="adminFormTab() === 'limits'">
            <h3>Tenant limits</h3>
            <form [formGroup]="tenantLimitsForm" (ngSubmit)="saveTenantLimits()">
              <label class="field">
                <span>Tenant</span>
                <select formControlName="tenantId" (change)="loadTenantLimitForm()">
                  <option value="">Select tenant</option>
                  <option *ngFor="let tenant of overview.tenants" [value]="tenant.id">{{ tenantLabel(tenant) }}</option>
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

          <section class="form-panel" *ngIf="adminFormTab() === 'security'">
            <h3>IP Allowlist per Tenant</h3>
            <form [formGroup]="ipAllowlistForm" (ngSubmit)="saveIpAllowlist()">
              <label class="field">
                <span>Tenant</span>
                <select formControlName="tenantId" (change)="loadIpAllowlistForm()">
                  <option value="">Select tenant</option>
                  <option *ngFor="let tenant of overview.tenants" [value]="tenant.id">{{ tenantLabel(tenant) }}</option>
                </select>
              </label>
              <label class="field">
                <span>Mode</span>
                <select formControlName="mode">
                  <option value="enforce">Enforce</option>
                  <option value="monitor">Monitor only</option>
                </select>
              </label>
              <label class="field check-line"><input type="checkbox" formControlName="enabled" /><span>Enable allowlist</span></label>
              <label class="field full"><span>Allowed IPs / CIDR</span><textarea formControlName="entriesText" placeholder="203.0.113.10&#10;198.51.100.0/24"></textarea></label>
              <label class="field full"><span>Reason</span><textarea formControlName="reason"></textarea></label>
              <div class="form-actions">
                <button class="primary-button" type="submit" [disabled]="ipAllowlistForm.invalid || saving()">Save IP allowlist</button>
              </div>
            </form>
          </section>

          <section class="form-panel" *ngIf="adminFormTab() === 'sso'">
            <h3>SSO / SAML Management</h3>
            <form [formGroup]="ssoForm" (ngSubmit)="saveTenantSso()">
              <label class="field">
                <span>Tenant</span>
                <select formControlName="tenantId" (change)="loadSsoForm()">
                  <option value="">Select tenant</option>
                  <option *ngFor="let tenant of overview.tenants" [value]="tenant.id">{{ tenantLabel(tenant) }}</option>
                </select>
              </label>
              <label class="field">
                <span>Provider</span>
                <select formControlName="provider">
                  <option value="saml">SAML</option>
                  <option value="azure-ad">Azure AD</option>
                  <option value="okta">Okta</option>
                  <option value="google-workspace">Google Workspace</option>
                </select>
              </label>
              <label class="field"><span>Domain hint</span><input formControlName="domainHint" /></label>
              <label class="field"><span>Enforce roles</span><input formControlName="enforceForRoles" /></label>
              <label class="field">
                <span>Status</span>
                <select formControlName="status">
                  <option value="draft">Draft</option>
                  <option value="ready">Ready</option>
                  <option value="active">Active</option>
                  <option value="enforced">Enforced</option>
                  <option value="disabled">Disabled</option>
                </select>
              </label>
              <label class="field full"><span>Reason</span><textarea formControlName="reason"></textarea></label>
              <div class="form-actions">
                <button class="primary-button" type="submit" [disabled]="ssoForm.invalid || saving()">Save SSO</button>
              </div>
            </form>
          </section>

          <section class="form-panel" *ngIf="adminFormTab() === 'exports'">
            <h3>Data Export Controls</h3>
            <form [formGroup]="dataExportControlsForm" (ngSubmit)="saveDataExportControls()">
              <label class="field">
                <span>Tenant</span>
                <select formControlName="tenantId" (change)="loadDataExportControlsForm()">
                  <option value="">Select tenant</option>
                  <option *ngFor="let tenant of overview.tenants" [value]="tenant.id">{{ tenantLabel(tenant) }}</option>
                </select>
              </label>
              <label class="field"><span>Allowed formats</span><input formControlName="formatsText" /></label>
              <label class="field"><span>Max rows</span><input type="number" min="100" formControlName="maxRows" /></label>
              <label class="field"><span>Retention days</span><input type="number" min="1" formControlName="retentionDays" /></label>
              <label class="field check-line"><input type="checkbox" formControlName="enabled" /><span>Exports enabled</span></label>
              <label class="field check-line"><input type="checkbox" formControlName="approvalRequired" /><span>Require approval</span></label>
              <label class="field check-line"><input type="checkbox" formControlName="piiMasking" /><span>PII masking</span></label>
              <label class="field check-line"><input type="checkbox" formControlName="watermark" /><span>Watermark files</span></label>
              <label class="field full"><span>Reason</span><textarea formControlName="reason"></textarea></label>
              <div class="form-actions">
                <button class="primary-button" type="submit" [disabled]="dataExportControlsForm.invalid || saving()">Save export controls</button>
              </div>
            </form>
          </section>

          <section class="form-panel" *ngIf="adminFormTab() === 'security'">
            <h3>Role & Permission Matrix</h3>
            <form [formGroup]="rolePermissionMatrixForm" (ngSubmit)="saveRolePermissionMatrix()">
              <label class="field">
                <span>Tenant</span>
                <select formControlName="tenantId" (change)="loadRolePermissionMatrixForm()">
                  <option value="">Select tenant</option>
                  <option *ngFor="let tenant of overview.tenants" [value]="tenant.id">{{ tenantLabel(tenant) }}</option>
                </select>
              </label>
              <label class="field">
                <span>Role</span>
                <select formControlName="role" (change)="selectRolePermissionRole()">
                  <option value="owner">Owner</option>
                  <option value="admin">Admin</option>
                  <option value="manager">Manager</option>
                  <option value="cashier">Cashier</option>
                  <option value="accountant">Accountant</option>
                  <option value="staff">Staff</option>
                </select>
              </label>
              <label class="field full"><span>Permissions</span><textarea formControlName="permissionsText" placeholder="bookings.read&#10;bookings.write&#10;clients.read"></textarea></label>
              <label class="field full"><span>Reason</span><textarea formControlName="reason"></textarea></label>
              <div class="form-actions">
                <button class="primary-button" type="submit" [disabled]="rolePermissionMatrixForm.invalid || saving()">Save role matrix</button>
              </div>
            </form>
            <div class="activity-list" style="margin-top:12px" *ngIf="rolePermissionMatrixTenant(overview.tenants) as tenant">
              <article>
                <div>
                  <strong>{{ tenant.rolePermissionMatrix?.summary }}</strong>
                  <span>Privileged roles: {{ tenant.rolePermissionMatrix?.privilegedRoles?.join(', ') || 'none' }}</span>
                </div>
              </article>
              <article *ngFor="let row of tenant.rolePermissionMatrix?.roleRows || []">
                <div>
                  <strong>{{ row.role }} · {{ row.permissionCount }} grants</strong>
                  <span>{{ row.permissions.join(', ') || 'No grants' }}</span>
                </div>
              </article>
            </div>
          </section>

          <section class="form-panel" *ngIf="adminFormTab() === 'features'">
            <h3>Per-Tenant Feature Override</h3>
            <form [formGroup]="tenantFeatureOverrideForm" (ngSubmit)="saveTenantFeatureOverride()">
              <label class="field">
                <span>Tenant</span>
                <select formControlName="tenantId">
                  <option value="">Select tenant</option>
                  <option *ngFor="let tenant of overview.tenants" [value]="tenant.id">{{ tenantLabel(tenant) }}</option>
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

          <section class="form-panel" *ngIf="adminFormTab() === 'impersonation'">
            <h3>Impersonate tenant</h3>
            <form [formGroup]="impersonationForm" (ngSubmit)="startImpersonation()">
              <label class="field">
                <span>Tenant</span>
                <select formControlName="tenantId">
                  <option value="">Select tenant</option>
                  <option *ngFor="let tenant of overview.tenants" [value]="tenant.id">{{ tenantLabel(tenant) }}</option>
                </select>
              </label>
              <label class="field"><span>Open path</span><input formControlName="returnPath" /></label>
              <label class="field"><span>Branch scope</span><input formControlName="branchId" placeholder="Auto first branch" /></label>
              <label class="field full"><span>Debug reason</span><textarea formControlName="reason"></textarea></label>
              <label class="field"><span>Confirmation</span><input formControlName="confirmation" placeholder="Type IMPERSONATE" /></label>
              <div class="form-actions">
                <button class="primary-button" type="submit" [disabled]="impersonationForm.invalid || saving()">Start impersonation</button>
              </div>
            </form>
            <div class="activity-list" *ngIf="impersonationTenant(overview.tenants) as tenant" style="margin-top:12px">
              <article>
                <div>
                  <strong>{{ tenant.name }}</strong>
                  <span>{{ tenant.planName }} · {{ tenant.subscriptionStatus }} · health {{ tenant.healthScore | number: '1.0-1' }}</span>
                  <span style="display:block;font-size:0.78em;color:var(--text-muted)">Session will be audited and restricted from refunds, payroll, password changes and destructive deletes.</span>
                </div>
                <span class="badge">{{ tenant.drilldown?.tenantUserCount || 0 }} users</span>
              </article>
            </div>
          </section>

          <section class="form-panel" *ngIf="adminFormTab() === 'subscription'">
            <h3>Subscription management</h3>
            <form [formGroup]="subscriptionForm" (ngSubmit)="updateSubscription()">
              <label class="field">
                <span>Tenant</span>
                <select formControlName="tenantId">
                  <option value="">Select tenant</option>
                  <option *ngFor="let tenant of overview.tenants" [value]="tenant.id">{{ tenantLabel(tenant) }}</option>
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

          <section class="form-panel" *ngIf="adminFormTab() === 'plans'">
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

        <section class="form-panel" *ngIf="adminFormTab() === 'features'">
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
                <option *ngFor="let tenant of overview.tenants" [value]="tenant.id">{{ tenantLabel(tenant) }}</option>
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
  `,
  styles: [`
    .super-admin-command {
      border: 1px solid rgba(15, 118, 110, 0.14);
      border-radius: 18px;
      padding: 18px;
      background: linear-gradient(135deg, rgba(240, 253, 250, 0.95), rgba(255, 255, 255, 0.98));
      box-shadow: 0 18px 45px rgba(15, 23, 42, 0.07);
    }

    .command-heading,
    .command-live {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      flex-wrap: wrap;
    }

    .command-heading h2 {
      margin: 2px 0 0;
      color: var(--ink);
    }

    .command-live {
      justify-content: flex-end;
    }

    .command-kpi-grid,
    .ops-intel-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(190px, 1fr));
      gap: 12px;
      margin-top: 14px;
    }

    .command-kpi,
    .ops-intel-card {
      border: 1px solid rgba(15, 23, 42, 0.08);
      border-radius: 14px;
      padding: 14px;
      background: rgba(255, 255, 255, 0.9);
      min-width: 0;
    }

    .command-kpi {
      border-left: 4px solid var(--accent, #0f766e);
    }

    .command-kpi.danger { border-left-color: var(--danger, #dc2626); }
    .command-kpi.warning { border-left-color: var(--warning, #f59e0b); }
    .command-kpi.success { border-left-color: var(--success, #16a34a); }
    .command-kpi.security { border-left-color: #4f46e5; }

    .command-kpi span,
    .ops-intel-card small {
      color: var(--muted);
      font-size: 0.78rem;
      font-weight: 800;
    }

    .command-kpi strong {
      display: block;
      margin-top: 4px;
      font-size: 1.45rem;
      color: var(--ink);
    }

    .command-kpi small {
      display: block;
      margin-top: 4px;
      color: var(--text-muted);
      font-weight: 700;
    }

    .ops-intel-grid {
      margin-top: 0;
    }

    .ops-intel-card {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      align-items: center;
    }

    .ops-intel-card strong {
      display: block;
      color: var(--ink);
    }

    .ops-count {
      display: inline-flex;
      width: 42px;
      height: 42px;
      align-items: center;
      justify-content: center;
      border-radius: 50%;
      background: rgba(15, 118, 110, 0.12);
      color: var(--accent, #0f766e);
      font-weight: 900;
      flex-shrink: 0;
    }

    .ops-count.is-danger {
      background: rgba(220, 38, 38, 0.12);
      color: var(--danger, #dc2626);
    }

    .ops-count.is-warning {
      background: rgba(245, 158, 11, 0.16);
      color: #a16207;
    }

    .tenant-command-toolbar {
      position: sticky;
      top: 0;
      z-index: 6;
      display: grid;
      grid-template-columns: minmax(240px, 340px) 1fr;
      gap: 12px;
      align-items: end;
      padding: 10px 0 14px;
      background: var(--surface, #fff);
    }

    .tenant-search span {
      display: block;
      margin-bottom: 6px;
      color: var(--muted);
      font-size: 0.78rem;
      font-weight: 800;
    }

    .tenant-search input {
      width: 100%;
      min-height: 42px;
      border: 1px solid rgba(15, 118, 110, 0.18);
      border-radius: 12px;
      padding: 0 12px;
      background: #fff;
      color: var(--ink);
      font: inherit;
    }

    .filter-strip,
    .admin-form-tabs,
    .drawer-tabs {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
      align-items: center;
    }

    .filter-strip button,
    .admin-form-tabs button,
    .drawer-tabs button,
    .bulk-command-bar button,
    .row-action-menu button,
    .row-action-menu a {
      border: 1px solid rgba(15, 118, 110, 0.16);
      border-radius: 999px;
      background: #fff;
      color: var(--ink);
      cursor: pointer;
      font-weight: 850;
      text-decoration: none;
    }

    .filter-strip button,
    .admin-form-tabs button,
    .drawer-tabs button {
      padding: 9px 12px;
    }

    .filter-strip button span {
      margin-left: 6px;
      color: var(--muted);
    }

    .filter-strip button.active,
    .admin-form-tabs button.active,
    .drawer-tabs button.active {
      background: var(--accent, #0f766e);
      color: #fff;
      box-shadow: 0 10px 24px rgba(15, 118, 110, 0.18);
    }

    .filter-strip button.active span {
      color: rgba(255, 255, 255, 0.8);
    }

    .bulk-command-bar {
      position: sticky;
      top: 74px;
      z-index: 7;
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
      margin-bottom: 14px;
      padding: 10px;
      border: 1px solid rgba(15, 118, 110, 0.18);
      border-radius: 14px;
      background: rgba(240, 253, 250, 0.98);
      box-shadow: 0 14px 36px rgba(15, 23, 42, 0.09);
    }

    .bulk-command-bar button {
      padding: 7px 11px;
    }

    .bulk-command-bar span {
      margin-left: auto;
      color: var(--muted);
      font-size: 0.78rem;
      font-weight: 800;
    }

    .admin-form-tabs {
      position: sticky;
      top: 0;
      z-index: 5;
      padding: 12px 0;
      background: var(--page-bg, #f8fafc);
    }

    .admin-form-grid {
      align-items: start;
    }

    .drawer-tabs {
      position: sticky;
      top: 0;
      z-index: 3;
      padding: 8px 0 12px;
      background: var(--surface, #fff);
    }

    .drawer-focus-card {
      margin: 12px 0 16px;
      border: 1px solid rgba(15, 118, 110, 0.16);
      border-radius: 14px;
      padding: 14px;
      background: rgba(240, 253, 250, 0.7);
    }

    .drawer-focus-card strong,
    .drawer-focus-card span {
      display: block;
    }

    .drawer-focus-card span {
      margin-top: 4px;
      color: var(--text-muted);
      font-weight: 700;
    }

    .super-admin-tenant-wrap {
      max-width: 100%;
      border: 1px solid rgba(15, 118, 110, 0.14);
      border-radius: 16px;
      overflow: auto;
    }

    .super-admin-tenant-table {
      min-width: 1180px;
      table-layout: fixed;
      border-collapse: separate;
      border-spacing: 0;
    }

    .super-admin-tenant-table th,
    .super-admin-tenant-table td {
      vertical-align: top;
      padding: 10px 12px;
      white-space: normal;
      background: var(--surface, #fff);
      border-bottom: 1px solid rgba(15, 23, 42, 0.08);
    }

    .super-admin-tenant-table th {
      position: sticky;
      top: 0;
      z-index: 4;
      background: #f8fafc;
      color: var(--muted);
      font-size: 0.76rem;
      text-transform: uppercase;
      letter-spacing: 0;
    }

    .super-admin-tenant-table tr:hover td {
      background: rgba(240, 253, 250, 0.72);
    }

    .super-admin-tenant-table small,
    .super-admin-tenant-table strong {
      display: block;
    }

    .select-col {
      width: 48px;
      position: sticky;
      left: 0;
      z-index: 5;
    }

    td.select-col {
      background: inherit;
    }

    .salon-col { width: 210px; }
    .plan-col { width: 110px; }
    .status-col { width: 210px; }
    .money-col { width: 110px; }
    .usage-col { width: 190px; }
    .health-col { width: 76px; }
    .flag-col { width: 150px; }
    .actions-col {
      width: 84px;
      position: sticky;
      right: 0;
      z-index: 5;
    }

    td.actions-cell {
      position: sticky;
      right: 0;
      z-index: 4;
      background: inherit;
    }

    .salon-cell,
    .status-cell,
    .usage-cell,
    .flag-cell {
      overflow-wrap: anywhere;
    }

    .plan-cell,
    .money-cell,
    .health-cell {
      font-weight: 800;
      color: var(--ink);
    }

    .money-cell small {
      margin-top: 4px;
      color: var(--muted);
      font-weight: 700;
    }

    .row-action-shell {
      position: relative;
      display: flex;
      justify-content: center;
    }

    .icon-menu-button {
      width: 38px;
      height: 34px;
      border: 1px solid rgba(15, 118, 110, 0.16);
      border-radius: 10px;
      background: #fff;
      color: var(--ink);
      cursor: pointer;
      font-weight: 900;
      line-height: 1;
    }

    .row-action-menu {
      position: absolute;
      top: 38px;
      right: 0;
      z-index: 20;
      display: grid;
      width: 190px;
      gap: 4px;
      padding: 8px;
      border: 1px solid rgba(15, 118, 110, 0.16);
      border-radius: 14px;
      background: #fff;
      box-shadow: 0 18px 42px rgba(15, 23, 42, 0.16);
    }

    .row-action-menu button,
    .row-action-menu a {
      display: block;
      width: 100%;
      padding: 8px 10px;
      border-radius: 10px;
      text-align: left;
    }

    .row-action-menu .danger-action {
      color: var(--danger, #dc2626);
      border-color: rgba(220, 38, 38, 0.18);
    }

    .empty-command-row {
      padding: 28px !important;
      color: var(--muted);
      text-align: center;
      font-weight: 800;
    }

    @media (max-width: 900px) {
      .tenant-command-toolbar {
        grid-template-columns: 1fr;
      }

      .super-admin-tenant-table {
        min-width: 1080px;
      }
    }
  `]
})
export class SuperAdminComponent implements OnInit {
  readonly overview = signal<ApiRecord | null>(null);
  readonly selectedTenantId = signal('');
  readonly selectedTenantIds = signal<string[]>([]);
  readonly drilldownOpen = signal(false);
  readonly tenantSearch = signal('');
  readonly tenantFilter = signal<TenantFilter>('all');
  readonly actionMenuTenantId = signal('');
  readonly adminFormTab = signal<AdminFormTab>('subscription');
  readonly drawerTab = signal<DrawerTab>('profile');
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

  readonly auditFilterForm = this.fb.group({
    query: [''],
    actor: [''],
    fromDate: [''],
    toDate: ['']
  });

  readonly bulkActionForm = this.fb.group({
    action: ['suspend', Validators.required],
    planId: [''],
    emailSubject: ['Aura platform update'],
    emailBody: [''],
    supportOwner: ['customer_success']
  });

  readonly supportNoteForm = this.fb.group({
    note: ['', Validators.required]
  });

  readonly gdprExportForm = this.fb.group({
    reason: ['GDPR full tenant data export request', Validators.required],
    confirmation: ['CONFIRM', Validators.required]
  });

  readonly tenantLimitsForm = this.fb.group({
    tenantId: ['', Validators.required],
    branches: [3],
    staff: [25],
    clients: [5000],
    supportTier: ['standard'],
    reason: ['Enterprise limit override']
  });

  readonly ipAllowlistForm = this.fb.group({
    tenantId: ['', Validators.required],
    enabled: [false],
    mode: ['enforce'],
    entriesText: [''],
    reason: ['Tenant network security policy']
  });

  readonly ssoForm = this.fb.group({
    tenantId: ['', Validators.required],
    provider: ['saml'],
    domainHint: [''],
    enforceForRoles: ['owner,admin,superAdmin'],
    status: ['draft'],
    reason: ['Enterprise SSO/SAML configuration']
  });

  readonly dataExportControlsForm = this.fb.group({
    tenantId: ['', Validators.required],
    enabled: [true],
    approvalRequired: [true],
    piiMasking: [true],
    watermark: [true],
    formatsText: ['csv,xlsx,pdf'],
    maxRows: [50000],
    retentionDays: [30],
    reason: ['Enterprise data export controls']
  });

  readonly rolePermissionMatrixForm = this.fb.group({
    tenantId: ['', Validators.required],
    role: ['manager', Validators.required],
    permissionsText: ['bookings.read\nbookings.write\nbookings.approve\nclients.read\nclients.write\nbilling.read\nstaff.read\nreports.read'],
    reason: ['Tenant role permission matrix update']
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
    branchId: [''],
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
        const ipTenantId = this.ipAllowlistForm.value.tenantId || this.selectedTenantId();
        const ipTenant = (overview?.tenants || []).find((tenant: ApiRecord) => tenant.id === ipTenantId);
        if (ipTenant) this.editIpAllowlist(ipTenant);
        const ssoTenantId = this.ssoForm.value.tenantId || this.selectedTenantId();
        const ssoTenant = (overview?.tenants || []).find((tenant: ApiRecord) => tenant.id === ssoTenantId);
        if (ssoTenant) this.editTenantSso(ssoTenant);
        const exportTenantId = this.dataExportControlsForm.value.tenantId || this.selectedTenantId();
        const exportTenant = (overview?.tenants || []).find((tenant: ApiRecord) => tenant.id === exportTenantId);
        if (exportTenant) this.editDataExportControls(exportTenant);
        const roleTenantId = this.rolePermissionMatrixForm.value.tenantId || this.selectedTenantId();
        const roleTenant = (overview?.tenants || []).find((tenant: ApiRecord) => tenant.id === roleTenantId);
        if (roleTenant) this.editRolePermissionMatrix(roleTenant);
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

  editIpAllowlist(tenant: ApiRecord): void {
    this.selectedTenantId.set(tenant.id);
    this.ipAllowlistForm.patchValue({
      tenantId: tenant.id,
      enabled: Boolean(tenant.ipAllowlist?.enabled),
      mode: tenant.ipAllowlist?.mode || 'enforce',
      entriesText: (tenant.ipAllowlist?.entries || []).join('\n'),
      reason: 'Tenant network security policy'
    });
  }

  loadIpAllowlistForm(): void {
    const tenantId = this.ipAllowlistForm.value.tenantId || '';
    const tenant = (this.overview()?.tenants || []).find((item: ApiRecord) => item.id === tenantId);
    if (tenant) this.editIpAllowlist(tenant);
  }

  saveIpAllowlist(): void {
    if (this.ipAllowlistForm.invalid) return;
    this.saving.set(true);
    const tenantId = this.ipAllowlistForm.value.tenantId || '';
    this.api.patch(`super-admin/tenants/${tenantId}/ip-allowlist`, {
      enabled: Boolean(this.ipAllowlistForm.value.enabled),
      mode: this.ipAllowlistForm.value.mode || 'enforce',
      entriesText: this.ipAllowlistForm.value.entriesText || '',
      reason: this.ipAllowlistForm.value.reason || ''
    }).subscribe({
      next: () => {
        this.saving.set(false);
        this.load();
      },
      error: (error) => {
        this.error.set(error?.error?.error || 'Unable to save IP allowlist');
        this.saving.set(false);
      }
    });
  }

  editTenantSso(tenant: ApiRecord): void {
    this.selectedTenantId.set(tenant.id);
    this.ssoForm.patchValue({
      tenantId: tenant.id,
      provider: tenant.sso?.provider || 'saml',
      domainHint: tenant.sso?.domainHint || tenant.primaryDomain || '',
      enforceForRoles: tenant.sso?.enforceForRoles || 'owner,admin,superAdmin',
      status: tenant.sso?.status || 'draft',
      reason: 'Enterprise SSO/SAML configuration'
    });
  }

  loadSsoForm(): void {
    const tenantId = this.ssoForm.value.tenantId || '';
    const tenant = (this.overview()?.tenants || []).find((item: ApiRecord) => item.id === tenantId);
    if (tenant) this.editTenantSso(tenant);
  }

  saveTenantSso(): void {
    if (this.ssoForm.invalid) return;
    this.saving.set(true);
    const tenantId = this.ssoForm.value.tenantId || '';
    this.api.patch(`super-admin/tenants/${tenantId}/sso`, {
      provider: this.ssoForm.value.provider || 'saml',
      domainHint: this.ssoForm.value.domainHint || '',
      enforceForRoles: this.ssoForm.value.enforceForRoles || 'owner,admin,superAdmin',
      status: this.ssoForm.value.status || 'draft',
      reason: this.ssoForm.value.reason || ''
    }).subscribe({
      next: () => {
        this.saving.set(false);
        this.load();
      },
      error: (error) => {
        this.error.set(error?.error?.error || 'Unable to save SSO/SAML settings');
        this.saving.set(false);
      }
    });
  }

  editDataExportControls(tenant: ApiRecord): void {
    this.selectedTenantId.set(tenant.id);
    this.dataExportControlsForm.patchValue({
      tenantId: tenant.id,
      enabled: tenant.dataExportControls?.enabled !== false,
      approvalRequired: tenant.dataExportControls?.approvalRequired !== false,
      piiMasking: tenant.dataExportControls?.piiMasking !== false,
      watermark: Boolean(tenant.dataExportControls?.watermark),
      formatsText: (tenant.dataExportControls?.allowedFormats || ['csv', 'xlsx', 'pdf']).join(','),
      maxRows: Number(tenant.dataExportControls?.maxRows || 50000),
      retentionDays: Number(tenant.dataExportControls?.retentionDays || 30),
      reason: 'Enterprise data export controls'
    });
  }

  loadDataExportControlsForm(): void {
    const tenantId = this.dataExportControlsForm.value.tenantId || '';
    const tenant = (this.overview()?.tenants || []).find((item: ApiRecord) => item.id === tenantId);
    if (tenant) this.editDataExportControls(tenant);
  }

  saveDataExportControls(): void {
    if (this.dataExportControlsForm.invalid) return;
    this.saving.set(true);
    const tenantId = this.dataExportControlsForm.value.tenantId || '';
    this.api.patch(`super-admin/tenants/${tenantId}/data-export-controls`, {
      enabled: Boolean(this.dataExportControlsForm.value.enabled),
      approvalRequired: Boolean(this.dataExportControlsForm.value.approvalRequired),
      piiMasking: Boolean(this.dataExportControlsForm.value.piiMasking),
      watermark: Boolean(this.dataExportControlsForm.value.watermark),
      formatsText: this.dataExportControlsForm.value.formatsText || '',
      maxRows: this.dataExportControlsForm.value.maxRows,
      retentionDays: this.dataExportControlsForm.value.retentionDays,
      reason: this.dataExportControlsForm.value.reason || ''
    }).subscribe({
      next: () => {
        this.saving.set(false);
        this.load();
      },
      error: (error) => {
        this.error.set(error?.error?.error || 'Unable to save data export controls');
        this.saving.set(false);
      }
    });
  }

  rolePermissionMatrixTenant(tenants: ApiRecord[] = []): ApiRecord | null {
    const tenantId = this.rolePermissionMatrixForm.value.tenantId || this.selectedTenantId();
    return tenants.find((tenant) => tenant.id === tenantId) || null;
  }

  editRolePermissionMatrix(tenant: ApiRecord): void {
    this.selectedTenantId.set(tenant.id);
    const role = this.rolePermissionMatrixForm.value.role || 'manager';
    const roleRow = (tenant.rolePermissionMatrix?.roleRows || []).find((row: ApiRecord) => row.role === role);
    this.rolePermissionMatrixForm.patchValue({
      tenantId: tenant.id,
      role,
      permissionsText: (roleRow?.permissions || []).join('\n'),
      reason: 'Tenant role permission matrix update'
    });
  }

  loadRolePermissionMatrixForm(): void {
    const tenantId = this.rolePermissionMatrixForm.value.tenantId || '';
    const tenant = (this.overview()?.tenants || []).find((item: ApiRecord) => item.id === tenantId);
    if (tenant) this.editRolePermissionMatrix(tenant);
  }

  selectRolePermissionRole(): void {
    const tenant = this.rolePermissionMatrixTenant(this.overview()?.tenants || []);
    if (tenant) this.editRolePermissionMatrix(tenant);
  }

  saveRolePermissionMatrix(): void {
    if (this.rolePermissionMatrixForm.invalid) return;
    this.saving.set(true);
    const tenantId = this.rolePermissionMatrixForm.value.tenantId || '';
    this.api.patch(`super-admin/tenants/${tenantId}/role-permissions`, {
      role: this.rolePermissionMatrixForm.value.role || 'manager',
      permissionsText: this.rolePermissionMatrixForm.value.permissionsText || '',
      reason: this.rolePermissionMatrixForm.value.reason || ''
    }).subscribe({
      next: () => {
        this.saving.set(false);
        this.load();
      },
      error: (error) => {
        this.error.set(error?.error?.error || 'Unable to save role permission matrix');
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
    this.impersonationForm.patchValue({ tenantId: tenant.id, branchId: '' });
    if (this.impersonationForm.value.confirmation === 'IMPERSONATE') {
      this.startImpersonation();
      return;
    }
    this.error.set(`Type IMPERSONATE in the impersonation form to debug ${this.tenantLabel(tenant)}.`);
  }

  impersonationTenant(tenants: ApiRecord[] = []): ApiRecord | null {
    const tenantId = this.impersonationForm.value.tenantId || '';
    return (tenants || []).find((tenant) => tenant.id === tenantId) || null;
  }

  tenantLabel(tenant: ApiRecord = {}): string {
    return String(
      tenant.name ||
      tenant.brandName ||
      tenant.primaryDomain ||
      tenant.ownerEmail ||
      tenant.slug ||
      tenant.id ||
      'Unnamed tenant'
    );
  }

  commandMetrics(overview: ApiRecord = {}): ApiRecord {
    const tenants = overview.tenants || [];
    const security = overview.securityRiskCenter?.metrics || {};
    const churn = overview.churnPrediction || {};
    const billing = overview.billingOperationsReport || {};
    const trialsExpiring = tenants.filter((tenant: ApiRecord) => this.trialExpiringTenant(tenant)).length;
    return {
      mrr: Number(overview.metrics?.monthlyRecurringRevenue || 0),
      activeSalons: Number(overview.metrics?.activeSalons || tenants.filter((tenant: ApiRecord) => this.matchesTenantFilter(tenant, 'active')).length),
      trials: Number(overview.metrics?.trialSalons || tenants.filter((tenant: ApiRecord) => this.matchesTenantFilter(tenant, 'trial')).length),
      trialsExpiring,
      churnRisk: Number(churn.highRiskCount || tenants.filter((tenant: ApiRecord) => this.highRiskTenant(tenant)).length),
      mrrAtRisk: Number(churn.mrrAtRisk || 0),
      unpaid: Number(billing.outstandingAmount || tenants.reduce((total: number, tenant: ApiRecord) => total + this.tenantOutstanding(tenant), 0)),
      paymentDue: tenants.filter((tenant: ApiRecord) => this.paymentDueTenant(tenant)).length,
      health: Number(overview.metrics?.averageHealth || 0),
      highRisk: tenants.filter((tenant: ApiRecord) => this.highRiskTenant(tenant)).length,
      securityAlerts: Number(security.criticalLogins || 0) + Number(security.suspiciousLogins || 0),
      securityGaps: Number(security.ipGaps || 0) + Number(security.ssoGaps || 0) + Number(security.exportGaps || 0)
    };
  }

  operationalIntelligence(overview: ApiRecord = {}): ApiRecord[] {
    const tenants = overview.tenants || [];
    const highRisk = tenants.filter((tenant: ApiRecord) => this.highRiskTenant(tenant)).length;
    const paymentDue = tenants.filter((tenant: ApiRecord) => this.paymentDueTenant(tenant)).length;
    const trialsExpiring = tenants.filter((tenant: ApiRecord) => this.trialExpiringTenant(tenant)).length;
    const securityGaps = tenants.filter((tenant: ApiRecord) => this.securityGapTenant(tenant)).length;
    const lowUsageHighMrr = tenants.filter((tenant: ApiRecord) => this.lowUsageHighMrrTenant(tenant)).length;
    const suspendedPotential = tenants.filter((tenant: ApiRecord) => this.suspendedPotentialTenant(tenant)).length;
    return [
      { kind: 'Today', title: 'Need attention today', count: highRisk + paymentDue + securityGaps, detail: 'Risk, billing and security queues', tone: highRisk ? 'danger' : 'warning' },
      { kind: 'Trials', title: 'Trials expiring this week', count: trialsExpiring, detail: 'Convert or extend before expiry', tone: trialsExpiring ? 'warning' : 'neutral' },
      { kind: 'Billing', title: 'Payment failed', count: paymentDue, detail: 'Failed payment or unpaid exposure', tone: paymentDue ? 'danger' : 'neutral' },
      { kind: 'Security', title: 'Security setup missing', count: securityGaps, detail: 'SSO, IP allowlist or export controls', tone: securityGaps ? 'warning' : 'neutral' },
      { kind: 'Growth', title: 'Low usage but high MRR', count: lowUsageHighMrr, detail: 'Retention playbook candidates', tone: lowUsageHighMrr ? 'warning' : 'neutral' },
      { kind: 'Recovery', title: 'Suspended revenue potential', count: suspendedPotential, detail: 'Suspended accounts with value left', tone: suspendedPotential ? 'danger' : 'neutral' }
    ];
  }

  filteredTenants(tenants: ApiRecord[] = []): ApiRecord[] {
    const query = this.tenantSearch().trim().toLowerCase();
    const filter = this.tenantFilter();
    return (tenants || []).filter((tenant) => {
      if (!this.matchesTenantFilter(tenant, filter)) return false;
      if (!query) return true;
      const haystack = [
        this.tenantLabel(tenant),
        tenant.ownerEmail,
        tenant.primaryDomain,
        tenant.planName,
        tenant.subscriptionStatus,
        tenant.status,
        tenant.id
      ].map((value) => String(value || '').toLowerCase()).join(' ');
      return haystack.includes(query);
    });
  }

  tenantFilterCount(tenants: ApiRecord[] = [], filter: TenantFilter): number {
    return (tenants || []).filter((tenant) => this.matchesTenantFilter(tenant, filter)).length;
  }

  matchesTenantFilter(tenant: ApiRecord = {}, filter: TenantFilter): boolean {
    if (filter === 'all') return true;
    const status = String(tenant.subscriptionStatus || tenant.status || '').toLowerCase();
    if (filter === 'active') return status === 'active';
    if (filter === 'trial') return status === 'trialing' || status === 'trial';
    if (filter === 'suspended') return status === 'suspended';
    if (filter === 'risk') return this.highRiskTenant(tenant);
    if (filter === 'paymentDue') return this.paymentDueTenant(tenant);
    return true;
  }

  highRiskTenant(tenant: ApiRecord = {}): boolean {
    const severity = String(tenant.healthFlag?.severity || '').toLowerCase();
    return severity === 'critical' || Number(tenant.healthScore || 0) < 55;
  }

  paymentDueTenant(tenant: ApiRecord = {}): boolean {
    const dunning = String(tenant.billingOps?.dunningStatus || '').toLowerCase();
    return this.tenantOutstanding(tenant) > 0 || Number(tenant.billingOps?.failedPaymentCount || 0) > 0 || Boolean(dunning && dunning !== 'clear');
  }

  tenantOutstanding(tenant: ApiRecord = {}): number {
    return Number(tenant.outstanding || tenant.billingOps?.outstanding || tenant.drilldown?.invoiceSummary?.outstanding || 0);
  }

  trialExpiringTenant(tenant: ApiRecord = {}): boolean {
    const status = String(tenant.subscriptionStatus || '').toLowerCase();
    const days = Number(tenant.tenant360?.profile?.trialDaysLeft ?? tenant.trialDaysLeft ?? 99);
    return (status === 'trialing' || status === 'trial') && days <= 7;
  }

  securityGapTenant(tenant: ApiRecord = {}): boolean {
    const ip = String(tenant.enterpriseSecurity?.ipRestrictionStatus || tenant.ipAllowlist?.status || '').toLowerCase();
    const sso = String(tenant.enterpriseSecurity?.ssoStatus || tenant.sso?.status || '').toLowerCase();
    const exports = String(tenant.enterpriseSecurity?.dataExportStatus || tenant.dataExportControls?.status || '').toLowerCase();
    return !ip || ip.includes('disabled') || ip.includes('gap') || !sso || sso.includes('not') || sso.includes('draft') || !exports || exports.includes('open');
  }

  lowUsageHighMrrTenant(tenant: ApiRecord = {}): boolean {
    const mrr = Number(tenant.monthlyRecurringRevenue || tenant.totalBillingAmount || 0);
    const appointments = Number(tenant.usage?.appointments || 0);
    const clients = Number(tenant.usage?.clients || 0);
    return mrr > 5000 && appointments < 25 && clients < 250;
  }

  suspendedPotentialTenant(tenant: ApiRecord = {}): boolean {
    const status = String(tenant.subscriptionStatus || tenant.status || '').toLowerCase();
    return status === 'suspended' && (Number(tenant.monthlyRecurringRevenue || 0) > 0 || this.tenantOutstanding(tenant) > 0);
  }

  tenantRiskLabel(tenant: ApiRecord = {}): string {
    if (this.paymentDueTenant(tenant)) return 'Payment due';
    if (this.highRiskTenant(tenant)) return 'High risk';
    if (this.trialExpiringTenant(tenant)) return 'Trial expiry';
    if (this.securityGapTenant(tenant)) return 'Security gap';
    return 'Stable';
  }

  tenantRiskTone(tenant: ApiRecord = {}): string {
    if (this.paymentDueTenant(tenant) || this.highRiskTenant(tenant)) return 'var(--danger,#dc2626)';
    if (this.trialExpiringTenant(tenant) || this.securityGapTenant(tenant)) return 'var(--warning,#f59e0b)';
    return 'var(--success,#16a34a)';
  }

  toggleActionMenu(tenantId: string): void {
    this.actionMenuTenantId.set(this.actionMenuTenantId() === tenantId ? '' : tenantId);
  }

  closeActionMenu(): void {
    this.actionMenuTenantId.set('');
  }

  setAdminFormTab(tab: AdminFormTab): void {
    this.adminFormTab.set(tab);
  }

  setDrawerTab(tab: DrawerTab): void {
    this.drawerTab.set(tab);
  }

  prepareBulkCommand(action: string): void {
    this.bulkActionForm.patchValue({ action });
  }

  runBulkCommand(action: string): void {
    this.bulkActionForm.patchValue({ action });
    this.applyBulkAction();
  }

  startImpersonation(): void {
    if (this.impersonationForm.invalid) return;
    this.saving.set(true);
    this.error.set('');
    const tenantId = this.impersonationForm.value.tenantId || '';
    this.api.post<ApiRecord>(`super-admin/tenants/${tenantId}/impersonation`, {
      reason: this.impersonationForm.value.reason || '',
      confirmation: this.impersonationForm.value.confirmation || '',
      returnPath: this.impersonationForm.value.returnPath || '/',
      branchId: this.impersonationForm.value.branchId || ''
    }).subscribe({
      next: (result) => {
        const currentSession = localStorage.getItem('aura.authSession') || '';
        if (currentSession) localStorage.setItem('aura.superAdminSessionBackup', currentSession);
        localStorage.setItem('aura.impersonationContext', JSON.stringify({
          tenantId: result.tenantId,
          tenantName: result.tenantName,
          auditId: result.auditId,
          expiresAt: result.expiresAt,
          scope: result.scope || {},
          restrictions: result.restrictions || [],
          banner: result.banner || '',
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

  selectedTenants(tenants: ApiRecord[] = []): ApiRecord[] {
    const selected = new Set(this.selectedTenantIds());
    return (tenants || []).filter((tenant) => selected.has(tenant.id));
  }

  bulkSelectionSummary(tenants: ApiRecord[] = []): ApiRecord {
    const selected = this.selectedTenants(tenants);
    return {
      count: selected.length,
      mrr: selected.reduce((total, tenant) => total + Number(tenant.monthlyRecurringRevenue || 0), 0),
      outstanding: selected.reduce((total, tenant) => total + Number(tenant.outstanding || 0), 0),
      highRisk: selected.filter((tenant) => tenant.healthFlag?.severity === 'critical' || Number(tenant.healthScore || 0) < 45).length
    };
  }

  filteredAuditTimeline(safety: ApiRecord): ApiRecord[] {
    const query = String(this.auditFilterForm.value.query || '').trim().toLowerCase();
    const actor = String(this.auditFilterForm.value.actor || '').trim().toLowerCase();
    const fromDate = String(this.auditFilterForm.value.fromDate || '');
    const toDate = String(this.auditFilterForm.value.toDate || '');
    return (safety?.timeline || []).filter((event: ApiRecord) => {
      const eventDate = String(event.createdAt || '').slice(0, 10);
      const haystack = [
        event.action,
        event.targetType,
        event.targetId,
        event.reason,
        event.summary,
        event.status
      ].map((item) => String(item || '').toLowerCase()).join(' ');
      const eventActor = String(event.actorUserId || '').toLowerCase();
      if (query && !haystack.includes(query)) return false;
      if (actor && !eventActor.includes(actor)) return false;
      if (fromDate && eventDate < fromDate) return false;
      if (toDate && eventDate > toDate) return false;
      return true;
    });
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
      supportOwner: this.bulkActionForm.value.supportOwner || '',
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

  initiateGdprExport(tenant: ApiRecord): void {
    if (this.gdprExportForm.invalid) return;
    this.saving.set(true);
    this.api.post(`super-admin/tenants/${tenant.id}/gdpr-export`, {
      reason: this.gdprExportForm.value.reason || '',
      confirmation: this.gdprExportForm.value.confirmation || ''
    }).subscribe({
      next: () => {
        this.gdprExportForm.patchValue({ confirmation: 'CONFIRM' });
        this.saving.set(false);
        this.load();
      },
      error: (error) => {
        this.error.set(error?.error?.error || 'Unable to initiate GDPR tenant export');
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
