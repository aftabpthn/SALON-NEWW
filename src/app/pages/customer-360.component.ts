import { CommonModule, CurrencyPipe, DatePipe } from '@angular/common';
import { Component, OnInit, signal } from '@angular/core';
import { Router } from '@angular/router';
import { ApiRecord, ApiService } from '../core/api.service';
import { StateComponent } from '../shared/ui/state/state.component';
import { AuraKpiCardComponent } from '../shared/ui/aura-kpi-card/aura-kpi-card.component';

@Component({
  selector: 'app-customer-360',
  standalone: true,
  imports: [CommonModule, CurrencyPipe, DatePipe, StateComponent, AuraKpiCardComponent],
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
                <td><button class="ghost-button mini" type="button" (click)="openProfile(profile.client.id)">Open</button></td>
              </tr>
              <tr *ngIf="!(summary()?.profiles || []).length"><td colspan="6"><div class="empty-state"><strong>No clients found</strong><span>Create a client or booking to generate customer intelligence.</span></div></td></tr>
            </tbody>
          </table>
        </div>
      </section>
    </section>
  `,
  styles: [`
    .page-stack { display: grid; gap: 16px; padding-block: 16px; }
    .module-hero { border-radius: 12px; padding: 16px 20px; min-height: auto; }
    .module-hero h2 { font-size: 22px; line-height: 1.15; }
    .module-hero p { font-size: 13px; margin-top: 4px; }
    .panel { border-radius: 12px; padding: 16px; }
    .section-title { padding-bottom: 6px; margin-bottom: 8px; }
    .section-title h2 { font-size: 15px; }
    .table-wrap { border-radius: 8px; }
  `]
})
export class Customer360Component implements OnInit {
  readonly summary = signal<ApiRecord | null>(null);
  readonly loading = signal(false);
  readonly error = signal('');

  constructor(
    private readonly api: ApiService,
    private readonly router: Router
  ) {}

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.api.list<ApiRecord>('customer-360/summary').subscribe({
      next: (summary) => {
        this.summary.set(summary);
        this.loading.set(false);
      },
      error: (error) => {
        this.error.set(error?.error?.error || 'Unable to load customer 360');
        this.loading.set(false);
      }
    });
  }

  openProfile(clientId: string): void {
    this.router.navigate(['/customer-360', clientId]);
  }
}
