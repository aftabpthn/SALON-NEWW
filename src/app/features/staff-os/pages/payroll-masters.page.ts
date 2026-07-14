import { CommonModule } from '@angular/common';
import { Component, Input, OnInit, computed, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Observable, catchError, finalize, forkJoin, of } from 'rxjs';
import { ApiRecord } from '../../../core/api.service';
import { StaffOsApi } from '../data/staff-os.api';
import { StaffOsAllowanceDeduction, StaffOsBranch, StaffOsFinePenalty, StaffOsPayrollSalaryStructure, StaffOsStaff } from '../domain/staff-os.models';
import { AuraMoneyPipe } from '../../../shared/pipes/aura-money.pipe';

type PayrollDefinitionKind = 'fine' | 'allowance';
type FinePenaltyRuleType = NonNullable<StaffOsFinePenalty['ruleType']>;
type FinePenaltyApplyMode = NonNullable<StaffOsFinePenalty['applyMode']>;
type FinePenaltyRuleOption = { value: string; label: string; ruleType?: FinePenaltyRuleType; ruleLabel?: string };
type PenaltyPreviewRow = {
  staffId: string;
  staffName: string;
  ruleName: string;
  ruleType: FinePenaltyRuleType;
  breakCount: number;
  amount: number;
  evidence: string;
};

