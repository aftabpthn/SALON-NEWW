import { CommonModule, DecimalPipe } from '@angular/common';
import { Component, OnInit, effect, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ApiRecord, ApiService } from '../core/api.service';
import { StateComponent } from '../shared/ui/state/state.component';
import { AuraMoneyPipe } from '../shared/pipes/aura-money.pipe';
import { AuraDatePipe } from '../shared/pipes/aura-date.pipe';

@Component({
  selector: 'app-commission-preview-report',
  standalone: true,
  imports: [AuraDatePipe, AuraMoneyPipe, CommonModule, DecimalPipe, FormsModule, RouterLink, StateComponent],
  template: `
    <section class="page-stack inner-page-shell">
      <div class="module-hero inner-page-header">
        <div>
          <h2>Commission Calculation Preview</h2>
        </div>
        <div class="hero-actions inner-action-bar">
          <a class="ghost-button" routerLink="/reports/staff-sales">Staff sales</a>
          <a class="ghost-button" routerLink="/commissions">Rules</a>
          <button class="ghost-button" type="button" (click)="load()">Refresh</button>
        </div>
      </div>

      <section class="panel filter-panel">
        <label class="field">
          <span>From</span>
          <input type="date" [(ngModel)]="from" />
        </label>
        <label class="field">
          <span>To</span>
          <input type="date" [(ngModel)]="to" />
        </label>
        <div class="branch-context-card">
          <span>Header branch</span>
          <strong>{{ branchLabel() }}</strong>
        </div>
        <button class="primary-button" type="button" (click)="load()">Apply filters</button>
      </section>

      <app-state [loading]="loading()" [error]="error()"></app-state>

      <ng-container *ngIf="preview() as data">
        <div class="metrics-grid inner-stats-grid">
          <article class="metric-card">
            <span>Preview commission</span>
            <strong>{{ data.totals?.commission || 0 | auraMoney:'1.0-0' }}</strong>
            <small>{{ data.totals?.effectiveRate || 0 | number:'1.0-2' }}% effective rate</small>
          </article>
          <article class="metric-card">
            <span>Attributed revenue</span>
            <strong>{{ data.totals?.revenue || 0 | auraMoney:'1.0-0' }}</strong>
            <small>{{ data.totals?.itemCount || 0 }} line items</small>
          </article>
          <article class="metric-card">
            <span>Staff covered</span>
            <strong>{{ data.totals?.staffCount || 0 }}</strong>
          </article>
          <article class="metric-card">
            <span>Target bonus</span>
            <strong>{{ data.totals?.targetBonus || 0 | auraMoney:'1.0-0' }}</strong>
          </article>
        </div>

        <section class="panel rule-note">
          <div>
            <h2>Preview assumptions</h2>
            <p>{{ data.assumptions?.rulePriority }}. Basis: {{ data.assumptions?.basis }}.</p>
          </div>
          <div class="rule-chips">
            <span>Service {{ data.assumptions?.defaultRule?.servicePercent }}%</span>
            <span>Product {{ data.assumptions?.defaultRule?.productPercent }}%</span>
            <span>Membership {{ data.assumptions?.defaultRule?.membershipPercent }}%</span>
            <span>Package {{ data.assumptions?.defaultRule?.packagePercent }}%</span>
          </div>
        </section>

        <section class="panel">
          <div class="section-title inner-action-bar">
            <div>
              <h2>Staff commission summary</h2>
            </div>
          </div>
          <div class="table-wrap inner-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Staff</th>
                  <th>Revenue</th>
                  <th>Variable</th>
                  <th>Fixed</th>
                  <th>Target bonus</th>
                  <th>Commission</th>
                  <th>Rate</th>
                  <th>Rule</th>
                </tr>
              </thead>
              <tbody>
                <tr *ngFor="let row of data.staff || []">
                  <td>{{ row.staffName }}</td>
                  <td>{{ row.revenue | auraMoney:'1.0-0' }}</td>
                  <td>{{ row.variableCommission | auraMoney:'1.0-0' }}</td>
                  <td>{{ row.fixedCommission | auraMoney:'1.0-0' }}</td>
                  <td>{{ row.targetBonus | auraMoney:'1.0-0' }}</td>
                  <td><strong>{{ row.commission | auraMoney:'1.0-0' }}</strong></td>
                  <td>{{ row.effectiveRate | number:'1.0-2' }}%</td>
                  <td>
                    <span class="badge" [class.warning]="row.ruleSource === 'default'">{{ row.ruleName }}</span>
                  </td>
                </tr>
                <tr *ngIf="!(data.staff || []).length">
                  <td colspan="8">No commission preview lines found for selected filters.</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>

        <section class="dashboard-grid two-col">
          <article class="panel">
            <div class="section-title inner-action-bar"><h2>Commission by category</h2></div>
            <div class="summary-lines">
              <div *ngFor="let row of data.typeTotals || []">
                <span>{{ row.itemTypeLabel }} · {{ row.itemCount }} items</span>
                <strong>{{ row.commission | auraMoney:'1.0-0' }}</strong>
              </div>
              <div *ngIf="!(data.typeTotals || []).length"><span>No category rows</span><strong>₹0</strong></div>
            </div>
          </article>

          <article class="panel">
            <div class="section-title inner-action-bar"><h2>Ready for payroll</h2></div>
            <div class="summary-lines">
              <div><span>Preview status</span><strong>Not posted</strong></div>
              <div><span>Source</span><strong>POS item staff</strong></div>
              <div><span>Fallback</span><strong>Invoice staff when needed</strong></div>
            </div>
          </article>
        </section>

        <section class="panel">
          <div class="section-title inner-action-bar">
            <div>
              <h2>Invoice item commission</h2>
            </div>
          </div>
          <div class="table-wrap inner-table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Staff</th>
                  <th>Item</th>
                  <th>Type</th>
                  <th>Revenue</th>
                  <th>Percent</th>
                  <th>Commission</th>
                  <th>Rule source</th>
                </tr>
              </thead>
              <tbody>
                <tr *ngFor="let item of data.entries || []">
                  <td>{{ item.date | auraDate:'date' }}</td>
                  <td>{{ item.staffName }}</td>
                  <td>{{ item.itemName }}</td>
                  <td>{{ item.itemTypeLabel }}</td>
                  <td>{{ item.revenue | auraMoney:'1.0-0' }}</td>
                  <td>{{ item.percent | number:'1.0-2' }}%</td>
                  <td><strong>{{ item.commission | auraMoney:'1.0-0' }}</strong></td>
                  <td>
                    <span class="badge" [class.warning]="item.ruleSource === 'default'">
                      {{ item.ruleSource === 'default' ? 'Default' : item.ruleName }}
                    </span>
                  </td>
                </tr>
                <tr *ngIf="!(data.entries || []).length">
                  <td colspan="8">No item commission lines available.</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      </ng-container>
    </section>
  `,
  styles: [`
    .filter-panel {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr)) auto;
      gap: 12px;
      align-items: end;
    }
    .metric-card {
      background: #fff;
      border: 1px solid var(--border);
      border-radius: 8px;
      border-top: 4px solid var(--primary);
      box-shadow: var(--shadow-sm);
      padding: 18px;
    }
    .metric-card span,
    .metric-card small {
      color: var(--muted);
      display: block;
    }
    .metric-card strong {
      display: block;
      font-size: 30px;
      margin: 8px 0 4px;
    }
    .rule-note {
      align-items: center;
      display: flex;
      justify-content: space-between;
      gap: 16px;
    }
    .rule-note p {
      color: var(--muted);
      margin: 6px 0 0;
    }
    .rule-chips {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      justify-content: flex-end;
    }
    .rule-chips span {
      background: #F3EAF0;
      border: 1px solid #DCC4D4;
      border-radius: 999px;
      color: #7A4A28;
      font-weight: 800;
      padding: 8px 10px;
      white-space: nowrap;
    }
    .two-col {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
    .badge.warning {
      background: #fff7ed;
      color: #9a3412;
    }
    @media (max-width: 900px) {
      .filter-panel,
      .two-col {
        grid-template-columns: 1fr;
      }
      .rule-note {
        align-items: stretch;
        flex-direction: column;
      }
      .rule-chips {
        justify-content: flex-start;
      }
    }
  `]
})
export class CommissionPreviewReportComponent implements OnInit {
  readonly preview = signal<ApiRecord | null>(null);
  readonly branches = signal<ApiRecord[]>([]);
  readonly loading = signal(false);
  readonly error = signal('');

  from = '';
  to = '';
  private initialized = false;

  constructor(private readonly api: ApiService) {
    effect(() => {
      this.api.selectedBranchId();
      if (this.initialized) this.load();
    });
  }

  ngOnInit(): void {
    this.initialized = true;
    this.loadBranches();
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.error.set('');
    const branchId = this.api.selectedBranchId();
    this.api.report<ApiRecord>('commission-preview', {
      branchId,
      from: this.from,
      to: this.to
    }).subscribe({
      next: (preview) => {
        this.preview.set(preview);
        this.loading.set(false);
      },
      error: (error) => {
        this.error.set(error?.error?.error || 'Unable to load commission preview');
        this.loading.set(false);
      }
    });
  }

  branchLabel(): string {
    const branchId = this.api.selectedBranchId();
    if (!branchId) return 'Header branch not selected';
    return this.branches().find((branch) => branch.id === branchId)?.name || branchId;
  }

  private loadBranches(): void {
    this.api.list<ApiRecord[]>('branches', { limit: 1000 }).subscribe({
      next: (branches) => this.branches.set(branches || []),
      error: () => this.branches.set([])
    });
  }
}
