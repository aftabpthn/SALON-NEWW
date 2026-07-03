import { Component, EventEmitter, Output } from '@angular/core';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-void-invoice-modal',
  standalone: true,
  imports: [FormsModule],
  styles: [`
    .billing-panel { display: grid; gap: 14px; border: 1px solid rgba(225, 29, 72, 0.24); border-radius: var(--aura-card-radius-premium, 14px); background: var(--aura-surface-raised, #fff); padding: 16px; box-shadow: 0 12px 30px rgba(75, 18, 56, 0.07); }
    h3 { margin: 0; color: var(--aura-text, #1f2933); }
    label { display: grid; gap: 6px; color: var(--aura-muted, #6b7280); font-size: .78rem; font-weight: 850; text-transform: uppercase; }
    input { min-height: 42px; border: 1px solid var(--aura-border-soft, rgba(75, 18, 56, 0.12)); border-radius: 11px; background: rgba(255,255,255,.96); color: var(--aura-text, #1f2933); padding: 0 11px; font: inherit; }
    input:focus { border-color: color-mix(in srgb, var(--aura-danger, #e11d48) 44%, var(--aura-border-soft, rgba(75,18,56,.12))); box-shadow: 0 0 0 3px rgba(225,29,72,.1); outline: none; }
    button { min-height: 42px; border: 0; border-radius: 11px; color: #fff; background: linear-gradient(135deg, color-mix(in srgb, var(--aura-danger, #e11d48) 82%, black 18%), var(--aura-danger, #e11d48)); font-weight: 850; cursor: pointer; }
  `],
  template: `
    <section class="billing-panel">
      <h3>Void invoice</h3>
      <label>
        <span>Manager approval reason</span>
        <input [(ngModel)]="reason" placeholder="Manager approval reason" />
      </label>
      <button type="button" (click)="voidInvoice.emit(reason)">Void invoice</button>
    </section>
  `
})
export class VoidInvoiceModalComponent {
  @Output() voidInvoice = new EventEmitter<string>();
  reason = '';
}