@Component({
  selector: 'app-staff-payroll-definition',
  standalone: true,
  imports: [AuraMoneyPipe, CommonModule, RouterLink],
  template: `
    <section class="definition-page">
      <header class="topbar">
        <div>
          <h1>{{ kind === 'fine' ? 'Fines / Penalty Definition' : 'Allowance / Deduction Master' }}</h1>
        </div>
        <div class="topbar-actions">
          <a class="refresh" routerLink="/staff-os/employee-masters">Masters</a>
          <button type="button" class="refresh" (click)="load()">Refresh</button>
        </div>
      </header>

      <div *ngIf="loading()" class="state">Loading payroll definition...</div>
      <div *ngIf="error()" class="state error">{{ error() }}</div>

      <section class="shell">
        <aside class="list-panel">
          <div class="definition-tabs" *ngIf="kind === 'allowance'">
            <button type="button" [class.active]="entryType() === 'allowance'" (click)="entryType.set('allowance'); select(null)">Allowance</button>
            <button type="button" [class.active]="entryType() === 'deduction'" (click)="entryType.set('deduction'); select(null)">Deduction</button>
          </div>
          <label>
            <span>Search</span>
            <input [value]="search()" (input)="search.set($any($event.target).value)" />
          </label>
          <div class="table">
            <div class="head"><span>Name</span><span>Hide</span><span *ngIf="kind === 'fine'">Amount</span></div>
            <button type="button" class="row" *ngFor="let item of visibleRows()" [class.active]="selectedId() === item.id" (click)="select(item)">
              <strong>{{ rowName(item) }}</strong>
              <span>{{ item.hide ? 'Yes' : 'No' }}</span>
              <span *ngIf="kind === 'fine'">{{ rowAmount(item) | auraMoney:'1.0-0' }}</span>
            </button>
          </div>
        </aside>

        <main class="form-panel">
          <label>
            <span>{{ kind === 'fine' ? 'Name' : 'Description' }}</span>
            <input [value]="name()" (input)="name.set($any($event.target).value)" />
          </label>
          <label *ngIf="kind === 'fine'">
            <span>Amount</span>
            <input type="number" min="0" [value]="amount()" (input)="amount.set(toNumber($any($event.target).value))" />
          </label>
          <div class="rule-grid" *ngIf="kind === 'fine'">
            <label>
              <span>Rule trigger</span>
              <div class="select-action">
                <select [value]="triggerValue()" (change)="changeRuleTrigger($any($event.target).value)">
                  <option *ngFor="let option of triggerOptions()" [value]="option.value">{{ option.label }}</option>
                </select>
                <button type="button" class="mini-action" (click)="startCustomTrigger()">+ Add</button>
              </div>
            </label>
            <label *ngIf="customTriggerOpen()">
              <span>New trigger name</span>
              <input [value]="ruleLabel()" (input)="ruleLabel.set($any($event.target).value)" placeholder="Example: No uniform" />
            </label>
            <label>
              <span>Apply</span>
              <select [value]="applyMode()" (change)="applyMode.set($any($event.target).value)">
                <option *ngFor="let option of applyModeOptions" [value]="option.value">{{ option.label }}</option>
              </select>
            </label>
            <label>
              <span>Trigger count</span>
              <input type="number" min="1" [value]="triggerCount()" (input)="triggerCount.set(toCount($any($event.target).value))" />
            </label>
            <label class="inline">
              <input type="checkbox" [checked]="autoDeduct()" (change)="autoDeduct.set($any($event.target).checked)" />
              <span>Auto deduct salary</span>
            </label>
          </div>
          <label class="inline">
            <input type="checkbox" [checked]="hide()" (change)="hide.set($any($event.target).checked)" />
            <span>Hide</span>
          </label>
          <label>
            <span>Remarks</span>
            <textarea rows="4" [value]="notes()" (input)="notes.set($any($event.target).value)"></textarea>
          </label>
          <div class="state error" *ngIf="saveError()">{{ saveError() }}</div>
          <footer class="actions">
            <button type="button" class="refresh" (click)="select(null)">Cancel</button>
            <button type="button" class="refresh danger" *ngIf="selected()" (click)="archiveOrRestore()">{{ archived() ? 'Restore' : 'Archive' }}</button>
            <button type="button" class="primary" [disabled]="saving()" (click)="save()">{{ saving() ? 'Saving...' : 'Save' }}</button>
          </footer>
        </main>
      </section>

      <section class="live-panel" *ngIf="kind === 'fine'">
        <div class="live-head">
          <div>
            <h2>Salary deduction monitor</h2>
          </div>
          <div class="topbar-actions">
            <label class="period-filter">
              <span>Period</span>
              <input type="month" [value]="period()" (input)="changePenaltyPeriod($any($event.target).value)" />
            </label>
            <button type="button" class="refresh" (click)="loadPenaltyContext()">Refresh</button>
          </div>
        </div>
        <div class="metric-strip">
          <article><span>Staff impacted</span><strong>{{ penaltySummary().staff }}</strong></article>
          <article><span>Rule breaks</span><strong>{{ penaltySummary().breaks }}</strong></article>
          <article><span>Salary deduction</span><strong>{{ penaltySummary().amount | auraMoney:'1.0-0' }}</strong></article>
        </div>
        <div *ngIf="penaltyLoading()" class="state">Loading rule breaks...</div>
        <div *ngIf="penaltyError()" class="state error">{{ penaltyError() }}</div>
        <div class="preview-table">
          <div class="preview-head"><span>Staff</span><span>Rule</span><span>Breaks</span><span>Deduction</span><span>Evidence</span></div>
          <div class="preview-row" *ngFor="let row of penaltyPreviewRows()">
            <strong>{{ row.staffName }}</strong>
            <span>{{ row.ruleName }}</span>
            <span>{{ row.breakCount }}</span>
            <span>{{ row.amount | auraMoney:'1.0-0' }}</span>
            <span>{{ row.evidence }}</span>
          </div>
          <div class="preview-row empty" *ngIf="!penaltyPreviewRows().length">
            <span>No active rule breaks for this period.</span>
          </div>
        </div>
      </section>
    </section>
  `,
  styles: [`
    .definition-page { color: #10201a; display: grid; gap: 18px; padding: 24px; }
    .topbar, .topbar-actions, .actions { align-items: flex-start; display: flex; gap: 12px; justify-content: space-between; }
    .topbar-actions, .actions { align-items: center; justify-content: flex-end; flex-wrap: wrap; }
    .eyebrow { color: #547066; font-size: 12px; font-weight: 850; letter-spacing: .08em; margin: 0 0 5px; text-transform: uppercase; }
    h1 { font-size: 30px; letter-spacing: 0; margin: 0; }
    .shell { display: grid; grid-template-columns: 1fr; gap: 16px; align-items: start; }
    .list-panel, .form-panel { width: 100%; }
    .list-panel, .form-panel, .state { background: #fff; border: 1px solid #E7DDD6; border-radius: 8px; }
    .list-panel, .form-panel { display: grid; gap: 14px; padding: 16px; }
    .state { color: #61746c; padding: 14px; }
    .error { color: #a52828; border-color: #e7b1b1; }
    .refresh, .primary, .definition-tabs button { border: 1px solid #E7DDD6; border-radius: 6px; cursor: pointer; font-weight: 850; min-height: 38px; padding: 9px 12px; text-decoration: none; }
    .refresh, .definition-tabs button { background: #fff; color: #34483f; }
    .primary, .definition-tabs button.active { background: #4B1238; border-color: #4B1238; color: #fff; }
    .danger { color: #a52828; }
    .definition-tabs { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
    label { color: #34483f; display: grid; font-size: 13px; font-weight: 850; gap: 6px; }
    label.inline { align-items: center; display: inline-flex; }
    input, select, textarea { border: 1px solid #E7DDD6; border-radius: 8px; color: #10201a; font: inherit; padding: 10px 11px; width: 100%; }
    input[type='checkbox'] { height: 18px; padding: 0; width: 18px; }
    .rule-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
    .select-action { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 8px; }
    .mini-action { border: 1px solid #E7DDD6; border-radius: 6px; background: #FAF8F6; color: #34483f; cursor: pointer; font-weight: 900; min-height: 40px; padding: 0 10px; white-space: nowrap; }
    .table { border: 1px solid #E7DDD6; border-radius: 8px; display: grid; overflow: hidden; }
    .head, .row { align-items: center; display: grid; gap: 8px; grid-template-columns: 1fr 70px 100px; min-height: 42px; padding: 0 12px; }
    .head { background: #FAF8F6; color: #60766d; font-size: 12px; font-weight: 900; text-transform: uppercase; }
    .row { background: #fff; border: 0; border-top: 1px solid #edf2ef; color: #10201a; cursor: pointer; font: inherit; text-align: left; }
    .row.active { background: #FAF8F6; }
    .actions { border-top: 1px solid #edf2ef; padding-top: 12px; }
    .live-panel { background: #fff; border: 1px solid #E7DDD6; border-radius: 8px; display: grid; gap: 14px; padding: 16px; }
    .live-head { align-items: center; display: flex; justify-content: space-between; gap: 14px; }
    h2 { font-size: 20px; letter-spacing: 0; margin: 0; }
    .period-filter { min-width: 170px; }
    .metric-strip { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
    .metric-strip article { background: #FAF8F6; border: 1px solid #E7DDD6; border-radius: 8px; padding: 12px; }
    .metric-strip span { color: #60766d; display: block; font-size: 12px; font-weight: 900; text-transform: uppercase; }
    .metric-strip strong { display: block; font-size: 22px; margin-top: 5px; }
    .preview-table { border: 1px solid #E7DDD6; border-radius: 8px; display: grid; overflow: hidden; }
    .preview-head, .preview-row { align-items: center; display: grid; gap: 10px; grid-template-columns: 1fr 1.1fr 80px 120px 1.3fr; min-height: 42px; padding: 0 12px; }
    .preview-head { background: #FAF8F6; color: #60766d; font-size: 12px; font-weight: 900; text-transform: uppercase; }
    .preview-row { border-top: 1px solid #edf2ef; color: #10201a; }
    .preview-row.empty { grid-template-columns: 1fr; color: #60766d; padding: 14px; }
    @media (max-width: 920px) { .shell { grid-template-columns: 1fr; } }
    @media (max-width: 760px) { .rule-grid, .metric-strip, .preview-head, .preview-row { grid-template-columns: 1fr; } .live-head { display: grid; } }
    @media (max-width: 640px) { .definition-page { padding: 16px; } .topbar { display: grid; } .head, .row { grid-template-columns: 1fr 56px; } .head span:last-child, .row span:last-child { display: none; } }
  `]
})
export class StaffPayrollDefinitionComponent implements OnInit {
  @Input({ required: true }) kind: PayrollDefinitionKind = 'fine';

