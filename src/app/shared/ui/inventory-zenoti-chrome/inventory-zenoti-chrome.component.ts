import { CommonModule } from '@angular/common';
import { Component, EventEmitter, Input, Output } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';

@Component({
  selector: 'app-inventory-zenoti-chrome',
  standalone: true,
  imports: [CommonModule, RouterLink, RouterLinkActive],
  template: `
    <section class="inventory-zenoti-chrome">
      <div class="zenoti-heading">
        <div>
          <h1>{{ title }}</h1>
          <p>{{ breadcrumb }}</p>
        </div>
        <ng-content select="[zenoti-actions]"></ng-content>
      </div>

      <nav class="zenoti-shortcuts" aria-label="Inventory shortcuts">
        <a *ngFor="let link of shortcutLinks" [routerLink]="link.href" routerLinkActive="active">{{ link.label }}</a>
      </nav>
    </section>
  `,
  styles: [`
    .inventory-zenoti-chrome {
      background: #fff;
      border: 1px solid #E7DDD6;
      color: #1d2733;
      display: grid;
      gap: 10px;
      padding: 14px 16px 12px;
    }

    .zenoti-topline,
    .zenoti-heading,
    .zenoti-actions,
    .zenoti-shortcuts {
      align-items: center;
      display: flex;
      gap: 8px;
    }

    .zenoti-topline {
      justify-content: space-between;
    }

    .zenoti-topline strong {
      font-size: 15px;
      font-weight: 900;
    }

    .zenoti-actions,
    .zenoti-shortcuts {
      flex-wrap: wrap;
      justify-content: flex-end;
    }

    .zenoti-actions a,
    .zenoti-actions button,
    .zenoti-shortcuts a {
      background: #fff;
      border: 1px solid #D4C0CF;
      border-radius: 3px;
      color: #4B1238;
      cursor: pointer;
      font: inherit;
      font-size: 12px;
      font-weight: 900;
      line-height: 1;
      padding: 8px 12px;
      text-decoration: none;
    }

    .zenoti-command {
      border: 1px solid #D4C0CF;
      border-radius: 3px;
      font-weight: 900;
      justify-self: end;
      max-width: 620px;
      min-height: 36px;
      padding: 6px 10px;
      width: min(100%, 620px);
    }

    .zenoti-heading {
      border-top: 1px solid #E7DDD6;
      justify-content: space-between;
      padding-top: 12px;
    }

    .zenoti-heading h1 {
      font-size: 22px;
      line-height: 1.15;
      margin: 0;
    }

    .zenoti-heading p {
      color: #6f6470;
      font-size: 13px;
      margin: 6px 0 0;
    }

    .zenoti-shortcuts {
      border-top: 1px solid #E7DDD6;
      justify-content: flex-start;
      padding-top: 10px;
    }

    .zenoti-shortcuts a.active {
      background: #F8EEF4;
      box-shadow: inset 0 -3px 0 #B7791F;
    }

    @media (max-width: 760px) {
      .zenoti-topline,
      .zenoti-heading {
        align-items: flex-start;
        display: grid;
      }

      .zenoti-command {
        justify-self: stretch;
      }

      .zenoti-actions,
      .zenoti-shortcuts {
        justify-content: flex-start;
      }
    }
  `] })
export class InventoryZenotiChromeComponent {
  @Input() title = 'Manage products';
  @Input() breadcrumb = 'Inventory > Manage Products';
  @Output() refresh = new EventEmitter<void>();

  readonly shortcutLinks = [
    { label: 'Reorder plan', href: '/inventory/reorder' },
    { label: 'Product 360', href: '/inventory' },
    { label: 'Supplier 360', href: '/suppliers' },
    { label: 'Service Recipes', href: '/inventory/recipes' },
    { label: 'FIFO Batches', href: '/inventory/fifo' },
    { label: 'Stock Audit', href: '/inventory/stock-audit' },
    { label: 'Scanner', href: '/inventory/scanner' },
    { label: 'Product Consume', href: '/inventory/product-consume' }];
}
