import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';

export type LegacyAuraTab = {
  id: string;
  label: string;
  count?: number | string;
  disabled?: boolean;
};

@Component({
  selector: 'aura-legacy-tabs',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="aura-tabs" role="tablist">
      <button
        type="button"
        role="tab"
        *ngFor="let tab of tabs"
        [class.active]="tab.id === active"
        [disabled]="tab.disabled"
        [attr.aria-selected]="tab.id === active"
        (click)="select(tab)"
      >
        {{ tab.label }}
        <span *ngIf="tab.count !== undefined">{{ tab.count }}</span>
      </button>
    </div>
  `,
  styles: [`
    .aura-tabs {
      display: inline-flex;
      gap: 4px;
      max-width: 100%;
      padding: 4px;
      overflow-x: auto;
      border: 1px solid var(--line);
      border-radius: var(--aura-radius-lg, 8px);
      background: var(--surface-2);
    }
    button {
      min-height: var(--aura-h-button-sm, 28px);
      border: 0;
      border-radius: var(--aura-radius-md, 6px);
      padding: 0 12px;
      background: transparent;
      color: var(--muted);
      font-size: var(--aura-fs-sm, 13px);
      font-weight: 800;
      white-space: nowrap;
      cursor: pointer;
    }
    button.active {
      background: var(--surface);
      color: var(--ink);
      box-shadow: var(--shadow-xs);
    }
    button:disabled {
      opacity: 0.48;
      cursor: not-allowed;
    }
    span {
      margin-left: 6px;
      color: var(--muted);
      font-size: var(--aura-fs-xs, 11px);
    }
  `]
})
export class LegacyAuraTabsComponent {
  @Input() tabs: LegacyAuraTab[] = [];
  @Input() active = '';
  @Output() activeChange = new EventEmitter<string>();

  select(tab: LegacyAuraTab): void {
    if (tab.disabled) return;
    this.activeChange.emit(tab.id);
  }
}
