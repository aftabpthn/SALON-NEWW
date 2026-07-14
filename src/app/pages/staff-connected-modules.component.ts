import { CommonModule } from '@angular/common';
import { Component, OnInit, computed, signal } from '@angular/core';
import { FormsModule, ReactiveFormsModule, UntypedFormBuilder } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { ApiRecord, ApiService } from '../core/api.service';
import { StateComponent } from '../shared/ui/state/state.component';
import { AuraMoneyPipe } from '../shared/pipes/aura-money.pipe';

type StaffModuleLink = {
  label: string;
  path: string;
  description: string;
  badge?: string;
  queryParams?: ApiRecord;
};

type StaffModuleGroup = {
  title: string;
  eyebrow: string;
  links: StaffModuleLink[];
};

@Component({
  selector: 'app-staff-connected-modules',
  standalone: true,
  imports: [AuraMoneyPipe, CommonModule, FormsModule, ReactiveFormsModule, RouterLink, StateComponent],
  template: `
    <section class="page-stack connected-modules-page">
      <section class="connected-hero">
        <div>
          <h2>Connected modules</h2>
        </div>
        <a class="ghost-button" routerLink="/staff-os/staff-list">Back to staff directory</a>
      </section>

      <form class="connected-filter-bar" [formGroup]="filterForm" (ngSubmit)="load()">
        <label class="field"><span>Start</span><input type="date" formControlName="periodStart" /></label>
        <label class="field"><span>End</span><input type="date" formControlName="periodEnd" /></label>
        <label class="field">
          <span>Branch</span>
          <select formControlName="branchId">
            <option value="">All branches</option>
            <option *ngFor="let branch of branches()" [value]="branch.id">{{ branch.name }}</option>
          </select>
        </label>
        <button class="primary-button" type="submit">Refresh</button>
      </form>

      <app-state [loading]="loading()" [error]="error()"></app-state>

      <ng-container *ngIf="summary() as summary">
        <section class="connected-kpi-grid">
          <article>
            <span>Active staff</span>
            <strong>{{ summary.metrics.staffCount }}</strong>
          </article>
          <article>
            <span>Bookings</span>
            <strong>{{ countFor('appointments') }}</strong>
          </article>
          <article>
            <span>Sales</span>
            <strong>{{ summary.metrics.totalRevenue | auraMoney:'1.0-0' }}</strong>
          </article>
          <article>
            <span>Payroll rows</span>
            <strong>{{ countFor('payroll') }}</strong>
          </article>
          <article>
            <span>Commission</span>
            <strong>{{ summary.metrics.totalCommission | auraMoney:'1.0-0' }}</strong>
            <small>{{ countFor('commission') }} lines</small>
          </article>
          <article>
            <span>Incentives</span>
            <strong>{{ summary.metrics.totalIncentives | auraMoney:'1.0-0' }}</strong>
            <small>{{ countFor('incentives') }} rows</small>
          </article>
        </section>

        <section class="connected-health-panel">
          <div class="section-title compact-title">
            <div>
              <h2>Backend sources connected</h2>
            </div>
          </div>
          <div class="integration-health-grid">
            <article *ngFor="let item of integrationHealth(); trackBy: trackHealth">
              <span>{{ item.label }}</span>
              <strong>{{ item.count }}</strong>
              <small>{{ item.source }} · {{ item.status }}</small>
            </article>
          </div>
        </section>

        <section class="staff-connected-grid">
          <article class="connected-group" *ngFor="let group of staffModuleGroups(); trackBy: trackGroup">
            <span class="eyebrow">{{ group.eyebrow }}</span>
            <h3>{{ group.title }}</h3>
            <div class="connected-link-list">
              <a *ngFor="let link of group.links; trackBy: trackLink" [routerLink]="link.path" [queryParams]="link.queryParams">
                <div>
                  <strong>{{ link.label }}</strong>
                  <small>{{ link.description }}</small>
                </div>
                <span *ngIf="link.badge">{{ link.badge }}</span>
              </a>
            </div>
          </article>
        </section>
      </ng-container>
    </section>
  `,
  styles: [`
    .connected-modules-page {
      gap: 12px;
    }

    .connected-hero,
    .connected-filter-bar,
    .connected-health-panel,
    .connected-group {
      border: 1px solid var(--line);
      border-radius: 8px;
      background: var(--surface);
      box-shadow: var(--shadow);
    }

    .connected-hero {
      display: flex;
      justify-content: space-between;
      gap: 14px;
      align-items: center;
      padding: 16px;
    }

    .connected-hero h2,
    .connected-hero p {
      margin: 0;
    }

    .connected-hero p {
      max-width: 820px;
      margin-top: 5px;
      color: var(--muted);
    }

    .connected-filter-bar {
      display: grid;
      grid-template-columns: repeat(3, minmax(150px, 1fr)) auto;
      gap: 10px;
      align-items: end;
      padding: 12px;
    }

    .connected-kpi-grid,
    .integration-health-grid {
      display: grid;
      grid-template-columns: repeat(6, minmax(0, 1fr));
      gap: 10px;
    }

    .connected-kpi-grid article,
    .integration-health-grid article {
      display: grid;
      gap: 4px;
      padding: 12px;
      border: 1px solid var(--line);
      border-left: 4px solid var(--teal);
      border-radius: 8px;
      background: #fff;
    }

    .connected-kpi-grid span,
    .integration-health-grid span {
      color: var(--muted);
      font-size: 0.8rem;
      font-weight: 850;
    }

    .connected-kpi-grid strong,
    .integration-health-grid strong {
      color: var(--ink);
      font-size: 1.35rem;
    }

    .connected-kpi-grid small,
    .integration-health-grid small {
      color: var(--muted);
    }

    .connected-health-panel {
      padding: 12px;
    }

    .staff-connected-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 12px;
    }

    .connected-group {
      display: grid;
      gap: 10px;
      padding: 14px;
    }

    .connected-group h3 {
      margin: 0;
      font-size: 1.04rem;
    }

    .connected-link-list {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 8px;
    }

    .connected-link-list a {
      display: grid;
      grid-template-columns: 1fr auto;
      gap: 8px;
      min-height: 82px;
      padding: 10px;
      border: 1px solid var(--line);
      border-radius: 8px;
      background: #fbfdfd;
      color: inherit;
      text-decoration: none;
    }

    .connected-link-list strong,
    .connected-link-list small {
      display: block;
    }

    .connected-link-list small {
      margin-top: 4px;
      color: var(--muted);
    }

    .connected-link-list span {
      align-self: start;
      padding: 3px 8px;
      border-radius: 999px;
      background: #F3EAF0;
      color: #7A4A28;
      font-size: 0.72rem;
      font-weight: 850;
    }

    @media (max-width: 1200px) {
      .connected-kpi-grid,
      .integration-health-grid {
        grid-template-columns: repeat(3, minmax(0, 1fr));
      }

      .staff-connected-grid {
        grid-template-columns: 1fr;
      }
    }

    @media (max-width: 760px) {
      .connected-hero {
        display: grid;
      }

      .connected-filter-bar,
      .connected-link-list,
      .connected-kpi-grid,
      .integration-health-grid {
        grid-template-columns: 1fr;
      }
    }
  `]
})
export class StaffConnectedModulesComponent implements OnInit {
  readonly summary = signal<ApiRecord | null>(null);
  readonly branches = signal<ApiRecord[]>([]);
  readonly loading = signal(true);
  readonly error = signal('');