  readonly fines = signal<StaffOsFinePenalty[]>([]);
  readonly allowances = signal<StaffOsAllowanceDeduction[]>([]);
  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly error = signal('');
  readonly saveError = signal('');
  readonly selectedId = signal('');
  readonly name = signal('');
  readonly amount = signal(0);
  readonly hide = signal(false);
  readonly notes = signal('');
  readonly entryType = signal<'allowance' | 'deduction'>('allowance');
  readonly search = signal('');
  readonly ruleType = signal<FinePenaltyRuleType>('manual');
  readonly ruleLabel = signal('');
  readonly customTriggerOpen = signal(false);
  readonly triggerCount = signal(1);
  readonly applyMode = signal<FinePenaltyApplyMode>('per_occurrence');
  readonly autoDeduct = signal(true);
  readonly period = signal(new Date().toISOString().slice(0, 7));
  readonly staffRows = signal<StaffOsStaff[]>([]);
  readonly attendanceRows = signal<ApiRecord[]>([]);
  readonly payrollPreviewRows = signal<ApiRecord[]>([]);
  readonly penaltyLoading = signal(false);
  readonly penaltyError = signal('');
  readonly ruleOptions: Array<{ value: FinePenaltyRuleType; label: string }> = [
    { value: 'manual', label: 'Manual only' },
    { value: 'late_count', label: 'Late count' },
    { value: 'absent_day', label: 'Absent day' },
    { value: 'half_day', label: 'Half day' },
    { value: 'short_hours', label: 'Short hours' },
    { value: 'no_clock_out', label: 'No clock out' },
    { value: 'weekend_penalty', label: 'Weekend penalty' },
    { value: 'sandwich_penalty', label: 'Sandwich penalty' },
    { value: 'unpaid_week_off', label: 'Unpaid week off' }
  ];
  readonly triggerOptions = computed<FinePenaltyRuleOption[]>(() => {
    const seen = new Set<string>();
    const custom = this.fines()
      .filter((rule) => rule.ruleLabel && (rule.ruleType || 'manual') !== 'manual')
      .map((rule) => ({
        value: this.customTriggerValue(rule.ruleType || 'manual', rule.ruleLabel || ''),
        label: `${rule.ruleLabel} (${this.ruleOptionLabel(rule.ruleType || 'manual')})`,
        ruleType: rule.ruleType || 'manual',
        ruleLabel: rule.ruleLabel || ''
      }))
      .filter((option) => {
        if (seen.has(option.value)) return false;
        seen.add(option.value);
        return true;
      });
    const currentLabel = this.ruleLabel().trim();
    if (currentLabel) {
      const currentValue = this.customTriggerValue(this.ruleType(), currentLabel);
      if (!seen.has(currentValue)) {
        custom.push({
          value: currentValue,
          label: `${currentLabel} (${this.ruleOptionLabel(this.ruleType())})`,
          ruleType: this.ruleType(),
          ruleLabel: currentLabel
        });
      }
    }
    return [
      ...this.ruleOptions.map((option) => ({ value: option.value, label: option.label, ruleType: option.value })),
      ...custom,
      { value: '__add__', label: '+ Add rule trigger' }
    ];
  });
  readonly applyModeOptions: Array<{ value: FinePenaltyApplyMode; label: string }> = [
    { value: 'per_occurrence', label: 'Per occurrence' },
    { value: 'fixed', label: 'Fixed once' }
  ];
  readonly penaltyPreviewRows = computed(() => this.buildPenaltyPreviewRows());
  readonly penaltySummary = computed(() => {
    const rows = this.penaltyPreviewRows();
    return {
      staff: new Set(rows.map((row) => row.staffId)).size,
      breaks: rows.reduce((total, row) => total + row.breakCount, 0),
      amount: rows.reduce((total, row) => total + row.amount, 0)
    };
  });

