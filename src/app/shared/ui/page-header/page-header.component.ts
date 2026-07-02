import { CommonModule } from '@angular/common';
import { Component, Input } from '@angular/core';

@Component({
  selector: 'aura-legacy-page-header',
  standalone: true,
  imports: [CommonModule],
  template: `
    <header class="aura-page-header">
      <div class="aura-page-title">
        <span class="aura-breadcrumb" *ngIf="breadcrumb">{{ breadcrumb }}</span>
        <h1>{{ title }}</h1>
      </div>
      <div class="aura-page-actions">
        <ng-content select="[header-actions]"></ng-content>
      </div>
    </header>
  `,
  styles: [`
    .aura-page-header {
      min-height: var(--aura-page-header-h, 56px);
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--aura-space-4, 16px);
      padding: 0;
      border-bottom: 1px solid var(--line);
    }
    .aura-page-title { min-width: 0; }
    .aura-breadcrumb {
      display: block;
      color: var(--muted);
      font-size: var(--aura-fs-xs, 11px);
      font-weight: 800;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }
    h1 {
      margin: 2px 0 0;
      color: var(--ink);
      font-size: var(--aura-fs-lg, 18px);
      line-height: 1.25;
    }
    p {
      margin: 2px 0 0;
      color: var(--muted);
      font-size: var(--aura-fs-sm, 13px);
      line-height: 1.35;
    }
    .aura-page-actions {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      justify-content: flex-end;
      gap: var(--aura-space-2, 8px);
    }
    @media (max-width: 760px) {
      .aura-page-header {
        align-items: stretch;
        flex-direction: column;
        padding-bottom: var(--aura-space-3, 12px);
      }
      .aura-page-actions { justify-content: stretch; }
    }
  `]
})
export class LegacyAuraPageHeaderComponent {
  @Input() breadcrumb = '';
  @Input() title = '';
  @Input() subtitle = '';
}
