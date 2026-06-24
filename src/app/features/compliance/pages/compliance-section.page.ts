import { CommonModule } from '@angular/common';
import { Component, OnInit, computed, inject } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { ComplianceStore } from '../application/compliance.store';
import { ComplianceRouteMeta } from '../domain/compliance.models';

@Component({
  selector: 'app-compliance-section-page',
  standalone: true,
  imports: [CommonModule, RouterLink],
  template: `
    <section class="compliance-page">
      <section class="page-title">
        <div>
          <h1>{{ meta().title }}</h1>
          <p>Compliance &gt; {{ meta().subtitle }}</p>
        </div>
        <strong>{{ meta().module | uppercase }}</strong>
      </section>

      <section class="filters">
        <nav class="tabs" aria-label="Compliance modules">
          <a routerLink="/compliance">Dashboard</a>
          <a routerLink="/compliance/pf">PF</a>
          <a routerLink="/compliance/esi">ESI</a>
          <a routerLink="/compliance/pt">PT</a>
          <a routerLink="/compliance/tds">TDS</a>
          <a routerLink="/compliance/gratuity">Gratuity</a>
          <a routerLink="/compliance/bonus">Bonus</a>
          <a routerLink="/compliance/reports">Reports</a>
          <a routerLink="/compliance/fy-closure">FY closure</a>
        </nav>
      </section>

      <div class="state" *ngIf="store.loading()">Loading statutory dashboard...</div>
      <div class="state error" *ngIf="store.error()">{{ store.error() }}</div>

      <ng-container *ngIf="!store.loading()">
        <section class="metrics-grid">
          <article><span>Compliance score</span><strong>{{ store.dashboard()?.complianceScore ?? 0 }}%</strong><small>{{ store.scoreLabel() }}</small></article>
          <article><span>Financial year</span><strong>{{ store.dashboard()?.fy || '-' }}</strong><small>active statutory year</small></article>
          <article><span>Modules</span><strong>{{ moduleCards().length }}</strong><small>tracked controls</small></article>
          <article><span>Deadlines</span><strong>{{ (store.dashboard()?.upcomingDeadlines ?? []).length }}</strong><small>upcoming filings</small></article>
        </section>

        <section class="workdesk">
          <header class="desk-heading">
            <div>
              <p class="eyebrow">Compliance operations</p>
              <h2>Single compact work desk</h2>
            </div>
            <span>Choose one statutory task instead of scrolling every form.</span>
          </header>
          <div class="desk-tabs">
            <button type="button">PF</button>
            <button type="button">ESI</button>
            <button type="button">PT</button>
            <button type="button">TDS</button>
            <button type="button">FY closure</button>
          </div>
          <div class="workdesk-grid">
            <label>
              <span>Module</span>
              <select>
                <option>{{ meta().module | uppercase }}</option>
              </select>
            </label>
            <label>
              <span>Financial year</span>
              <input [value]="store.dashboard()?.fy || ''" readonly />
            </label>
            <label>
              <span>Score</span>
              <input [value]="(store.dashboard()?.complianceScore ?? 0) + '%'" readonly />
            </label>
            <button type="button">{{ meta().primaryAction }}</button>
          </div>
        </section>

        <section class="register-panel">
          <div class="register-heading">
            <div>
              <p class="eyebrow">Statutory module register</p>
              <h2>{{ meta().module | uppercase }} control center</h2>
            </div>
            <button type="button">{{ meta().primaryAction }}</button>
          </div>
          <div class="table-wrap">
            <table>
              <thead>
                <tr><th>Module</th><th>Pending</th><th>Status</th><th>Action</th></tr>
              </thead>
              <tbody>
                <tr *ngFor="let item of moduleCards()">
                  <td><strong>{{ item.key | uppercase }}</strong></td>
                  <td>{{ item.pending }}</td>
                  <td><span class="badge" [class.warn]="item.pending"> {{ item.pending ? 'Pending' : 'Clear' }} </span></td>
                  <td><a [routerLink]="complianceModuleLink(item.key)">Open</a></td>
                </tr>
              </tbody>
            </table>
          </div>
          <footer class="register-footer">
            <span>{{ moduleCards().length ? 1 : 0 }} to {{ moduleCards().length }} of {{ moduleCards().length }}</span>
            <span>Page 1 of 1</span>
          </footer>
        </section>

        <section class="register-panel">
          <div class="register-heading">
            <div>
              <p class="eyebrow">Filing calendar</p>
              <h2>Upcoming deadlines</h2>
            </div>
            <span>FY {{ store.dashboard()?.fy }}</span>
          </div>
          <div class="table-wrap">
            <table>
              <thead>
                <tr><th>Filing</th><th>Module</th><th>Due rule</th><th>Status</th></tr>
              </thead>
              <tbody>
                <tr *ngFor="let deadline of store.dashboard()?.upcomingDeadlines ?? []">
                  <td><strong>{{ deadline.label }}</strong></td>
                  <td>{{ deadline.module | uppercase }}</td>
                  <td>{{ deadline.dueRule }}</td>
                  <td><span class="badge warn">Upcoming</span></td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      </ng-container>
    </section>
  `,
  styles: [`
    .compliance-page { display: grid; color: #1d2430; background: #f7f9fb; min-height: calc(100vh - 20px); }
    .command-bar { min-height: 58px; background: #111827; color: #f8fafc; display: flex; align-items: center; gap: 12px; padding: 10px 18px; border-bottom: 1px solid #d4dee8; }
    .brand-mark { width: 34px; height: 34px; border-radius: 8px; background: #6654d9; display: grid; place-items: center; font-weight: 900; }
    .command-bar p { margin: 0; color: #7f8da3; font-size: 10px; font-weight: 900; text-transform: uppercase; }
    .command-bar strong { display: block; font-size: 16px; }
    .top-actions { margin-left: auto; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .top-actions button, .quick-buttons button, .quick-buttons a, .workdesk button, .register-heading button { min-height: 30px; border: 1px solid #c6d7ea; background: #fff; color: #0963a6; border-radius: 3px; padding: 6px 12px; font-weight: 900; text-decoration: none; cursor: pointer; }
    .top-actions span { color: #9aa8bd; font-size: 12px; }
    .quick-actions { display: grid; grid-template-columns: 1fr auto; gap: 10px; padding: 18px 14px 10px; background: #fff; border-bottom: 1px solid #d9e1ea; }
    .branch-label { grid-row: span 2; align-self: center; font-weight: 900; text-transform: lowercase; }
    .quick-buttons { display: flex; gap: 8px; justify-content: flex-end; flex-wrap: wrap; }
    .quick-actions > select { grid-column: 2; min-width: min(620px, 100%); }
    .page-title { display: flex; align-items: end; justify-content: space-between; gap: 16px; padding: 14px; background: #fff; border-bottom: 1px solid #d9e1ea; }
    .page-title h1, .desk-heading h2, .register-heading h2, p { margin: 0; letter-spacing: 0; }
    .page-title p { margin-top: 6px; color: #38506d; font-size: 13px; }
    .page-title strong, .desk-heading span, .register-heading > span { color: #5d6f87; font-size: 12px; font-weight: 800; }
    .filters { background: #fff; border-bottom: 1px solid #d9e1ea; padding: 10px 14px; }
    .tabs { display: flex; flex-wrap: wrap; gap: 8px; }
    .tabs a { background: #fff; border: 1px solid #c6d7ea; border-radius: 3px; color: #0963a6; font-size: 12px; font-weight: 900; padding: 7px 12px; text-decoration: none; }
    .state { margin: 12px 14px 0; background: #eef5ff; border: 1px solid #cfe1ff; padding: 12px; }
    .state.error { background: #fff1f2; border-color: #fecdd3; color: #9f1239; }
    .metrics-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 0; padding: 0 14px 12px; background: #fff; border-bottom: 1px solid #d9e1ea; }
    .metrics-grid article { display: grid; gap: 3px; min-height: 74px; padding: 12px 14px; border: 1px solid #d9e1ea; border-left: 0; border-top: 3px solid #0a78b6; }
    .metrics-grid article:first-child { border-left: 1px solid #d9e1ea; }
    .metrics-grid span, .metrics-grid small { color: #64748b; font-size: 12px; font-weight: 800; }
    .metrics-grid strong { font-size: 22px; line-height: 1; }
    .workdesk, .register-panel { background: #fff; border-bottom: 1px solid #d9e1ea; padding: 12px 14px; display: grid; gap: 10px; }
    .desk-heading, .register-heading { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
    .eyebrow { margin: 0 0 3px; color: #5d6f87; font-size: 11px; font-weight: 900; text-transform: uppercase; }
    .desk-tabs { display: flex; gap: 8px; flex-wrap: wrap; border-bottom: 1px solid #d9e1ea; padding-bottom: 8px; }
    .desk-tabs button { border: 1px solid #c6d7ea; background: #fff; color: #0963a6; border-radius: 3px; padding: 7px 12px; font-weight: 900; }
    .desk-tabs button:first-child { background: #0f8a7d; color: #fff; border-color: #0f8a7d; }
    .workdesk-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; align-items: end; }
    label { display: grid; gap: 5px; color: #5d6f87; font-size: 11px; font-weight: 900; }
    input, select { border: 1px solid #bdcfe2; border-radius: 3px; min-height: 34px; padding: 7px 10px; font: inherit; color: #1d2430; background: #fff; min-width: 0; }
    .workdesk button, .register-heading button { background: #0f8a7d; color: #fff; border-color: #0f8a7d; }
    .table-wrap { overflow: auto; border: 1px solid #d9e1ea; }
    table { width: 100%; min-width: 760px; border-collapse: collapse; font-size: 13px; }
    th { background: #f1f5f9; color: #4b5f78; text-align: left; font-size: 11px; text-transform: uppercase; padding: 10px 12px; border-bottom: 1px solid #d9e1ea; }
    td { padding: 12px; border-bottom: 1px solid #d9e1ea; }
    tbody tr:hover { background: #f5fbff; }
    td a { color: #0963a6; font-weight: 900; text-decoration: none; }
    .badge { display: inline-flex; border-radius: 3px; background: #dff7e8; color: #087443; font-size: 12px; font-weight: 900; padding: 5px 9px; }
    .badge.warn { background: #fff4d6; color: #8a4b00; }
    .register-footer { display: flex; justify-content: flex-end; gap: 18px; color: #64748b; font-size: 12px; }
    @media (max-width: 900px) {
      .command-bar, .page-title, .desk-heading, .register-heading { align-items: flex-start; flex-direction: column; }
      .top-actions { margin-left: 0; }
      .quick-actions, .metrics-grid, .workdesk-grid { grid-template-columns: 1fr; }
      .quick-actions > select { grid-column: auto; min-width: 0; }
      .quick-buttons { justify-content: flex-start; }
      .metrics-grid article, .metrics-grid article:first-child { border-left: 1px solid #d9e1ea; }
    }
  `]
})
export class ComplianceSectionPage implements OnInit {
  readonly store = inject(ComplianceStore);
  private readonly route = inject(ActivatedRoute);
  readonly meta = computed<ComplianceRouteMeta>(() => this.route.snapshot.data['meta'] as ComplianceRouteMeta);
  readonly moduleCards = computed(() => {
    const modules = this.store.dashboard()?.modules ?? {};
    return Object.entries(modules).map(([key, value]) => ({ key, pending: value.pending ?? 0 }));
  });

  complianceModuleLink(key: string): string {
    return key === 'dashboard' ? '/compliance' : `/compliance/${key}`;
  }

  ngOnInit(): void {
    this.store.loadDashboard();
  }
}