  readonly filterForm = this.fb.group({
    periodStart: [this.defaultStart()],
    periodEnd: [new Date().toISOString().slice(0, 10)],
    branchId: ['']
  });

  readonly integrationHealth = computed<ApiRecord[]>(() => this.summary()?.['integrationHealth'] || []);

  readonly staffModuleGroups = computed<StaffModuleGroup[]>(() => {
    const badge = (key: string, fallback = '') => {
      const count = this.countFor(key);
      return count ? String(count) : fallback;
    };
    return [
      {
        eyebrow: 'Flexi masters',
        title: 'Employee masters foundation',
        links: [
          { label: 'Employee Masters', path: '/staff-os/employee-masters', description: 'Profile, branch, category, designation, statutory fields', badge: badge('employee-masters') },
          { label: 'Attendance Master', path: '/staff-os/attendance-master', description: 'Present, absent, half-day and appointment availability rules', badge: badge('attendance') },
          { label: 'Leave Master', path: '/staff-os/leave-master', description: 'Leave types, quota, paid/unpaid and shift mapping', badge: 'Live' },
          { label: 'Shift Master', path: '/staff-os/shift-master', description: 'Shift templates, weekly off, holiday and leave shift types', badge: badge('shift') },
          { label: 'Attendance Category', path: '/staff-os/attendance-category', description: 'Late marks, overtime slabs and auto shift selection', badge: 'Rules' }
        ]
      },
      {
        eyebrow: 'Booking and POS',
        title: 'Operational handoff',
        links: [
          { label: 'Appointment Calendar', path: '/appointments', description: 'Staff-wise calendar, shift blocks and booking assignment', badge: badge('appointments') },
          { label: 'Fast POS', path: '/pos', description: 'Billing, staff sales attribution and payout source data', badge: badge('pos') },
          { label: 'Service Assign', path: '/staff-os/service-assignment', description: 'Employee-wise services used by booking and calendar filters', badge: badge('services') },
          { label: 'Tips Register', path: '/pos/tips', description: 'POS tips and staff payout handoff', badge: 'POS' }
        ]
      },
      {
        eyebrow: 'Payroll engine',
        title: 'Commission, incentive and statutory payroll',
        links: [
          { label: 'Target Incentives', path: '/staff-os/target-incentives/service', description: 'Service, product, membership, admin and all-transaction slabs', badge: badge('incentives') },
          { label: 'Commissions', path: '/commissions', description: 'Commission policies used by payroll calculations', badge: badge('commission') },
          { label: 'Fines Penalty', path: '/staff-os/fines-penalties', description: 'Penalty definitions before salary export', badge: 'Rules' },
          { label: 'Allowance Deduction', path: '/staff-os/allowance-deduction', description: 'Allowance and deduction master connected to payroll', badge: 'Rules' },
          { label: 'Salary Structure', path: '/staff-os/payroll-salary-structure', description: 'PF, PT, ESIC and TDS salary setup', badge: badge('payroll') },
          { label: 'Bulk Employee Update', path: '/staff-os/bulk-employee-update', description: 'Mass update employee statutory and personal fields', badge: 'Bulk' }
        ]
      },
      {
        eyebrow: 'Reports',
        title: 'Performance and command reporting',
        links: [
          { label: 'Staff Sales Report', path: '/reports/staff-sales', description: 'Staff revenue, services and product sales report', badge: badge('pos') },
          { label: 'Commission Preview', path: '/reports/commission-preview', description: 'Payroll-ready commission audit before payout', badge: badge('commission') },
          { label: 'Staff Enterprise OS', path: '/staff-enterprise', description: 'Documents, leave, reviews, transfers and enterprise actions', badge: 'OS' },
          { label: 'Staff OS', path: '/staff-os/staff-list', description: 'Advanced roster, mobile, tasks, heatmaps and staff tools', badge: 'Tools' }
        ]
      }
    ];
  });

