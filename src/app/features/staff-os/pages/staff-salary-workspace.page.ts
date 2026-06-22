import { CommonModule } from '@angular/common';
import { Component, OnInit, computed, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ApiRecord } from '../../../core/api.service';
import { StaffOsApi } from '../data/staff-os.api';

type WorkspaceLink = {
  label: string;
  path: string;
  note: string;
  tag: string;
};

type WorkspaceSection = {
  title: string;
  subtitle: string;
  links: WorkspaceLink[];
};

const sections: WorkspaceSection[] = [
  {
    title: '1. Staff Setup',
    subtitle: 'Employee master data is prepared here.',
    links: [
      { label: 'Staff List', path: '/staff-os/staff-list', tag: 'Live', note: 'Staff add/edit, active/inactive status.' },
      { label: 'Staff Categories', path: '/staff-os/staff-categories', tag: 'Live', note: 'Role, designation, staff category.' },
      { label: 'Service Assign', path: '/staff-os/service-assignment', tag: 'Live', note: 'Staff-wise service eligibility and assignment.' }
    ]
  },
  {
    title: '2. Attendance & Shift Rules',
    subtitle: 'Salary is based on attendance, shifts and leave rules.',
    links: [
      { label: 'Shift Master', path: '/staff-os/shift-master', tag: 'Live', note: 'Shift hours, week off, timing rules.' },
      { label: 'Attendance Master', path: '/staff-os/attendance-master', tag: 'Live', note: 'Present, absent, holiday and paid/unpaid rules.' },
      { label: 'Leave Master', path: '/staff-os/leave-master', tag: 'Live', note: 'Leave type, quota, paid leave setup.' },
      { label: 'Attendance Category', path: '/staff-os/attendance-category', tag: 'Live', note: 'Late mark, overtime and attendance slabs.' },
      { label: 'Face Punch', path: '/staff-os/face-punch', tag: 'Live', note: 'Mobile face scan punch in/out.' },
      { label: 'Attendance Dash', path: '/staff-os/attendance-dashboard', tag: 'Live', note: 'Daily attendance overview.' },
      { label: 'Roster Calendar', path: '/staff-os/roster-calendar', tag: 'Live', note: 'Roster and schedule planning.' },
      { label: 'Leave Mgmt', path: '/staff-os/leave-management', tag: 'Live', note: 'Leave approvals and balance.' }
    ]
  },
  {
    title: '3. Payroll Setup',
    subtitle: 'Salary formula, fines, advance, allowance aur week-off rules.',
    links: [
      { label: 'Payroll Rules', path: '/staff-os/payroll-rules', tag: 'New', note: 'Week off, sandwich, weekend penalty, commission %, advance cap.' },
      { label: 'Salary Structure', path: '/staff-os/payroll-salary-structure', tag: 'Live', note: 'Basic salary and payroll structure.' },
      { label: 'Fines Penalty', path: '/staff-os/fines-penalties', tag: 'Live', note: 'Fine and penalty setup.' },
      { label: 'Allowance Deduction', path: '/staff-os/allowance-deduction', tag: 'Live', note: 'Allowance, deduction and adjustment rules.' }
    ]
  },
  {
    title: '4. Commission & Salary Generate',
    subtitle: 'Final salary preview, commission, payroll report aur payout.',
    links: [
      { label: 'Target Incentives', path: '/staff-os/target-incentives/service', tag: 'Live', note: 'Service, product and membership incentive rules.' },
      { label: 'Commission Dash', path: '/staff-os/commission-dashboard', tag: 'Live', note: 'Commission overview and payout status.' },
      { label: 'Salary Generate', path: '/staff-os/salary-generate', tag: 'Main', note: 'Attendance, OT, commission, advance and net salary calculation.' },
      { label: 'Payroll Dash', path: '/staff-os/payroll-dashboard', tag: 'Live', note: 'Generated payroll summary and review.' }
    ]
  }
];

