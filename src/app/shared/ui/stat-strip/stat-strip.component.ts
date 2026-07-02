import { CommonModule, NgClass } from '@angular/common';
import { Component, Input } from '@angular/core';

export type LegacyAuraStat = {
  label: string;
  value: string | number;
  hint?: string;
  trend?: string;
  tone?: 'neutral' | 'success' | 'warning' | 'danger' | 'info';
};

@Component({
  selector: 'aura-legacy-stat-strip',
  standalone: true,
  imports: [CommonModule, NgClass],
  template: `
    <section class="aura-stat-strip" [attr.aria-label]="label">
      <article class="aura-stat" *ngFor="let stat of stats" [ngClass]="stat.tone || 'neutral'">
        <span>{{ stat.label }}</span>
        <strong>{{ stat.value }}</strong>
        <small *ngIf="stat.trend || stat.hint">
          <b *ngIf="stat.trend">{{ stat.trend }}</b>
          {{ stat.hint }}
        </small>
      </article>
    </section>
  `,
  styles: [`
    .aura-stat-strip {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
      gap: 0;
      min-height: 72px;
      overflow: hidden;
      border: 1px solid var(--line);
      border-radius: var(--aura-radius-lg, 8px);
      background: var(--surface);
      box-shadow: var(--shadow-xs);
    }
    .aura-stat {
      min-width: 0;
      padding: 10px 14px;
      border-right: 1px solid var(--line);
    }
    .aura-stat:last-child { border-right: 0; }
    .aura-stat span {
      display: block;
      color: var(--muted);
      font-size: var(--aura-fs-xs, 11px);
      font-weight: 800;
      letter-spacing: 0.06em;
      text-transform: uppercase;
    }
    .aura-stat strong {
      display: block;
      margin-top: 4px;
      color: var(--ink);
      font-size: var(--aura-fs-xl, 22px);
      line-height: 1.1;
    }
    .aura-stat small {
      display: block;
      margin-top: 4px;
      color: var(--muted);
      font-size: var(--aura-fs-xs, 11px);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .aura-stat b { margin-right: 4px; }
    .success b { color: var(--success-500, #10b981); }
    .warning b { color: var(--warning-500, #f59e0b); }
    .danger b { color: var(--danger-500, #ef4444); }
    .info b { color: var(--info-500, #3b82f6); }
    @media (max-width: 760px) {
      .aura-stat-strip { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .aura-stat { border-bottom: 1px solid var(--line); }
    }
  `]
})
export class LegacyAuraStatStripComponent {
  @Input() label = 'Key metrics';
  @Input() stats: LegacyAuraStat[] = [];
}
