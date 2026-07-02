import { CommonModule } from '@angular/common';
import { Component, Input } from '@angular/core';

@Component({
  selector: 'aura-legacy-skeleton',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="aura-skeleton" [class.table]="variant === 'table'">
      <div class="aura-skeleton-row" *ngFor="let row of rowArray()">
        <span *ngFor="let col of colArray()"></span>
      </div>
    </div>
  `,
  styles: [`
    .aura-skeleton {
      display: grid;
      gap: 8px;
      width: 100%;
    }
    .aura-skeleton-row {
      display: grid;
      grid-template-columns: repeat(var(--aura-skeleton-cols, 4), minmax(0, 1fr));
      gap: 12px;
      min-height: var(--aura-h-table-row, 40px);
      align-items: center;
    }
    span {
      height: 12px;
      border-radius: 999px;
      background: linear-gradient(90deg, #eef2f7, #f8fafc, #eef2f7);
      background-size: 200% 100%;
      animation: pulse 1.2s ease-in-out infinite;
    }
    .table .aura-skeleton-row {
      border-bottom: 1px solid var(--line);
    }
    @keyframes pulse {
      0% { background-position: 200% 0; }
      100% { background-position: -200% 0; }
    }
  `],
  host: {
    '[style.--aura-skeleton-cols]': 'columns'
  }
})
export class LegacyAuraSkeletonComponent {
  @Input() rows = 6;
  @Input() columns = 4;
  @Input() variant: 'plain' | 'table' = 'plain';

  rowArray(): number[] {
    return Array.from({ length: Math.max(1, Number(this.rows || 1)) }, (_, index) => index);
  }

  colArray(): number[] {
    return Array.from({ length: Math.max(1, Number(this.columns || 1)) }, (_, index) => index);
  }
}
