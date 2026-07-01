import { CommonModule } from '@angular/common';
import { Component, Input, OnInit, OnDestroy, signal } from '@angular/core';
import { ReportsEnterpriseService, FilterState } from './reports-enterprise.service';
import { Subscription } from 'rxjs';

@Component({
  selector: 'app-report-ai-insights',
  standalone: true,
  imports: [CommonModule],
  template: `
    <ng-container *ngIf="!loading(); else skeleton">
      <div class="ai-insights-header">
        <div class="ai-brand">
          <span class="ai-icon">🤖</span>
          <div>
            <h3>AI Business Insights</h3>
          </div>
        </div>
        <button class="ghost-button" (click)="refreshInsights()">🔄 Refresh insights</button>
      </div>

      <div class="insights-grid" *ngIf="insights() as items">
        <div *ngFor="let item of items" class="insight-card" [ngClass]="'severity-' + item.severity">
          <div class="insight-header">
            <span class="insight-type-badge">{{ item.type }}</span>
            <span class="insight-icon">{{ item.icon }}</span>
          </div>
          <strong>{{ item.title }}</strong>
          <p>{{ item.detail }}</p>
          <div class="insight-footer">
            <span class="severity-tag" [ngClass]="'tag-'+item.severity">{{ item.severity }}</span>
          </div>
        </div>
      </div>

      <div class="insights-empty" *ngIf="!loading() && !insights()">
        <span class="empty-icon">🤖</span>
        <strong>No insights available</strong>
      </div>
    </ng-container>

    <ng-template #skeleton>
      <div class="insights-grid">
        <div class="skeleton-insight" *ngFor="let _ of [1,2,3,4,5,6]">
          <div class="skeleton-line w-30"></div>
          <div class="skeleton-line w-80 h-8"></div>
          <div class="skeleton-line w-100"></div>
          <div class="skeleton-line w-50"></div>
        </div>
      </div>
    </ng-template>
  `,
  styles: [`
    .ai-insights-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; padding: 16px 20px; border: 1px solid var(--line); border-radius: 12px; background: linear-gradient(135deg, #eef2ff 0%, #f5f3ff 100%); }
    .ai-brand { display: flex; align-items: center; gap: 12px; }
    .ai-icon { font-size: 32px; }
    .ai-brand h3 { margin: 0; font-size: 18px; }
    .ai-brand small { color: var(--muted); font-size: 12px; }
    .insights-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(320px, 1fr)); gap: 14px; }
    .insight-card { border: 1px solid var(--line); border-radius: 12px; padding: 18px; display: grid; gap: 8px; background: var(--surface); transition: transform 140ms ease, box-shadow 140ms ease; }
    .insight-card:hover { transform: translateY(-2px); box-shadow: 0 8px 24px rgba(0,0,0,0.08); }
    .insight-card.severity-positive { border-left: 4px solid var(--green); }
    .insight-card.severity-warning { border-left: 4px solid var(--warning); }
    .insight-card.severity-info { border-left: 4px solid var(--blue); }
    .insight-header { display: flex; justify-content: space-between; align-items: center; }
    .insight-type-badge { padding: 2px 8px; border-radius: 4px; background: var(--surface-2); font-size: 10px; font-weight: 800; text-transform: uppercase; color: var(--muted); }
    .insight-icon { font-size: 22px; }
    .insight-card strong { font-size: 15px; line-height: 1.3; }
    .insight-card p { margin: 0; font-size: 13px; color: var(--muted); line-height: 1.5; }
    .insight-footer { display: flex; justify-content: flex-end; }
    .severity-tag { padding: 2px 8px; border-radius: 4px; font-size: 10px; font-weight: 800; text-transform: uppercase; }
    .tag-positive { background: #d1fae5; color: var(--green); }
    .tag-warning { background: #fef3c7; color: #b7791f; }
    .tag-info { background: #dbeafe; color: var(--blue); }
    .insights-empty { text-align: center; padding: 48px 16px; }
    .empty-icon { font-size: 48px; display: block; margin-bottom: 8px; }
    .insights-empty strong { display: block; font-size: 16px; }
    .insights-empty small { color: var(--muted); }
    .skeleton-insight { border: 1px solid var(--line); border-radius: 12px; padding: 18px; display: grid; gap: 10px; background: var(--surface); }
    .skeleton-line { height: 12px; border-radius: 6px; background: linear-gradient(90deg, var(--surface-2) 25%, var(--line) 50%, var(--surface-2) 75%); background-size: 200% 100%; animation: shimmer 1.5s infinite; }
    .skeleton-line.w-30 { width: 30%; } .skeleton-line.w-50 { width: 50%; } .skeleton-line.w-80 { width: 80%; } .skeleton-line.w-100 { width: 100%; } .skeleton-line.h-8 { height: 20px; }
    @keyframes shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
    @media (max-width: 760px) { .insights-grid { grid-template-columns: 1fr; } }
  `]
})
export class ReportAiInsightsComponent implements OnInit, OnDestroy {
  @Input() filters!: FilterState;
  readonly loading = signal(true);
  readonly insights = signal<any[] | null>(null);
  private subs: Subscription[] = [];

  constructor(private service: ReportsEnterpriseService) {}

  ngOnInit(): void {
    this.loadInsights();
  }
  ngOnDestroy(): void { this.subs.forEach(s => s.unsubscribe()); }

  loadInsights(): void {
    this.loading.set(true);
    this.subs.push(this.service.getAiInsights().subscribe(d => { this.insights.set(d); this.loading.set(false); }));
  }

  refreshInsights(): void {
    this.insights.set(null);
    this.loadInsights();
  }
}