  constructor(private readonly api: StaffOsApi) {}

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.error.set('');
    const request: Observable<Array<StaffOsFinePenalty | StaffOsAllowanceDeduction>> = this.kind === 'fine'
      ? this.api.finePenalties({ includeArchived: 'true', limit: 1000 })
      : this.api.allowanceDeductions({ includeArchived: 'true', limit: 1000 });
    request.pipe(finalize(() => this.loading.set(false))).subscribe({
      next: (rows: Array<StaffOsFinePenalty | StaffOsAllowanceDeduction>) => {
        if (this.kind === 'fine') this.fines.set(rows as StaffOsFinePenalty[]);
        else this.allowances.set(rows as StaffOsAllowanceDeduction[]);
        this.reselect();
        if (this.kind === 'fine') this.loadPenaltyContext();
      },
      error: (error: unknown) => this.error.set(this.apiError(error, 'Unable to load payroll definition'))
    });
  }

  loadPenaltyContext(): void {
    if (this.kind !== 'fine') return;
    this.penaltyLoading.set(true);
    this.penaltyError.set('');
    forkJoin({
      staff: this.api.staff({ status: 'active', limit: 1000 }),
      attendance: this.api.attendance({ from: this.periodStart(), to: this.periodEnd(), limit: 1000 }).pipe(catchError(() => of([] as ApiRecord[]))),
      preview: this.api.attendancePayrollPreview({ periodStart: this.periodStart(), periodEnd: this.periodEnd(), limit: 1000 }).pipe(catchError(() => of([] as ApiRecord[])))
    }).pipe(finalize(() => this.penaltyLoading.set(false))).subscribe({
      next: ({ staff, attendance, preview }) => {
        this.staffRows.set(staff || []);
        this.attendanceRows.set(attendance || []);
        this.payrollPreviewRows.set(preview || []);
      },
      error: (error: unknown) => this.penaltyError.set(this.apiError(error, 'Unable to load rule breaks'))
    });
  }

  rows(): Array<StaffOsFinePenalty | StaffOsAllowanceDeduction> {
    return this.kind === 'fine' ? this.fines() : this.allowances().filter((row) => row.entryType === this.entryType());
  }

  visibleRows(): Array<StaffOsFinePenalty | StaffOsAllowanceDeduction> {
    const term = this.search().trim().toLowerCase();
    return this.rows().filter((row) => !term || this.rowName(row).toLowerCase().includes(term));
  }

  selected(): StaffOsFinePenalty | StaffOsAllowanceDeduction | undefined {
    return this.rows().find((row) => row.id === this.selectedId());
  }

  rowName(row: StaffOsFinePenalty | StaffOsAllowanceDeduction): string {
    return 'description' in row ? row.description : row.name;
  }

  rowAmount(row: StaffOsFinePenalty | StaffOsAllowanceDeduction): number {
    return 'amount' in row ? row.amount : 0;
  }

  toNumber(value: unknown): number {
    const parsed = Number(value || 0);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  toCount(value: unknown): number {
    return Math.max(1, this.toNumber(value));
  }

  triggerValue(): string {
    const label = this.ruleLabel().trim();
    return label ? this.customTriggerValue(this.ruleType(), label) : this.ruleType();
  }

  changeRuleTrigger(value: string): void {
    if (value === '__add__') {
      this.startCustomTrigger();
      return;
    }
    if (value.startsWith('custom|')) {
      const [, ruleType, encodedLabel] = value.split('|');
      this.ruleType.set((ruleType || 'manual') as FinePenaltyRuleType);
      this.ruleLabel.set(decodeURIComponent(encodedLabel || ''));
      this.customTriggerOpen.set(true);
      return;
    }
    this.ruleType.set(value as FinePenaltyRuleType);
    this.ruleLabel.set('');
    this.customTriggerOpen.set(false);
  }

  startCustomTrigger(): void {
    if (this.ruleType() === 'manual') this.ruleType.set('late_count');
    this.customTriggerOpen.set(true);
  }

  customTriggerValue(ruleType: FinePenaltyRuleType, label: string): string {
    return `custom|${ruleType}|${encodeURIComponent(label.trim())}`;
  }

  ruleOptionLabel(ruleType: FinePenaltyRuleType): string {
    return this.ruleOptions.find((option) => option.value === ruleType)?.label || 'Manual only';
  }

  archived(): boolean {
    const selected = this.selected();
    return Boolean(selected?.hide || selected?.status !== 'active');
  }

  select(row: StaffOsFinePenalty | StaffOsAllowanceDeduction | null): void {
    this.selectedId.set(row?.id || '');
    this.name.set(row ? this.rowName(row) : '');
    this.amount.set(row ? this.rowAmount(row) : 0);
    this.hide.set(Boolean(row?.hide));
    this.notes.set(row?.notes || '');
    if (row && 'entryType' in row) this.entryType.set(row.entryType);
    if (row && 'ruleType' in row) {
      this.ruleType.set(row.ruleType || 'manual');
      this.ruleLabel.set(row.ruleLabel || '');
      this.customTriggerOpen.set(Boolean(row.ruleLabel));
      this.triggerCount.set(Math.max(1, this.toNumber(row.triggerCount || 1)));
      this.applyMode.set(row.applyMode || 'per_occurrence');
      this.autoDeduct.set(row.autoDeduct !== false);
    } else if (!row && this.kind === 'fine') {
      this.ruleType.set('manual');
      this.ruleLabel.set('');
      this.customTriggerOpen.set(false);
      this.triggerCount.set(1);
      this.applyMode.set('per_occurrence');
      this.autoDeduct.set(true);
    }
    this.saveError.set('');
  }

  save(): void {
    this.saving.set(true);
    this.saveError.set('');
    const selected = this.selected();
    const payload = this.kind === 'fine'
      ? { name: this.name(), amount: this.amount(), amountPaise: Math.round(this.amount() * 100), ruleType: this.ruleType(), ruleLabel: this.ruleLabel().trim(), triggerCount: this.triggerCount(), applyMode: this.applyMode(), autoDeduct: this.autoDeduct(), hide: this.hide(), notes: this.notes(), status: this.hide() ? 'archived' : 'active', ...(selected ? { version: selected.version } : {}) }
      : { description: this.name(), entryType: this.entryType(), hide: this.hide(), notes: this.notes(), status: this.hide() ? 'archived' : 'active', ...(selected ? { version: selected.version } : {}) };
    const request: Observable<StaffOsFinePenalty | StaffOsAllowanceDeduction> = this.kind === 'fine'
      ? selected ? this.api.updateFinePenalty(selected.id, payload) : this.api.createFinePenalty(payload)
      : selected ? this.api.updateAllowanceDeduction(selected.id, payload) : this.api.createAllowanceDeduction(payload);
    request.pipe(finalize(() => this.saving.set(false))).subscribe({
      next: (saved: StaffOsFinePenalty | StaffOsAllowanceDeduction) => {
        this.select(saved as StaffOsFinePenalty | StaffOsAllowanceDeduction);
        this.load();
      },
      error: (error: unknown) => this.saveError.set(this.apiError(error, 'Unable to save payroll definition'))
    });
  }

  archiveOrRestore(): void {
    const selected = this.selected();
    if (!selected) return;
    const restore = this.archived();
    const payload = { version: selected.version, status: restore ? 'active' : 'archived', hide: !restore };
    this.saving.set(true);
    const request: Observable<StaffOsFinePenalty | StaffOsAllowanceDeduction> = this.kind === 'fine'
      ? this.api.updateFinePenaltyStatus(selected.id, payload)
      : this.api.updateAllowanceDeductionStatus(selected.id, payload);
    request.pipe(finalize(() => this.saving.set(false))).subscribe({
      next: () => this.load(),
      error: (error: unknown) => this.saveError.set(this.apiError(error, 'Unable to update payroll definition'))
    });
  }

  changePenaltyPeriod(value: string): void {
    this.period.set(value || new Date().toISOString().slice(0, 7));
    this.loadPenaltyContext();
  }

  buildPenaltyPreviewRows(): PenaltyPreviewRow[] {
    const rules = this.fines().filter((rule) =>
      !rule.hide &&
      rule.status !== 'archived' &&
      rule.autoDeduct !== false &&
      (rule.ruleType || 'manual') !== 'manual'
    );
    if (!rules.length) return [];
    const previewByStaff = new Map(this.payrollPreviewRows().map((row) => [String(row['staffId'] || row['staff_id'] || ''), row]));
    const attendanceByStaff = this.attendanceRows().reduce((map, row) => {
      const staffId = String(row['staffId'] || row['staff_id'] || '');
      if (!staffId) return map;
      const rows = map.get(staffId) || [];
      rows.push(row);
      map.set(staffId, rows);
      return map;
    }, new Map<string, ApiRecord[]>());
    const rows: PenaltyPreviewRow[] = [];
    for (const staff of this.staffRows()) {
      const metrics = this.penaltyMetrics(previewByStaff.get(staff.id), attendanceByStaff.get(staff.id) || []);
      for (const rule of rules) {
        const breakCount = this.ruleBreakCount(rule, metrics);
        if (!breakCount) continue;
        rows.push({
          staffId: staff.id,
          staffName: this.staffName(staff),
          ruleName: rule.ruleLabel || rule.name,
          ruleType: rule.ruleType || 'manual',
          breakCount,
          amount: Math.round((rule.amount || 0) * breakCount),
          evidence: this.ruleEvidence(rule.ruleType || 'manual', metrics, rule.ruleLabel)
        });
      }
    }
    return rows.sort((a, b) => b.amount - a.amount || a.staffName.localeCompare(b.staffName));
  }

  penaltyMetrics(preview: ApiRecord | undefined, logs: ApiRecord[]): Record<string, number> {
    const attendance = logs.reduce((summary, row) => {
      const status = String(row['status'] || row['attendanceStatus'] || row['attendance_status'] || '').toLowerCase();
      summary.late += status.includes('late') ? 1 : 0;
      summary.half += status.includes('half') ? 1 : 0;
      summary.noClockOut += (row['clockInAt'] || row['clock_in_at']) && !(row['clockOutAt'] || row['clock_out_at']) ? 1 : 0;
      summary.workedHours += this.attendanceDurationHours(row);
      return summary;
    }, { late: 0, half: 0, noClockOut: 0, workedHours: 0 });
    const workedHours = Math.max(this.toNumber(preview?.['workedHours']), Math.round(attendance.workedHours * 100) / 100);
    const requiredHours = this.toNumber(preview?.['requiredHours']);
    return {
      late_count: Math.max(this.toNumber(preview?.['lateCount']), attendance.late),
      absent_day: this.toNumber(preview?.['absentDays']),
      half_day: Math.max(this.toNumber(preview?.['halfDays']), attendance.half),
      short_hours: Math.max(0, requiredHours - workedHours),
      no_clock_out: attendance.noClockOut,
      weekend_penalty: this.toNumber(preview?.['weekendPenaltyDays']),
      sandwich_penalty: this.toNumber(preview?.['sandwichPenaltyDays']),
      unpaid_week_off: this.toNumber(preview?.['unpaidWeekOffDays'])
    };
  }

  ruleBreakCount(rule: StaffOsFinePenalty, metrics: Record<string, number>): number {
    const metric = metrics[rule.ruleType || 'manual'] || 0;
    const trigger = Math.max(1, this.toNumber(rule.triggerCount || 1));
    if (metric < trigger) return 0;
    return rule.applyMode === 'fixed' ? 1 : Math.max(1, Math.floor(metric / trigger));
  }

  ruleEvidence(ruleType: FinePenaltyRuleType, metrics: Record<string, number>, customLabel = ''): string {
    const value = metrics[ruleType] || 0;
    const labels: Record<FinePenaltyRuleType, string> = {
      manual: 'Manual',
      late_count: 'Late',
      absent_day: 'Absent',
      half_day: 'Half day',
      short_hours: 'Short hours',
      no_clock_out: 'No clock out',
      weekend_penalty: 'Weekend penalty',
      sandwich_penalty: 'Sandwich penalty',
      unpaid_week_off: 'Unpaid week off'
    };
    return `${customLabel || labels[ruleType]} ${Math.round(value * 100) / 100}`;
  }

  staffName(staff: StaffOsStaff): string {
    return staff.fullName || `${staff.firstName || ''} ${staff.lastName || ''}`.trim() || staff.id;
  }

  attendanceDurationHours(row: ApiRecord): number {
    const clockIn = this.parseAttendanceTime(row['clockInAt'] || row['clock_in_at']);
    const clockOut = this.parseAttendanceTime(row['clockOutAt'] || row['clock_out_at']);
    if (!clockIn || !clockOut || clockOut <= clockIn) return 0;
    return (clockOut - clockIn) / 36e5;
  }

  parseAttendanceTime(value: unknown): number {
    if (!value) return 0;
    const parsed = new Date(String(value)).getTime();
    return Number.isFinite(parsed) ? parsed : 0;
  }

  periodStart(): string { return `${this.period()}-01`; }
  periodEnd(): string {
    const [year, month] = this.period().split('-').map(Number);
    return new Date(year, month, 0).toISOString().slice(0, 10);
  }

  private reselect(): void {
    const selected = this.selectedId();
    if (!selected) return;
    const row = this.rows().find((item) => item.id === selected);
    if (row) this.select(row);
  }

  private apiError(error: unknown, fallback: string): string {
    const value = error as { error?: { error?: string; message?: string }; message?: string };
    return value?.error?.error || value?.error?.message || value?.message || fallback;
  }
}

