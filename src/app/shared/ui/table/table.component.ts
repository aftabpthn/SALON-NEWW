import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';
import { ApiRecord } from '../../../core/api.service';
import { LegacyAuraEmptyComponent } from '../empty/empty.component';

export type LegacyAuraTableColumn = {
  key: string;
  label: string;
  type?: 'text' | 'currency' | 'badge' | 'number' | 'date';
};

@Component({
  selector: 'aura-legacy-table',
  standalone: true,
  imports: [CommonModule, LegacyAuraEmptyComponent],
  template: `
    <div class="aura-table-wrap">
      <table>
        <thead>
          <tr>
            <th class="select-col" *ngIf="selectable"><input type="checkbox" [checked]="allSelected()" (change)="toggleAll($any($event.target).checked)" /></th>
            <th *ngFor="let col of columns" (click)="sortBy(col.key)">
              {{ col.label }}
              <span *ngIf="sortKey === col.key">{{ sortDir === 'asc' ? '↑' : '↓' }}</span>
            </th>
            <th *ngIf="actions">Actions</th>
          </tr>
        </thead>
        <tbody>
          <tr *ngFor="let row of sortedRows()" (click)="rowClick.emit(row)">
            <td class="select-col" *ngIf="selectable" (click)="$event.stopPropagation()">
              <input type="checkbox" [checked]="selectedIds.has(rowId(row))" (change)="toggleRow(row, $any($event.target).checked)" />
            </td>
            <td *ngFor="let col of columns">
              <span class="pill" *ngIf="col.type === 'badge'; else plainValue">{{ row[col.key] || '—' }}</span>
              <ng-template #plainValue>{{ valueFor(row, col) }}</ng-template>
            </td>
            <td class="actions" *ngIf="actions">
              <button type="button" class="ghost-button mini" (click)="action.emit({ action: 'view', row }); $event.stopPropagation()">View</button>
              <button type="button" class="ghost-button mini" (click)="action.emit({ action: 'edit', row }); $event.stopPropagation()">Edit</button>
            </td>
          </tr>
        </tbody>
      </table>
      <aura-legacy-empty *ngIf="!rows.length" title="No records" message="Create a record or adjust filters."></aura-legacy-empty>
    </div>
  `,
  styles: [`
    .aura-table-wrap {
      overflow: auto;
      border: 1px solid var(--line);
      border-radius: var(--aura-radius-lg, 8px);
      background: var(--surface);
    }
    table {
      width: 100%;
      border-collapse: collapse;
      min-width: 720px;
    }
    th {
      position: sticky;
      top: 0;
      z-index: 1;
      height: var(--aura-h-table-row, 40px);
      padding: 0 12px;
      background: var(--surface-2);
      color: var(--muted);
      font-size: var(--aura-fs-xs, 11px);
      font-weight: 900;
      letter-spacing: 0.06em;
      text-align: left;
      text-transform: uppercase;
      cursor: pointer;
    }
    td {
      height: var(--aura-h-table-row, 40px);
      padding: 0 12px;
      border-top: 1px solid var(--line);
      color: var(--ink);
      font-size: var(--aura-fs-sm, 13px);
      white-space: nowrap;
    }
    tr:hover td { background: color-mix(in srgb, var(--surface-2) 55%, transparent); }
    .select-col { width: 40px; }
    .actions {
      display: flex;
      align-items: center;
      gap: 6px;
      justify-content: flex-end;
    }
    .pill {
      display: inline-flex;
      align-items: center;
      min-height: 22px;
      border-radius: 999px;
      padding: 0 8px;
      background: var(--surface-2);
      font-size: var(--aura-fs-xs, 11px);
      font-weight: 900;
      text-transform: uppercase;
    }
  `]
})
export class LegacyAuraTableComponent {
  @Input() columns: LegacyAuraTableColumn[] = [];
  @Input() rows: ApiRecord[] = [];
  @Input() selectable = false;
  @Input() actions = true;
  @Output() rowClick = new EventEmitter<ApiRecord>();
  @Output() selectedChange = new EventEmitter<string[]>();
  @Output() action = new EventEmitter<{ action: string; row: ApiRecord }>();

  selectedIds = new Set<string>();
  sortKey = '';
  sortDir: 'asc' | 'desc' = 'asc';

  sortBy(key: string): void {
    if (this.sortKey === key) {
      this.sortDir = this.sortDir === 'asc' ? 'desc' : 'asc';
      return;
    }
    this.sortKey = key;
    this.sortDir = 'asc';
  }

  sortedRows(): ApiRecord[] {
    if (!this.sortKey) return this.rows;
    const direction = this.sortDir === 'asc' ? 1 : -1;
    return [...this.rows].sort((a, b) => String(a[this.sortKey] ?? '').localeCompare(String(b[this.sortKey] ?? '')) * direction);
  }

  valueFor(row: ApiRecord, col: LegacyAuraTableColumn): string | number {
    const value = row[col.key];
    if (value === null || value === undefined || value === '') return '—';
    if (col.type === 'currency') return `₹${Number(value || 0).toLocaleString('en-IN')}`;
    if (col.type === 'date') return new Date(String(value)).toLocaleDateString('en-IN');
    return typeof value === 'object' ? JSON.stringify(value) : value;
  }

  allSelected(): boolean {
    return !!this.rows.length && this.rows.every((row) => this.selectedIds.has(this.rowId(row)));
  }

  toggleAll(checked: boolean): void {
    this.selectedIds = checked ? new Set(this.rows.map((row) => this.rowId(row)).filter(Boolean)) : new Set<string>();
    this.selectedChange.emit([...this.selectedIds]);
  }

  toggleRow(row: ApiRecord, checked: boolean): void {
    const id = this.rowId(row);
    if (!id) return;
    if (checked) this.selectedIds.add(id);
    else this.selectedIds.delete(id);
    this.selectedChange.emit([...this.selectedIds]);
  }

  rowId(row: ApiRecord): string {
    return String(row.id || '');
  }
}
