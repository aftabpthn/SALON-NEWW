import { CommonModule } from '@angular/common';
import { Component } from '@angular/core';
import { AuraKpiCardComponent } from '../shared/ui/aura-kpi-card/aura-kpi-card.component';

@Component({
  selector: 'app-prd',
  standalone: true,
  imports: [CommonModule, AuraKpiCardComponent],
  template: `
    <section class="page-stack">
      <div class="module-hero">
        <div>
          <h2>Product contract for workflow, finance, customer intelligence and online booking</h2>
        </div>
      </div>

      <div class="metrics-grid">
        <aura-kpi-card tone="neutral" target="/kpi-details/prd/roles"><span>Roles</span><strong>8</strong></aura-kpi-card>
        <aura-kpi-card tone="neutral" target="/kpi-details/prd/journeys"><span>Journeys</span><strong>6</strong></aura-kpi-card>
        <aura-kpi-card tone="neutral" target="/kpi-details/prd/new-pages"><span>New pages</span><strong>6</strong></aura-kpi-card>
        <aura-kpi-card tone="neutral" target="/kpi-details/prd/rules"><span>Rules</span><strong>9</strong></aura-kpi-card>
      </div>

      <div class="dashboard-grid">
        <section class="panel">
          <div class="section-title"><h2>User roles</h2></div>
          <div class="quick-grid">
            <article class="action-card aura-card aura-card--type-action" *ngFor="let role of roles"><strong>{{ role.name }}</strong><span>{{ role.scope }}</span></article>
          </div>
        </section>
        <section class="panel">
          <div class="section-title"><h2>Success metrics</h2></div>
          <div class="summary-lines">
            <div *ngFor="let metric of successMetrics"><span>{{ metric }}</span><strong>Required</strong></div>
          </div>
        </section>
      </div>

      <section class="panel">
        <div class="section-title"><h2>User journeys</h2></div>
        <div class="rank-list">
          <article *ngFor="let journey of journeys"><div><strong>{{ journey.title }}</strong><span>{{ journey.flow }}</span></div></article>
        </div>
      </section>

      <section class="panel">
        <div class="section-title"><h2>Business rules and edge cases</h2></div>
        <div class="quick-grid">
          <article class="action-card aura-card aura-card--type-action" *ngFor="let rule of rules"><strong>{{ rule }}</strong><span>Implemented guardrail</span></article>
        </div>
      </section>
    </section>
  `
})
export class PrdComponent {
  readonly roles = [
    { name: 'Super admin', scope: 'All salons, plans, tenant health and feature access' },
    { name: 'Owner', scope: 'Tenant finance, workflows, reports and brand controls' },
    { name: 'Admin', scope: 'Salon configuration and daily operations' },
    { name: 'Manager', scope: 'Branch operations, staff, closing and local workflows' },
    { name: 'Front desk', scope: 'Booking, POS, check-in, refunds and notes' },
    { name: 'Staff', scope: 'Assigned bookings and customer intelligence' },
    { name: 'Analyst', scope: 'Read-only intelligence and finance views' },
    { name: 'Customer', scope: 'Online booking, cancel and reschedule' }
  ];
  readonly journeys = [
    { title: 'Inactive client workflow', flow: 'Owner creates 30-day rule, runs it, notifications persist.' },
    { title: 'Daily closing', flow: 'Manager opens drawer, records expenses, closes cash and stores closing.' },
    { title: 'Refund', flow: 'Front desk selects invoice, records refund, invoice status recalculates.' },
    { title: 'Customer 360', flow: 'Staff reviews value, risk, preference and next-best-action.' },
    { title: 'Online booking', flow: 'Customer selects service, staff, slot and confirms appointment.' },
    { title: 'Design consistency', flow: 'Admin uses tokens and components across modules.' }
  ];
  readonly rules = [
    'Workflow audiences stay tenant scoped.',
    'Refund cannot exceed paid invoice amount.',
    'Partial payment recalculates invoice status.',
    'Online booking prevents staff conflict.',
    'Cancel and reschedule update the original appointment.',
    'Customer risk rises with inactivity and no-shows.',
    'Cash drawer cannot open twice for one branch.',
    'Every primary action calls an API or is disabled.',
    'Empty data states remain visible and actionable.'
  ];
  readonly successMetrics = ['Build passes', 'Data persists', 'No console errors', 'No fake hidden flows', 'Portal confirms real bookings'];
}