@Component({
  standalone: true,
  imports: [StaffPayrollDefinitionComponent],
  template: `<app-staff-payroll-definition kind="fine" />`
})
export class FinesPenaltyPage {}

@Component({
  standalone: true,
  imports: [StaffPayrollDefinitionComponent],
  template: `<app-staff-payroll-definition kind="allowance" />`
})
export class AllowanceDeductionPage {}

@Component({
  standalone: true,
  imports: [CommonModule, RouterLink],
  template: `
    <section class="payroll-page">
      <header class="topbar">
        <div>
          <h1>Payroll Salary Structure</h1>
        </div>
        <div class="topbar-actions">
          <a class="refresh" routerLink="/staff-os/employee-masters">Masters</a>
          <button type="button" class="refresh" (click)="load()">Refresh</button>
        </div>
      </header>

      <div *ngIf="loading()" class="state">Loading payroll salary structure...</div>
      <div *ngIf="error()" class="state error">{{ error() }}</div>

      <section class="structure-shell">
        <aside class="side">
          <label>
            <span>Branch</span>
            <select [value]="branchId()" (change)="selectBranch($any($event.target).value)">
              <option value="">All branches</option>
              <option *ngFor="let branch of branches()" [value]="branch.id">{{ branch.name || branch.id }}</option>
            </select>
          </label>
          <div class="summary">
            <article><span>PF</span><strong>{{ pf().applicable ? 'On' : 'Off' }}</strong></article>
            <article><span>PT</span><strong>{{ pt().applicable ? 'On' : 'Off' }}</strong></article>
            <article><span>ESIC</span><strong>{{ esic().applicable ? 'On' : 'Off' }}</strong></article>
            <article><span>TDS</span><strong>{{ tds().applicable ? 'On' : 'Off' }}</strong></article>
          </div>
        </aside>

        <main class="structure">
          <section class="block">
            <label class="check"><input type="checkbox" [checked]="pf().applicable" (change)="patch('pf', 'applicable', $any($event.target).checked)" /> Provident Fund</label>
            <div class="check-row">
              <label class="check"><input type="checkbox" [checked]="pf().includeBasicSalary" (change)="patch('pf', 'includeBasicSalary', $any($event.target).checked)" /> Basic Salary</label>
              <label class="check"><input type="checkbox" [checked]="pf().includeIncentives" (change)="patch('pf', 'includeIncentives', $any($event.target).checked)" /> Incentives</label>
              <label class="check"><input type="checkbox" [checked]="pf().includeAbsentDays" (change)="patch('pf', 'includeAbsentDays', $any($event.target).checked)" /> Absent Days</label>
            </div>
            <div class="field-grid">
              <label><span>PF No.</span><input [value]="pf().pfNo || ''" (input)="patch('pf', 'pfNo', $any($event.target).value)" /></label>
              <label><span>Employee Share %</span><input type="number" [value]="pf().employeeSharePercent || 0" (input)="patch('pf', 'employeeSharePercent', toNumber($any($event.target).value))" /></label>
              <label><span>Max Salary PF</span><input type="number" [value]="pf().maxSalaryPf || 0" (input)="patch('pf', 'maxSalaryPf', toNumber($any($event.target).value))" /></label>
              <label><span>EPS Employer %</span><input type="number" [value]="pf().epsContributionEmployerPercent || 0" (input)="patch('pf', 'epsContributionEmployerPercent', toNumber($any($event.target).value))" /></label>
              <label><span>Max Salary EPS</span><input type="number" [value]="pf().maxSalaryEps || 0" (input)="patch('pf', 'maxSalaryEps', toNumber($any($event.target).value))" /></label>
              <label><span>PF Employer %</span><input type="number" [value]="pf().pfContributionEmployerPercent || 0" (input)="patch('pf', 'pfContributionEmployerPercent', toNumber($any($event.target).value))" /></label>
              <label><span>DLI Employer %</span><input type="number" [value]="pf().dliEmployerPercent || 0" (input)="patch('pf', 'dliEmployerPercent', toNumber($any($event.target).value))" /></label>
              <label><span>Max Salary DLI</span><input type="number" [value]="pf().maxSalaryDli || 0" (input)="patch('pf', 'maxSalaryDli', toNumber($any($event.target).value))" /></label>
              <label><span>PF Admin Employer %</span><input type="number" [value]="pf().pfAdminEmployerPercent || 0" (input)="patch('pf', 'pfAdminEmployerPercent', toNumber($any($event.target).value))" /></label>
              <label><span>DLI Admin Employer %</span><input type="number" [value]="pf().dliAdminEmployerPercent || 0" (input)="patch('pf', 'dliAdminEmployerPercent', toNumber($any($event.target).value))" /></label>
            </div>
          </section>

          <section class="block">
            <label class="check"><input type="checkbox" [checked]="pt().applicable" (change)="patch('pt', 'applicable', $any($event.target).checked)" /> Professional Tax</label>
            <div class="check-row">
              <label class="check"><input type="checkbox" [checked]="pt().includeBasicSalary" (change)="patch('pt', 'includeBasicSalary', $any($event.target).checked)" /> Basic Salary</label>
              <label class="check"><input type="checkbox" [checked]="pt().includeIncentives" (change)="patch('pt', 'includeIncentives', $any($event.target).checked)" /> Incentives</label>
              <label class="check"><input type="checkbox" [checked]="pt().includeAbsentDays" (change)="patch('pt', 'includeAbsentDays', $any($event.target).checked)" /> Absent Days</label>
            </div>
            <div class="field-grid">
              <label><span>PT No.</span><input [value]="pt().ptNo || ''" (input)="patch('pt', 'ptNo', $any($event.target).value)" /></label>
              <label><span>M. V. A. T. R. C. No.</span><input [value]="pt().mvatrcNo || ''" (input)="patch('pt', 'mvatrcNo', $any($event.target).value)" /></label>
            </div>
          </section>

          <section class="block">
            <label class="check"><input type="checkbox" [checked]="esic().applicable" (change)="patch('esic', 'applicable', $any($event.target).checked)" /> ESIC</label>
            <div class="check-row">
              <label class="check"><input type="checkbox" [checked]="esic().includeBasicSalary" (change)="patch('esic', 'includeBasicSalary', $any($event.target).checked)" /> Basic Salary</label>
              <label class="check"><input type="checkbox" [checked]="esic().includeIncentives" (change)="patch('esic', 'includeIncentives', $any($event.target).checked)" /> Incentives</label>
              <label class="check"><input type="checkbox" [checked]="esic().includeAbsentDays" (change)="patch('esic', 'includeAbsentDays', $any($event.target).checked)" /> Absent Days</label>
            </div>
            <div class="field-grid">
              <label><span>ESIC No.</span><input [value]="esic().esicNo || ''" (input)="patch('esic', 'esicNo', $any($event.target).value)" /></label>
              <label><span>Employee Share %</span><input type="number" [value]="esic().employeeSharePercent || 0" (input)="patch('esic', 'employeeSharePercent', toNumber($any($event.target).value))" /></label>
              <label><span>Employer Share %</span><input type="number" [value]="esic().employerSharePercent || 0" (input)="patch('esic', 'employerSharePercent', toNumber($any($event.target).value))" /></label>
              <label><span>Max Salary for ESIC</span><input type="number" [value]="esic().maxSalaryEsic || 0" (input)="patch('esic', 'maxSalaryEsic', toNumber($any($event.target).value))" /></label>
            </div>
          </section>

          <section class="block">
            <label class="check"><input type="checkbox" [checked]="tds().applicable" (change)="patch('tds', 'applicable', $any($event.target).checked)" /> TDS Applicable</label>
            <label><span>Employee TDS JSON</span><textarea rows="4" [value]="tdsJson()" (input)="setTdsRules($any($event.target).value)"></textarea></label>
          </section>

          <div class="state error" *ngIf="saveError()">{{ saveError() }}</div>
          <footer class="actions">
            <button type="button" class="refresh" (click)="load()">Cancel</button>
            <button type="button" class="primary" [disabled]="saving()" (click)="save()">{{ saving() ? 'Saving...' : 'Save' }}</button>
          </footer>
        </main>
      </section>
    </section>
  `,
  styles: [`
    .payroll-page { color: #10201a; display: grid; gap: 18px; padding: 24px; }
    .topbar, .topbar-actions, .actions { align-items: flex-start; display: flex; gap: 12px; justify-content: space-between; }
    .topbar-actions, .actions { align-items: center; justify-content: flex-end; flex-wrap: wrap; }
    .eyebrow { color: #547066; font-size: 12px; font-weight: 850; letter-spacing: .08em; margin: 0 0 5px; text-transform: uppercase; }
    h1 { font-size: 30px; letter-spacing: 0; margin: 0; }
    .structure-shell { display: grid; grid-template-columns: 260px 1fr; gap: 16px; align-items: start; }
    .side, .structure, .block, .state { background: #fff; border: 1px solid #E7DDD6; border-radius: 8px; }
    .side, .structure, .block, .state { padding: 16px; }
    .structure { display: grid; gap: 14px; }
    .summary { display: grid; gap: 10px; margin-top: 14px; }
    .summary article { background: #FAF8F6; border: 1px solid #edf2ef; border-radius: 8px; padding: 12px; }
    .summary span { color: #60766d; font-size: 12px; font-weight: 850; text-transform: uppercase; }
    .summary strong { display: block; font-size: 20px; margin-top: 4px; }
    .block { display: grid; gap: 12px; }
    .check-row, .field-grid { display: grid; gap: 10px; grid-template-columns: repeat(3, minmax(0, 1fr)); }
    .field-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    label { color: #34483f; display: grid; font-size: 13px; font-weight: 850; gap: 6px; }
    label.check { align-items: center; display: inline-flex; }
    input, select, textarea { border: 1px solid #E7DDD6; border-radius: 8px; color: #10201a; font: inherit; padding: 10px 11px; width: 100%; }
    input[type='checkbox'] { height: 18px; padding: 0; width: 18px; }
    .refresh, .primary { border: 1px solid #E7DDD6; border-radius: 6px; cursor: pointer; font-weight: 850; min-height: 38px; padding: 9px 12px; text-decoration: none; }
    .refresh { background: #fff; color: #34483f; }
    .primary { background: #4B1238; border-color: #4B1238; color: #fff; }
    .state { color: #61746c; }
    .error { color: #a52828; border-color: #e7b1b1; }
    .actions { border-top: 1px solid #edf2ef; padding-top: 12px; }
    @media (max-width: 980px) { .structure-shell, .check-row, .field-grid { grid-template-columns: 1fr; } }
    @media (max-width: 640px) { .payroll-page { padding: 16px; } .topbar { display: grid; } }
  `]
})
export class PayrollSalaryStructurePage implements OnInit {
  readonly branches = signal<StaffOsBranch[]>([]);
  readonly current = signal<StaffOsPayrollSalaryStructure | null>(null);
  readonly branchId = signal('');
  readonly pf = signal<Record<string, any>>({});
  readonly pt = signal<Record<string, any>>({});
  readonly esic = signal<Record<string, any>>({});
  readonly tds = signal<Record<string, any>>({});
  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly error = signal('');
  readonly saveError = signal('');

