import { CommonModule } from '@angular/common';
import { Component, Input, OnChanges, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ApiService } from '../../../core/api.service';

type HeatmapCell = {
  label: string;
  value: number;
  raw: unknown;
};

@Component({
  selector: 'app-staff-os-heatmap',
  standalone: true,
  imports: [CommonModule, FormsModule],
  template: `
    <section class="heatmap-page">
      <header class="header">
        <div>
          <h1>{{ title }}</h1>
        </div>
        <button type="button" class="button" (click)="load()">Refresh</button>
      </header>

      <form class="filters" (ngSubmit)="load()">
        <label>
          <span>Branch</span>
          <input name="branchId" [(ngModel)]="branchId" placeholder="All allowed branches" />
        </label>
        <label>
          <span>From</span>
          <input name="from" [(ngModel)]="from" type="date" />
        </label>
        <label>
          <span>To</span>
          <input name="to" [(ngModel)]="to" type="date" />
        </label>
        <label>
          <span>Staff</span>
          <input name="staffId" [(ngModel)]="staffId" placeholder="Optional staff ID" />
        </label>
        <label>
          <span>Metric</span>
          <select name="metric" [(ngModel)]="metricKey">
            <option value="value">Value</option>
            <option value="coverageScore">Coverage</option>
            <option value="utilizationPct">Utilization</option>
            <option value="netAmount">Payroll cost</option>
            <option value="days">Days</option>
          </select>
        </label>
        <button type="submit" class="button primary">Apply</button>
      </form>

      <div class="state" *ngIf="loading()">Loading heatmap data...</div>
      <div class="state error" *ngIf="error()">{{ error() }}</div>

      <div class="layout" *ngIf="!loading() && !error()">
        <div class="grid" role="grid" [attr.aria-label]="title">
          <button
            *ngFor="let cell of cells(); let index = index"
            type="button"
            class="cell"
            [style.opacity]="opacity(cell.value)"
            (click)="select(cell)"
            [attr.aria-label]="cell.label + ': ' + cell.value"
          >
            <span>{{ index + 1 }}</span>
            <strong>{{ cell.value | number:'1.0-0' }}</strong>
          </button>
        </div>

        <aside class="drawer" *ngIf="selected() as cell">
          <h2>{{ cell.label }}</h2>
          <strong>{{ cell.value | number:'1.0-2' }}</strong>
          <pre>{{ cell.raw | json }}</pre>
        </aside>
      </div>

      <div class="state" *ngIf="!loading() && !error() && !cells().length">No heatmap data for this filter.</div>
    </section>
  `,
  styles: [`
    .heatmap-page { display: grid; gap: 18px; padding: 24px; color: #10201a; }
    .header { display: flex; align-items: center; justify-content: space-between; gap: 16px; }
    .eyebrow { margin: 0 0 4px; color: #62776f; font-size: 12px; text-transform: uppercase; letter-spacing: .08em; }
    h1, h2 { margin: 0; letter-spacing: 0; }
    h1 { font-size: 28px; }
    h2 { font-size: 18px; }
    .filters { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 10px; align-items: end; }
    label { display: grid; gap: 6px; color: #52685f; font-size: 12px; }
    input, select { border: 1px solid #cbd8d2; border-radius: 6px; padding: 9px 10px; min-width: 0; }
    .button { border: 1px solid #cbd8d2; background: #fff; border-radius: 6px; padding: 9px 12px; cursor: pointer; }
    .primary { background: #183d2d; color: #fff; border-color: #183d2d; }
    .state, .drawer { border: 1px solid #d9e5de; border-radius: 8px; background: #fff; padding: 14px; }
    .error { color: #a52828; border-color: #e7b1b1; }
    .layout { display: grid; grid-template-columns: minmax(0, 1fr) 320px; gap: 16px; align-items: start; }
    .grid { display: grid; grid-template-columns: repeat(14, minmax(34px, 1fr)); gap: 6px; }
    .cell { aspect-ratio: 1; border: 0; border-radius: 5px; background: #24865d; color: #fff; display: grid; place-items: center; gap: 2px; cursor: pointer; }
    .cell span { font-size: 10px; }
    .cell strong { font-size: 13px; }
    .drawer { display: grid; gap: 10px; }
    pre { margin: 0; white-space: pre-wrap; word-break: break-word; max-height: 360px; overflow: auto; color: #3b5148; }
    @media (max-width: 960px) { .filters { grid-template-columns: repeat(3, 1fr); } .layout { grid-template-columns: 1fr; } }
    @media (max-width: 640px) { .heatmap-page { padding: 16px; } .header, .filters { grid-template-columns: 1fr; } .grid { grid-template-columns: repeat(7, minmax(30px, 1fr)); } }
  `]
})
export class StaffOsHeatmapComponent implements OnChanges {
  @Input({ required: true }) title = 'Heatmap';
  @Input({ required: true }) endpoint = '';
  @Input() metricKey = 'value';

  branchId = '';
  staffId = '';
  from = '';
  to = '';

  readonly loading = signal(false);
  readonly error = signal('');
  readonly cells = signal<HeatmapCell[]>([]);
  readonly selected = signal<HeatmapCell | null>(null);

  constructor(private readonly api: ApiService) {}

  ngOnChanges(): void {
    this.load();
  }

  load(): void {
    if (!this.endpoint) return;
    this.loading.set(true);
    this.error.set('');
    this.api.list<unknown>(this.endpoint, {
      branchId: this.branchId,
      staffId: this.staffId,
      from: this.from,
      to: this.to
    }).subscribe({
      next: (response) => {
        this.cells.set(this.normalize(response));
        this.selected.set(null);
        this.loading.set(false);
      },
      error: (error: Error) => {
        this.error.set(error.message || 'Unable to load heatmap');
        this.loading.set(false);
      }
    });
  }

  select(cell: HeatmapCell): void {
    this.selected.set(cell);
  }

  opacity(value: number): number {
    const max = Math.max(...this.cells().map((cell) => cell.value), 1);
    return Math.max(0.2, Math.min(1, value / max));
  }

  private normalize(response: unknown): HeatmapCell[] {
    const rows = Array.isArray(response)
      ? response
      : Array.isArray((response as { rows?: unknown[] })?.rows)
        ? (response as { rows: unknown[] }).rows
        : response && typeof response === 'object'
          ? [response]
          : [];
    return rows.map((row, index) => {
      const record = row as Record<string, unknown>;
      const explicit = Number(record[this.metricKey]);
      const derivedDays = this.daysBetween(record['startDate'] || record['start_date'], record['endDate'] || record['end_date']);
      const fallback = Number(record['value'] ?? record['coverageScore'] ?? record['utilizationPct'] ?? record['netAmount'] ?? record['days'] ?? derivedDays ?? 0);
      return {
        label: String(record['businessDate'] || record['startDate'] || record['start_date'] || record['staffId'] || record['branchId'] || `Cell ${index + 1}`),
        value: Number.isFinite(explicit) ? explicit : Number.isFinite(fallback) ? fallback : 0,
        raw: row
      };
    });
  }

  private daysBetween(start: unknown, end: unknown): number | undefined {
    if (!start) return undefined;
    const startDate = new Date(String(start));
    const endDate = new Date(String(end || start));
    if (Number.isNaN(startDate.getTime()) || Number.isNaN(endDate.getTime())) return undefined;
    return Math.max(1, Math.round((endDate.getTime() - startDate.getTime()) / 86_400_000) + 1);
  }
}
