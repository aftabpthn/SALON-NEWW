import { Component, EventEmitter, Input, Output } from "@angular/core";
import { displayBusinessDate, parseDisplayBusinessDate } from "../core/business-date";

@Component({
  selector: "aura-staff-date-picker",
  standalone: true,
  template: `
    <span class="date-picker" [class.disabled]="disabled">
      <span [class.placeholder]="!value">{{ value || "DD/MM/YYYY" }}</span>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 2v2H5a3 3 0 0 0-3 3v12a3 3 0 0 0 3 3h14a3 3 0 0 0 3-3V7a3 3 0 0 0-3-3h-2V2h-2v2H9V2H7Zm12 18H5a1 1 0 0 1-1-1v-8h16v8a1 1 0 0 1-1 1ZM4 9V7a1 1 0 0 1 1-1h2v2h2V6h6v2h2V6h2a1 1 0 0 1 1 1v2H4Z"/></svg>
      <input type="date" [value]="isoValue" [min]="min" [disabled]="disabled" [attr.aria-label]="ariaLabel" (change)="select($any($event.target).value)" />
    </span>
  `,
  styles: [`
    :host{display:block;min-width:0}.date-picker{position:relative;display:flex;align-items:center;justify-content:space-between;width:100%;min-height:42px;border:1px solid var(--staff-input-border);border-radius:12px;padding:10px 13px;background:var(--staff-input-background);color:var(--staff-input-text);font-size:.92rem;font-weight:500;transition:border-color var(--staff-motion-fast) ease,box-shadow var(--staff-motion-fast) ease}.date-picker:hover:not(.disabled){border-color:#b9d5c2}.date-picker:focus-within{border:2px solid var(--staff-input-focus);padding:9px 12px;box-shadow:0 0 0 4px var(--staff-input-focus-ring);background:#fff}.date-picker.disabled{background:var(--staff-input-disabled-background);color:var(--staff-input-disabled-text)}.placeholder{color:var(--staff-input-placeholder);font-weight:400}.date-picker svg{width:18px;height:18px;flex:0 0 auto;fill:var(--staff-text-secondary)}input{position:absolute;inset:0;width:100%;height:100%;border:0;opacity:0;cursor:pointer}input:disabled{cursor:not-allowed}
  `]
})
export class StaffDatePickerComponent {
  @Input() value = "";
  @Input() min = "";
  @Input() disabled = false;
  @Input() ariaLabel = "Select date";
  @Output() readonly valueChange = new EventEmitter<string>();

  get isoValue(): string { return parseDisplayBusinessDate(this.value); }
  select(value: string) { if (value) this.valueChange.emit(displayBusinessDate(value)); }
}
