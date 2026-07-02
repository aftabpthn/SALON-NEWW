import { CommonModule } from '@angular/common';
import { Component, EventEmitter, HostListener, Input, Output } from '@angular/core';

@Component({
  selector: 'aura-legacy-drawer',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="aura-drawer-backdrop" *ngIf="open" (click)="close()"></div>
    <aside class="aura-drawer" *ngIf="open" [class.wide]="size === 'wide'" role="dialog" aria-modal="true">
      <header>
        <div>
          <span *ngIf="eyebrow">{{ eyebrow }}</span>
          <h2>{{ title }}</h2>
        </div>
        <button type="button" aria-label="Close drawer" (click)="close()">x</button>
      </header>
      <section class="aura-drawer-body">
        <ng-content></ng-content>
      </section>
      <footer *ngIf="hasFooter">
        <ng-content select="[drawer-footer]"></ng-content>
      </footer>
    </aside>
  `,
  styles: [`
    .aura-drawer-backdrop {
      position: fixed;
      inset: 0;
      z-index: 80;
      background: rgba(17, 24, 39, 0.36);
    }
    .aura-drawer {
      position: fixed;
      top: 0;
      right: 0;
      z-index: 81;
      display: grid;
      grid-template-rows: auto 1fr auto;
      width: min(420px, 100vw);
      height: 100vh;
      background: var(--surface);
      box-shadow: var(--shadow-lg);
    }
    .aura-drawer.wide { width: min(560px, 100vw); }
    header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      min-height: 56px;
      padding: 12px 16px;
      border-bottom: 1px solid var(--line);
    }
    header span {
      color: var(--muted);
      font-size: var(--aura-fs-xs, 11px);
      font-weight: 900;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }
    h2 {
      margin: 0;
      font-size: var(--aura-fs-lg, 18px);
    }
    header button {
      width: 32px;
      height: 32px;
      border: 1px solid var(--line);
      border-radius: var(--aura-radius-md, 6px);
      background: var(--surface);
      cursor: pointer;
    }
    .aura-drawer-body {
      min-height: 0;
      overflow: auto;
      padding: 16px;
    }
    footer {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
      padding: 12px 16px;
      border-top: 1px solid var(--line);
      background: var(--surface);
    }
  `]
})
export class LegacyAuraDrawerComponent {
  @Input() open = false;
  @Input() title = '';
  @Input() eyebrow = '';
  @Input() size: 'default' | 'wide' = 'default';
  @Input() hasFooter = false;
  @Output() closed = new EventEmitter<void>();

  @HostListener('document:keydown.escape')
  onEscape(): void {
    if (this.open) this.close();
  }

  close(): void {
    this.closed.emit();
  }
}
