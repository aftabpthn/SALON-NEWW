import { CommonModule } from '@angular/common';
import { Component, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { PosPaymentMode, PosSettingsService } from '../core/pos-settings.service';

@Component({
  selector: 'app-payment-modes',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  template: `
    <section class="page-stack inner-page-shell">
      <div class="module-hero inner-page-header">
        <div>
          <h2>Payment modes</h2>
        </div>
        <a class="ghost-button" routerLink="/pos">Back to POS</a>
      </div>

      <section class="panel inner-page-card">
        <div class="section-title">
          <div>
            <span class="eyebrow">{{ editingId() ? 'Edit mode' : 'Create mode' }}</span>
            <h2>{{ editingId() ? 'Update payment mode' : 'New payment mode' }}</h2>
          </div>
        </div>
        <div class="form-panel inline-form">
          <label class="field">
            <span>Mode name</span>
            <input [(ngModel)]="draft.label" placeholder="Razorpay, Bank transfer, Sodexo" />
          </label>
          <label class="field">
            <span>Settlement type</span>
            <select [(ngModel)]="draft.settlementType">
              <option value="cash">Cash drawer</option>
              <option value="digital">Digital</option>
              <option value="wallet">Wallet</option>
              <option value="credit">Credit / due</option>
              <option value="other">Other</option>
            </select>
          </label>
          <label class="field">
            <span>Shortcut</span>
            <input [(ngModel)]="draft.shortcut" maxlength="3" placeholder="R" />
          </label>
          <button class="primary-button" type="button" (click)="saveDraft()">{{ editingId() ? 'Save changes' : 'Add mode' }}</button>
          <button class="ghost-button" type="button" *ngIf="editingId()" (click)="cancelEdit()">Cancel</button>
        </div>
      </section>

      <section class="panel inner-page-card">
        <div class="section-title">
          <div>
            <h2>Modes shown in POS</h2>
          </div>
          <button class="ghost-button mini" type="button" (click)="resetDefaults()">Reset defaults</button>
        </div>

        <div class="mode-list">
          <article *ngFor="let mode of modes(); let index = index" class="settings-row" [class.disabled]="!mode.active">
            <div>
              <strong>{{ mode.label }}</strong>
              <span>{{ mode.id }} · {{ mode.settlementType }} · sort {{ mode.sortOrder }}</span>
            </div>
            <label class="check-pill">
              <input type="checkbox" [(ngModel)]="mode.active" (ngModelChange)="save()" />
              Active
            </label>
            <label class="check-pill">
              <input type="checkbox" [(ngModel)]="mode.visibleOnInvoice" (ngModelChange)="save()" />
              Invoice
            </label>
            <label class="check-pill">
              <input type="checkbox" [(ngModel)]="mode.requiresReference" (ngModelChange)="save()" />
              Ref required
            </label>
            <input class="small-input" type="number" [(ngModel)]="mode.sortOrder" (ngModelChange)="save()" />
            <div class="mode-actions">
              <button class="ghost-button mini" type="button" (click)="startEdit(mode)">Edit</button>
              <button class="ghost-button mini" type="button" (click)="remove(index)" [disabled]="isCoreMode(mode.id)">Remove</button>
            </div>
          </article>
        </div>
      </section>
    </section>
  `
})
export class PaymentModesComponent implements OnInit {
  readonly modes = signal<PosPaymentMode[]>([]);
  readonly editingId = signal('');
  draft: Pick<PosPaymentMode, 'label' | 'shortcut' | 'settlementType'> = {
    label: '',
    shortcut: '',
    settlementType: 'digital'
  };

  constructor(private readonly settings: PosSettingsService) {}

  ngOnInit(): void {
    this.modes.set(this.settings.loadPaymentModes());
    this.settings.loadPaymentModesRemote().subscribe((modes) => this.modes.set(modes));
  }

  saveDraft(): void {
    if (this.editingId()) {
      this.updateMode();
      return;
    }
    this.addMode();
  }

  addMode(): void {
    const label = this.draft.label.trim();
    if (!label) return;
    const id = this.settings.modeId(label);
    if (this.modes().some((mode) => mode.id === id)) return;
    const next: PosPaymentMode = {
      id,
      label,
      shortcut: this.draft.shortcut.trim().toUpperCase() || label.slice(0, 1).toUpperCase(),
      settlementType: this.draft.settlementType,
      active: true,
      visibleOnInvoice: true,
      requiresReference: false,
      sortOrder: (this.modes().length + 1) * 10,
      createdAt: new Date().toISOString()
    };
    this.modes.set([...this.modes(), next]);
    this.draft = { label: '', shortcut: '', settlementType: 'digital' };
    this.save();
  }

  startEdit(mode: PosPaymentMode): void {
    this.editingId.set(mode.id);
    this.draft = {
      label: mode.label,
      shortcut: mode.shortcut,
      settlementType: mode.settlementType
    };
  }

  updateMode(): void {
    const id = this.editingId();
    const label = this.draft.label.trim();
    if (!id || !label) return;
    this.modes.set(this.modes().map((mode) => {
      if (mode.id !== id) return mode;
      return {
        ...mode,
        label,
        shortcut: this.draft.shortcut.trim().toUpperCase() || label.slice(0, 1).toUpperCase(),
        settlementType: this.draft.settlementType
      };
    }));
    this.cancelEdit();
    this.save();
  }

  cancelEdit(): void {
    this.editingId.set('');
    this.draft = { label: '', shortcut: '', settlementType: 'digital' };
  }

  remove(index: number): void {
    const mode = this.modes()[index];
    if (!mode || this.isCoreMode(mode.id)) return;
    this.modes.set(this.modes().filter((_, itemIndex) => itemIndex !== index));
    if (this.editingId() === mode.id) this.cancelEdit();
    this.save();
  }

  resetDefaults(): void {
    this.cancelEdit();
    this.settings.savePaymentModes([]);
    this.modes.set(this.settings.loadPaymentModes());
    this.settings.savePaymentModesRemote([]).subscribe((modes) => this.modes.set(modes));
  }

  save(): void {
    this.modes.set([...this.modes()].sort((a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0)));
    this.settings.savePaymentModes(this.modes());
    this.settings.savePaymentModesRemote(this.modes()).subscribe((modes) => this.modes.set(modes));
  }

  isCoreMode(id: string): boolean {
    return ['cash', 'upi', 'card', 'wallet'].includes(id);
  }
}