  constructor(private readonly api: ApiService, private readonly fb: UntypedFormBuilder) {}

  ngOnInit(): void {
    this.filterForm.patchValue({ branchId: this.api.selectedBranchId() });
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.error.set('');
    const filters = this.filterForm.value;
    Promise.all([
      firstValueFrom(this.api.list<ApiRecord[]>('branches')),
      firstValueFrom(this.api.list<ApiRecord>('staff-management/summary', filters))
    ])
      .then(([branches, summary]) => {
        this.branches.set(branches || []);
        this.summary.set(summary || null);
        this.loading.set(false);
      })
      .catch((error) => {
        this.error.set(this.api.errorText(error, 'Unable to load staff connected modules'));
        this.loading.set(false);
      });
  }

  countFor(key: string): number {
    const row = this.integrationHealth().find((item) => String(item.key) === key);
    return Number(row?.['count'] || 0);
  }

  trackHealth(_index: number, item: ApiRecord): string {
    return String(item.key || item.label);
  }

  trackGroup(_index: number, group: StaffModuleGroup): string {
    return group.title;
  }

  trackLink(_index: number, link: StaffModuleLink): string {
    return `${link.path}:${link.label}`;
  }

  private defaultStart(): string {
    const date = new Date();
    date.setDate(date.getDate() - 29);
    return date.toISOString().slice(0, 10);
  }
}