const workspaceSummary = [
  { label: 'Setup steps', value: '4', note: 'Staff, attendance, payroll rules, salary generate' },
  { label: 'Ready actions', value: '18', note: 'Direct linked Staff OS actions' },
  { label: 'Pending review', value: 'Payroll data', note: 'Preview page validates missing salary/attendance data' },
  { label: 'Main output', value: 'Net Salary', note: 'Generated from attendance, OT, commission and advance rules' }
];

@Component({
  standalone: true,
  imports: [CommonModule, RouterLink],
  template: `
    <section class="workspace">
      <header class="hero">
        <div>
          <span>Staff OS</span>
          <h1>Staff Salary Workspace</h1>
          <p>All live pages needed for salary generation are connected in one place.</p>
        </div>
        <a routerLink="/staff-os/salary-generate">Open Salary Generate</a>
      </header>

      <section class="summary">
        <article *ngFor="let item of summary">
          <span>{{ item.label }}</span>
          <strong>{{ item.value }}</strong>
          <small>{{ item.note }}</small>
        </article>
      </section>

      <section class="advanced">
        <article>
          <div>
            <span>Payroll compliance</span>
            <strong>{{ complianceSummary()?.['calculations'] || 0 }}</strong>
            <small>{{ money(complianceSummary()?.['netStatutoryDeduction']) }} statutory deduction tracked</small>
          </div>
          <a routerLink="/staff-os/salary-generate">Review payroll</a>
        </article>
        <article [class.warn]="highRiskCount() > 0">
          <div>
            <span>Staff risk</span>
            <strong>{{ highRiskCount() }}</strong>
            <small>{{ riskRows().length || 0 }} burnout/churn signals loaded</small>
          </div>
          <a routerLink="/staff-os/performance-dashboard">Open performance</a>
        </article>
        <article [class.warn]="mobileConflicts().length > 0">
          <div>
            <span>Offline staff sync</span>
            <strong>{{ mobileConflicts().length }}</strong>
            <small>Open mobile conflicts needing manager decision</small>
          </div>
          <a routerLink="/staff-os/mobile-preview">Open mobile</a>
        </article>
        <article>
          <div>
            <span>Payroll control</span>
            <strong>{{ advancedReadiness() }}%</strong>
            <small>Compliance, risk and offline sync visibility</small>
          </div>
          <button type="button" (click)="loadAdvanced()">Refresh</button>
        </article>
      </section>

      <p class="notice" *ngIf="advancedNotice()">{{ advancedNotice() }}</p>

      <section class="flow">
        <article *ngFor="let section of sections">
          <div class="section-head">
            <div>
              <h2>{{ section.title }}</h2>
              <p>{{ section.subtitle }}</p>
            </div>
          </div>
          <div class="tiles">
            <a *ngFor="let item of section.links" [routerLink]="item.path">
              <span>{{ item.tag }}</span>
              <strong>{{ item.label }}</strong>
              <small>{{ item.note }}</small>
            </a>
          </div>
        </article>
      </section>
    </section>
  `,
  styles: [`
    .workspace { display: grid; gap: 16px; color: #122033; }
    .hero, article { background: #fff; border: 1px solid #d8e4ea; border-radius: 8px; box-shadow: 0 16px 34px rgba(15,23,42,.06); }
    .hero { display: flex; justify-content: space-between; gap: 16px; align-items: center; padding: 22px 24px; }
    .hero span { color: #0f8f79; font-size: 12px; font-weight: 900; text-transform: uppercase; }
    h1 { margin: 4px 0 6px; font-size: 32px; letter-spacing: 0; } h2 { margin: 0 0 4px; font-size: 18px; }
    p { margin: 0; color: #607086; }
    .hero a { min-height: 40px; display: inline-flex; align-items: center; border-radius: 6px; padding: 0 14px; background: #0f8f79; color: #fff; font-weight: 900; text-decoration: none; white-space: nowrap; }
    .flow { display: grid; gap: 14px; }
    .summary { display: grid; grid-template-columns: repeat(4, minmax(0,1fr)); gap: 12px; }
    .summary article { align-content: start; min-height: 108px; }
    .summary span { color: #607086; font-size: 12px; font-weight: 900; text-transform: uppercase; }
    .summary strong { font-size: 24px; letter-spacing: 0; }
    .summary small { color: #607086; line-height: 1.35; }
    .advanced { display: grid; grid-template-columns: repeat(4, minmax(0,1fr)); gap: 12px; }
    .advanced article { display: flex; justify-content: space-between; gap: 12px; align-items: start; min-height: 122px; border-top: 4px solid #0f8f79; }
    .advanced article.warn { border-top-color: #dc6803; }
    .advanced span { color: #607086; font-size: 12px; font-weight: 900; text-transform: uppercase; }
    .advanced strong { display: block; margin: 5px 0; font-size: 28px; }
    .advanced small { color: #607086; line-height: 1.35; }
    .advanced a, .advanced button { min-height: 36px; display: inline-flex; align-items: center; border: 1px solid #0f8f79; border-radius: 6px; padding: 0 10px; background: #fff; color: #0f766e; font-weight: 900; text-decoration: none; white-space: nowrap; }
    .notice { padding: 10px 14px; border: 1px solid #bfdbfe; border-radius: 8px; background: #eef8ff; color: #1d4e89; font-weight: 800; }
    article { padding: 16px; display: grid; gap: 14px; }
    .tiles { display: grid; grid-template-columns: repeat(4, minmax(0,1fr)); gap: 12px; }
    .tiles a { min-height: 122px; display: grid; align-content: start; gap: 8px; padding: 14px; border: 1px solid #d8e4ea; border-top: 4px solid #0f8f79; border-radius: 8px; text-decoration: none; color: #122033; background: #fbfefd; }
    .tiles span { width: fit-content; padding: 4px 8px; border-radius: 999px; background: #e7f7f3; color: #0f766e; font-size: 11px; font-weight: 900; }
    .tiles strong { font-size: 16px; }
    .tiles small { color: #607086; line-height: 1.35; }
    @media (max-width: 1100px) { .tiles, .summary, .advanced { grid-template-columns: repeat(2, minmax(0,1fr)); } }
    @media (max-width: 700px) { .hero { display: grid; } .tiles, .summary, .advanced { grid-template-columns: 1fr; } .advanced article { display: grid; } }
  `]
})
export class StaffSalaryWorkspacePage implements OnInit {
  readonly sections = sections;
  readonly summary = workspaceSummary;
  readonly complianceSummary = signal<ApiRecord | null>(null);
  readonly riskRows = signal<ApiRecord[]>([]);
  readonly mobileConflicts = signal<ApiRecord[]>([]);
  readonly advancedNotice = signal('');

