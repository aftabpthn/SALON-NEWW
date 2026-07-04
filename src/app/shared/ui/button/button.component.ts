import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';

@Component({
  selector: 'aura-legacy-button',
  standalone: true,
  imports: [CommonModule],
  template: `
    <button
      [attr.type]="type"
      [class]="variant"
      [disabled]="disabled"
      [attr.title]="disabled ? disabledReason : title"
      (click)="pressed.emit($event)"
    >
      <ng-content></ng-content>
    </button>
  `,
  styles: [`
    button {
      min-height: var(--aura-h-button, 34px);
      border: 1px solid var(--line);
      border-radius: var(--aura-radius-md, 6px);
      padding: 0 14px;
      background: var(--surface);
      color: var(--ink);
      font-size: var(--aura-fs-sm, 13px);
      font-weight: 800;
      cursor: pointer;
    }
    .primary {
      border-color: var(--aura-primary, #4B1238);
      background: var(--aura-primary, #4B1238);
      color: #fff;
    }
    .ghost { background: var(--surface); }
    .dark {
      border-color: #111827;
      background: #111827;
      color: #fff;
    }
    button:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
  `]
})
export class LegacyAuraButtonComponent {
  @Input() variant: 'primary' | 'ghost' | 'dark' = 'ghost';
  @Input() type: 'button' | 'submit' | 'reset' = 'button';
  @Input() disabled = false;
  @Input() disabledReason = '';
  @Input() title = '';
  @Output() pressed = new EventEmitter<Event>();
}
