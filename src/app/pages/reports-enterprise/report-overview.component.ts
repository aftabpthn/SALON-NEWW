import { CommonModule } from '@angular/common';
import { Component, Input, OnInit, OnDestroy, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { BaseChartComponent } from './base-chart.component';
import { ReportsEnterpriseService, FilterState } from './reports-enterprise.service';
import { Subscription } from 'rxjs';
import { AuraMoneyPipe } from '../../shared/pipes/aura-money.pipe';

@Component({
  selector: 'app-report-overview',
  standalone: true,
  imports: [AuraMoneyPipe, CommonModule, FormsModule, BaseChartComponent],
  template: `
    <ng-container *ngIf="!loading(); else overviewSkeleton">
      <div class="overview-grid">
        <section class="panel report-section inner-page-card">
          <div class="section-title inner-action-bar">
            <h3>Revenue Trend</h3>
            <button class="ghost-button mini" (click)="exportSection()">Export</button>
          </div>
          <div class="chart-container" *ngIf="revenueTrend() as data">
            <base-chart type="line" [labels]="data.labels" [datasets]="[{label:'Revenue', data: data.values, backgroundColor: 'rgba(75,18,56,0.1)', borderColor: '#4B1238', fill: true, tension: 0.4}]"></base-chart>
          </div>
        </section>

        <section class="panel report-section inner-page-card">
          <div class="section-title inner-action-bar">
            <h3>Bookings Trend</h3>
            <button class="ghost-button mini" (click)="exportSection()">Export</button>
          </div>
          <div class="chart-container" *ngIf="bookingsTrend() as data">
            <base-chart type="bar" [labels]="data.labels" [datasets]="[{label:'Bookings', data: data.values, backgroundColor: '#C87D4B'}]"></base-chart>
          </div>
        </section>

        <section class="panel report-section inner-page-card">
          <div class="section-title inner-action-bar">
            <h3>New vs Returning Clients</h3>
            <button class="ghost-button mini" (click)="exportSection()">Export</button>
          </div>
          <div class="chart-container" *ngIf="newVsReturning() as data">
            <base-chart type="bar" [labels]="data.labels" [datasets]="[{label:'New', data: data.newClients, backgroundColor: '#2f5fbd'},{label:'Returning', data: data.returning, backgroundColor: '#C87D4B'}]"></base-chart>
          </div>
        </section>

        <section class="panel report-section inner-page-card">
          <div class="section-title inner-action-bar">
            <h3>Revenue by Category</h3>
            <button class="ghost-button mini" (click)="exportSection()">Export</button>
          </div>
          <div class="chart-container" *ngIf="revenueByCat() as data">
            <base-chart type="doughnut" [labels]="data.labels" [datasets]="[{label:'Share', data: data.values, backgroundColor: data.colors}]"></base-chart>
          </div>
        </section>
      </div>

      <div class="overview-bottom">
        <section class="panel report-section inner-page-card">
          <div class="section-title inner-action-bar"><h3>Today's Performance Summary</h3></div>
          <div class="today-grid inner-stats-grid" *ngIf="todayPerf() as t">
            <div class="today-card"><span>Revenue</span><strong>{{ t.revenue | auraMoney:'1.0-0' }}</strong></div>
            <div class="today-card"><span>Bookings</span><strong>{{ t.bookings }}</strong></div>
            <div class="today-card"><span>Clients</span><strong>{{ t.clients }}</strong></div>
            <div class="today-card"><span>Avg Rating</span><strong>{{ t.rating }} ⭐</strong></div>
          </div>
        </section>

        <section class="panel report-section inner-page-card">
          <div class="section-title inner-action-bar"><h3>Key Opportunities</h3></div>
          <div class="opportunity-list" *ngIf="opportunities() as ops">
            <div class="opportunity-card" *ngFor="let op of ops">
              <strong>{{ op.title }}</strong>
              <span>{{ op.desc }}</span>
              <small class="impact-badge">{{ op.impact }}</small>
            </div>
          </div>
        </section>
      </div>
    </ng-container>

    <div *ngIf="!loading() && !revenueTrend()" class="empty-state">
      <span class="empty-icon">📊</span>
      <strong>No data yet</strong>
    </div>

    <ng-template #overviewSkeleton>
      <div class="overview-grid">
        <div class="skeleton-chart" *ngFor="let _ of [1,2,3,4]"><div class="skeleton-line w-40"></div><div class="skeleton-chart-area"></div></div>
      </div>
    </ng-template>
  `,
  styles: [`
    .overview-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 16px; margin-bottom: 16px; }
    .overview-bottom { display: grid; grid-template-columns: 1.2fr 0.8fr; gap: 16px; }
    .chart-container { height: 220px; }
    .today-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 10px; }
    .today-card { border: 1px solid var(--line); border-radius: 8px; padding: 12px; }
    .today-card span { display: block; font-size: 11px; font-weight: 800; color: var(--muted); text-transform: uppercase; }
    .today-card strong { display: block; font-size: 20px; margin-top: 4px; }
    .opportunity-list { display: grid; gap: 10px; }
    .opportunity-card { border: 1px solid var(--line); border-radius: 8px; padding: 12px; display: grid; gap: 4px; }
    .opportunity-card strong { font-size: 14px; }
    .opportunity-card span { font-size: 12px; color: var(--muted); }
    .impact-badge { display: inline-block; margin-top: 4px; padding: 2px 8px; border-radius: 4px; background: #F8EEF4; color: #4B1238; font-size: 11px; font-weight: 700; width: fit-content; }
    .empty-state { text-align: center; padding: 24px 16px; }
    .empty-icon { font-size: 40px; display: block; margin-bottom: 8px; }
    .empty-state strong { display: block; font-size: 16px; }
    .empty-state small { color: var(--muted); }
    .skeleton-chart { border: 1px solid var(--line); border-radius: 8px; padding: 16px; background: var(--surface); }
    .skeleton-chart-area { height: 200px; margin-top: 12px; border-radius: 6px; background: linear-gradient(90deg, var(--surface-2) 25%, var(--line) 50%, var(--surface-2) 75%); background-size: 200% 100%; animation: shimmer 1.5s infinite; }
    .skeleton-line { height: 12px; border-radius: 6px; background: linear-gradient(90deg, var(--surface-2) 25%, var(--line) 50%, var(--surface-2) 75%); background-size: 200% 100%; animation: shimmer 1.5s infinite; }
    .skeleton-line.w-40 { width: 40%; }
    @keyframes shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
    @media (max-width: 760px) { .overview-grid, .overview-bottom { grid-template-columns: 1fr; } }
  `]
})
export class ReportOverviewComponent implements OnInit, OnDestroy {
  @Input() filters!: FilterState;
  readonly loading = signal(true);
  readonly revenueTrend = signal<{ labels: string[]; values: number[] } | null>(null);
  readonly bookingsTrend = signal<{ labels: string[]; values: number[] } | null>(null);
  readonly newVsReturning = signal<{ labels: string[]; newClients: number[]; returning: number[] } | null>(null);
  readonly revenueByCat = signal<{ labels: string[]; values: number[]; colors: string[] } | null>(null);
  readonly todayPerf = signal<{ revenue: number; bookings: number; clients: number; rating: number } | null>(null);
  readonly opportunities = signal<{ title: string; desc: string; impact: string }[] | null>(null);
  private subs: Subscription[] = [];

  constructor(private service: ReportsEnterpriseService) {}

  ngOnInit(): void {
    this.subs.push(this.service.getRevenueTrend().subscribe(d => this.revenueTrend.set(d)));
    this.subs.push(this.service.getBookingsTrend().subscribe(d => this.bookingsTrend.set(d)));
    this.subs.push(this.service.getNewVsReturning().subscribe(d => this.newVsReturning.set(d)));
    this.subs.push(this.service.getRevenueByCategory().subscribe(d => this.revenueByCat.set(d)));
    this.subs.push(this.service.getTodayPerformance().subscribe(d => this.todayPerf.set(d)));
    this.subs.push(this.service.getKeyOpportunities().subscribe(d => { this.opportunities.set(d); this.loading.set(false); }));
  }

  ngOnDestroy(): void { this.subs.forEach(s => s.unsubscribe()); }

  exportSection(): void {
    const blob = new Blob(['Business Overview export'], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'business-overview.csv'; a.click();
    URL.revokeObjectURL(url);
  }
}
