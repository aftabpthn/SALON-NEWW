import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';

@Component({
  selector: 'aura-legacy-empty',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="aura-empty">
      <div class="aura-empty-icon" aria-hidden="true">{{ icon }}</div>
      <strong>{{ title }}</strong>
      <p>{{ message }}</p>
      <button class="primary-button" type="button" *ngIf="actionLabel" (click)="action.emit()">{{ actionLabel }}</button>
    </div>
  `,
  styles: [`
    .aura-empty {
      display: grid;
      place-items: center;
      gap: 8px;
      min-height: 180px;
      padding: 24px;
      text-align: center;
      border: 1px dashed var(--line);
      border-radius: var(--aura-radius-lg, 8px);
      background: color-mix(in srgb, var(--surface-2) 60%, transparent);
    }
    .aura-empty-icon {
      display: grid;
      place-items: center;
      width: 36px;
      height: 36px;
      border-radius: 999px;
      background: var(--surface);
      color: var(--muted);
      font-weight: 900;
    }
    strong { font-size: var(--aura-fs-md, 15px); }
    p {
      max-width: 360px;
      margin: 0;
      color: var(--muted);
      font-size: var(--aura-fs-sm, 13px);
    }
  `]
})
export class LegacyAuraEmptyComponent {
  @Input() icon = 'A';
  @Input() title = 'No records found';
  @Input() message = 'Create a record or change filters to see results.';
  @Input() actionLabel = '';
  @Output() action = new EventEmitter<void>();
}