  readonly highRiskCount = computed(() => this.riskRows().filter((row) => ['high', 'critical'].includes(String(row['level'] || row['riskLevel'] || '').toLowerCase())).length);
  readonly advancedReadiness = computed(() => {
    const checks = [
      this.complianceSummary() !== null,
      this.riskRows().length >= 0,
      this.mobileConflicts().length >= 0
    ];
    return Math.round((checks.filter(Boolean).length / checks.length) * 100);
  });

  constructor(private readonly api: StaffOsApi) {}

  ngOnInit(): void {
    this.loadAdvanced();
  }

  loadAdvanced(): void {
    this.advancedNotice.set('');
    this.api.payrollComplianceSummary({}).subscribe({
      next: (summary) => this.complianceSummary.set(summary || {}),
      error: () => {
        this.complianceSummary.set(null);
        this.advancedNotice.set('Payroll compliance summary will be available after role and permission setup.');
      }
    });
    this.api.burnoutRisk({ limit: 100 }).subscribe({
      next: (rows) => this.riskRows.set((rows || []) as ApiRecord[]),
      error: () => this.riskRows.set([])
    });
    this.api.mobileConflicts({ status: 'open', limit: 50 }).subscribe({
      next: (rows) => this.mobileConflicts.set(rows || []),
      error: () => this.mobileConflicts.set([])
    });
  }

  money(value: unknown): string {
    const amount = Number(value || 0);
    return '₹' + Math.round(Number.isFinite(amount) ? amount : 0).toLocaleString('en-IN');
  }
}
