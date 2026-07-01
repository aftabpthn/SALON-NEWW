import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Output, signal } from '@angular/core';

@Component({
  selector: 'app-barcode-input',
  standalone: true,
  imports: [CommonModule],
  styles: [`
    .barcode { display: grid; gap: 6px; }
    input { min-height: 40px; border: 1px solid #d2dce3; border-radius: 6px; padding: 8px 10px; font: inherit; }
    small { color: #52657a; }
  `],
  template: `
    <label class="barcode">
      <strong>Barcode scanner</strong>
      <input
        type="text"
        autocomplete="off"
        placeholder="Scan product, gift card, membership"
        [value]="code()"
        (input)="code.set($any($event.target).value)"
        (keydown.enter)="submit()"
      />
    </label>
  `
})
export class BarcodeInputComponent {
  readonly code = signal('');
  @Output() scanned = new EventEmitter<string>();

  submit(): void {
    const value = this.code().trim();
    if (!value) return;
    this.scanned.emit(value);
    this.code.set('');
  }
}