  constructor(private readonly api: StaffOsApi) {}

  ngOnInit(): void {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.error.set('');
    forkJoin({
      branches: this.api.branches({ limit: 1000 }),
      structures: this.api.payrollStructures({ branchId: this.branchId(), includeArchived: 'true', limit: 10 })
    }).pipe(finalize(() => this.loading.set(false))).subscribe({
      next: ({ branches, structures }) => {
        this.branches.set(branches);
        const selected = structures.find((item) => item.branchId === this.branchId()) || structures[0] || null;
        this.current.set(selected);
        this.pf.set({ ...(selected?.providentFund || {}) });
        this.pt.set({ ...(selected?.professionalTax || {}) });
        this.esic.set({ ...(selected?.esic || {}) });
        this.tds.set({ ...(selected?.tds || {}) });
      },
      error: (error: unknown) => this.error.set(this.apiError(error, 'Unable to load payroll structure'))
    });
  }

  selectBranch(branchId: string): void {
    this.branchId.set(branchId);
    this.load();
  }

  patch(section: 'pf' | 'pt' | 'esic' | 'tds', key: string, value: unknown): void {
    const target = section === 'pf' ? this.pf : section === 'pt' ? this.pt : section === 'esic' ? this.esic : this.tds;
    target.update((current) => ({ ...current, [key]: value }));
  }

