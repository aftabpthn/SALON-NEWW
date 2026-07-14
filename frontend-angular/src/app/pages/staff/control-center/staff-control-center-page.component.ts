import { CommonModule } from '@angular/common';
import { Component, OnInit, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { DatePickerComponent } from '../../../shared/date-picker/date-picker.component';
import { ApiEnvelope, ApiService } from '../../../shared/services/api.service';

type WorkspaceTab = 'command' | 'workforce' | 'development' | 'systems' | 'governance';
type Row = Record<string, any>;

@Component({
  selector: 'page-staff-control-center',
  standalone: true,
  imports: [CommonModule, FormsModule, DatePickerComponent],
  templateUrl: './staff-control-center-page.component.html',
  styleUrls: ['./staff-control-center-page.component.css'],
})
export class StaffControlCenterPageComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly router = inject(Router);

  readonly tabs: Array<{ key: WorkspaceTab; label: string; icon: string }> = [
    { key: 'command', label: 'Command center', icon: 'bi-speedometer2' },
    { key: 'workforce', label: 'Workforce', icon: 'bi-calendar2-week' },
    { key: 'development', label: 'Development', icon: 'bi-mortarboard' },
    { key: 'systems', label: 'Systems', icon: 'bi-fingerprint' },
    { key: 'governance', label: 'Governance', icon: 'bi-shield-check' },
  ];

  activeTab: WorkspaceTab = 'command';
  periodStart = this.isoDate(new Date(Date.now() - 29 * 86_400_000));
  periodEnd = this.isoDate(new Date());
  loading = false;
  error = '';
  lastLoaded = '';

  command: Row | null = null;
  floor: Row[] = [];
  swaps: Row[] = [];
  transfers: Row[] = [];
  coverage: Row | null = null;
  manpower: Row | null = null;
  skillMatrix: Row[] = [];
  licenses: Row[] = [];
  reviews: Row[] = [];
  coachingGoals: Row[] = [];
  training: Row[] = [];
  devices: Row[] = [];
  mappings: Row[] = [];
  biometricExceptions: Row[] = [];
  mobileConflicts: Row[] = [];
  approvals: Row[] = [];
  auditRows: Row[] = [];
  notifications: Row[] = [];
  tips: Row[] = [];
  compliance: Row | null = null;

  async ngOnInit() {
    await this.refresh();
  }

  async refresh() {
    this.loading = true;
    this.error = '';
    const period = this.periodQuery();
    const today = this.periodEnd;
    const requests: Array<Promise<void>> = [
      this.loadOne(`/staff-enterprise/command-center?${period}`, (value) => this.command = value),
      this.loadList(`/staff-enterprise/floor-control?date=${today}`, (value) => this.floor = value),
      this.loadList('/staff/shift-swaps', (value) => this.swaps = value),
      this.loadList('/staff/branch-transfers', (value) => this.transfers = value),
      this.loadOne(`/staff/roster/coverage?${period}`, (value) => this.coverage = value),
      this.loadOne(`/staff/manpower/forecast?${period}`, (value) => this.manpower = value),
      this.loadList('/staff-enterprise/skill-matrix', (value) => this.skillMatrix = value),
      this.loadList('/staff/skill-licenses', (value) => this.licenses = value),
      this.loadList('/staff/performance-reviews', (value) => this.reviews = value),
      this.loadList('/staff/coach/goals', (value) => this.coachingGoals = value),
      this.loadList('/staff-enterprise/training', (value) => this.training = value),
      this.loadList('/staff/biometric/devices', (value) => this.devices = value),
      this.loadList('/staff/biometric/mappings', (value) => this.mappings = value),
      this.loadList('/staff/biometric/exceptions', (value) => this.biometricExceptions = value),
      this.loadList('/staff/mobile/conflicts?status=open', (value) => this.mobileConflicts = value),
      this.loadList('/staff/approvals?status=pending', (value) => this.approvals = value),
      this.loadList('/staff/audit?eventPrefix=staff.', (value) => this.auditRows = value),
      this.loadList('/staff/notifications', (value) => this.notifications = value),
      this.loadList(`/staff/tips/summary?${period}`, (value) => this.tips = value),
      this.loadOne(`/staff/payroll-compliance/summary?${period}`, (value) => this.compliance = value),
    ];
    const results = await Promise.allSettled(requests);
    const failures = results.filter((result) => result.status === 'rejected');
    if (failures.length) this.error = `${failures.length} section${failures.length === 1 ? '' : 's'} could not be loaded`;
    this.lastLoaded = new Date().toISOString();
    this.loading = false;
  }

  async decideSwap(row: Row, decision: 'approved' | 'rejected') {
    await this.action(`/staff/shift-swaps/${row['id']}/decision`, { decision, version: row['version'], note: '' });
  }

  async decideTransfer(row: Row, decision: 'approved' | 'rejected') {
    await this.action(`/staff/branch-transfers/${row['id']}/decision`, { decision, version: row['version'], note: '' });
  }

  async decideApproval(row: Row, decision: 'approved' | 'rejected') {
    await this.action(`/staff/approvals/${row['id']}/decision`, { decision, version: row['version'], notes: '' });
  }

  selectTab(tab: WorkspaceTab) { this.activeTab = tab; }
  backToStaff() { void this.router.navigate(['/staff']); }
  openPayroll() { void this.router.navigate(['/staff/payroll']); }
  openAttendance() { void this.router.navigate(['/staff/attendance-summary']); }
  openLeave() { void this.router.navigate(['/staff/leave-management']); }

  objectEntries(value: unknown): Array<{ key: string; value: unknown }> {
    if (!value || Array.isArray(value) || typeof value !== 'object') return [];
    return Object.entries(value as Row).map(([key, item]) => ({ key: this.label(key), value: item }));
  }

  arrayValue(value: unknown): Row[] { return Array.isArray(value) ? value : []; }
  text(value: unknown) { return value === null || value === undefined || value === '' ? '—' : String(value); }
  label(value: string) { return value.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/_/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()); }
  money(value: unknown) {
    const amount = Number(value ?? 0);
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 2 }).format(amount / 100);
  }
  formatDate(value: unknown) {
    const date = String(value || '').slice(0, 10).split('-');
    return date.length === 3 ? `${date[2]}/${date[1]}/${date[0]}` : '—';
  }
  formatDateTime(value: unknown) {
    if (!value) return '—';
    const date = new Date(String(value));
    return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString('en-IN');
  }
  statusClass(value: unknown) { return ['approved', 'verified', 'processed', 'online', 'completed', 'closed'].includes(String(value).toLowerCase()) ? 'good' : ['rejected', 'expired', 'offline', 'conflict'].includes(String(value).toLowerCase()) ? 'bad' : ''; }
  staffName(row: Row) { return row['staffName'] || row['fromStaffName'] || row['displayName'] || row['staffId'] || '—'; }
  trackById(_: number, row: Row) { return row['id'] || row['staffId'] || row['key']; }

  private async action(path: string, payload: unknown) {
    this.loading = true;
    this.error = '';
    try {
      await firstValueFrom(this.api.post<ApiEnvelope<Row>>(path, payload));
      await this.refresh();
    } catch (error) {
      this.error = this.message(error, 'Action failed');
      this.loading = false;
    }
  }

  private async loadList(path: string, assign: (value: Row[]) => void) {
    const response = await firstValueFrom(this.api.get<ApiEnvelope<Row[]>>(path));
    assign(this.unwrap(response, 'Unable to load staff data'));
  }

  private async loadOne(path: string, assign: (value: Row) => void) {
    const response = await firstValueFrom(this.api.get<ApiEnvelope<Row>>(path));
    assign(this.unwrap(response, 'Unable to load staff data'));
  }

  private unwrap<T>(response: ApiEnvelope<T>, fallback: string): T {
    if (!response.success || response.data === undefined) throw new Error(response.error?.message || fallback);
    return response.data;
  }

  private periodQuery() {
    return new URLSearchParams({ periodStart: this.periodStart, periodEnd: this.periodEnd }).toString();
  }

  private isoDate(value: Date) { return value.toISOString().slice(0, 10); }
  private message(error: unknown, fallback: string) {
    const candidate = error as { error?: { error?: { message?: string }; message?: string }; message?: string };
    return candidate?.error?.error?.message || candidate?.error?.message || candidate?.message || fallback;
  }
}
