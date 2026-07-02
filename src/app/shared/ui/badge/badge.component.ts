import { CommonModule } from '@angular/common';
import { Component, Input } from '@angular/core';

@Component({
  selector: 'aura-legacy-badge',
  standalone: true,
  imports: [CommonModule],
  template: `<span class="aura-badge" [class]="tone"><ng-content></ng-content>{{ label }}</span>`,
  styles: [`
    .aura-badge {
      display: inline-flex;
      align-items: center;
      min-height: 22px;
      border: 1px solid var(--line);
      border-radius: 999px;
      padding: 0 8px;
      background: var(--surface-2);
      color: var(--muted);
      font-size: var(--aura-fs-xs, 11px);
      font-weight: 800;
      line-height: 1;
      text-transform: uppercase;
      white-space: nowrap;
    }
    .success { background: #ecfdf5; border-color: #a7f3d0; color: #047857; }
    .warning { background: #fffbeb; border-color: #fde68a; color: #92400e; }
    .danger { background: #fef2f2; border-color: #fecaca; color: #b91c1c; }
    .info { background: #eff6ff; border-color: #bfdbfe; color: #1d4ed8; }
  `]
})
export class LegacyAuraBadgeComponent {
  @Input() label = '';
  @Input() tone: 'neutral' | 'success' | 'warning' | 'danger' | 'info' = 'neutral';
}