  toNumber(value: unknown): number {
    const parsed = Number(value || 0);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  tdsJson(): string {
    return JSON.stringify(this.tds().employeeRules || [], null, 2);
  }

  setTdsRules(value: string): void {
    try {
      const parsed = JSON.parse(value || '[]');
      this.patch('tds', 'employeeRules', Array.isArray(parsed) ? parsed : []);
      this.saveError.set('');
    } catch {
      this.saveError.set('Employee TDS JSON is invalid.');
    }
  }

  save(): void {
    if (this.saveError()) return;
    this.saving.set(true);
    const current = this.current();
    const payload = {
      branchId: this.branchId(),
      name: 'Payroll Salary Structure',
      providentFund: this.pf(),
      professionalTax: this.pt(),
      esic: this.esic(),
      tds: this.tds(),
      status: 'active',
      hide: false,
      ...(current ? { version: current.version } : {})
    };
    const request = current ? this.api.updatePayrollStructure(current.id, payload) : this.api.savePayrollStructure(payload);
    request.pipe(finalize(() => this.saving.set(false))).subscribe({
      next: (saved) => {
        this.current.set(saved);
        this.load();
      },
      error: (error: unknown) => this.saveError.set(this.apiError(error, 'Unable to save payroll structure'))
    });
  }

  private apiError(error: unknown, fallback: string): string {
    const value = error as { error?: { error?: string; message?: string }; message?: string };
    return value?.error?.error || value?.error?.message || value?.message || fallback;
  }
}
