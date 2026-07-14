import { CommonModule } from '@angular/common';
import { Component, OnInit, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { PosHeldInvoiceDraft, PosSettingsService } from '../core/pos-settings.service';
import { AuraMoneyPipe } from '../shared/pipes/aura-money.pipe';
import { AuraDatePipe } from '../shared/pipes/aura-date.pipe';

@Component({
  selector: 'app-pos-holds',
  standalone: true,
  imports: [AuraDatePipe, AuraMoneyPipe, CommonModule, RouterLink],
  template: `
    <section class="page-stack inner-page-shell">
      <div class="module-hero inner-page-header">
        <div>
          <h2>Hold invoice register</h2>
        </div>
        <div class="hero-actions">
          <a class="ghost-button" routerLink="/pos">Back to POS</a>
          <button class="ghost-button" type="button" (click)="refresh()">Refresh</button>
        </div>
      </div>

      <div class="metrics-grid inner-stats-grid">
        <article class="metric-card"><span>Held invoices</span><strong>{{ holds().length }}</strong></article>
        <article class="metric-card"><span>Total value</span><strong>{{ totalHeld() | auraMoney:'1.0-0' }}</strong></article>
        <article class="metric-card"><span>Due value</span><strong>{{ totalDue() | auraMoney:'1.0-0' }}</strong></article>
      </div>

      <section class="panel inner-page-card">
        <div class="table-toolbar inner-action-bar">
          <div>
            <h2>Held invoice list</h2>
          </div>
          <button class="ghost-button" type="button" (click)="clearAll()" [disabled]="!holds().length">Clear all holds</button>
        </div>

        <div class="table-wrap" *ngIf="holds().length; else emptyState">
          <table>
            <thead>
              <tr>
                <th>Hold invoice</th>
                <th>Client</th>
                <th>Branch</th>
                <th>Staff</th>
                <th>Items</th>
                <th class="right">Total</th>
                <th class="right">Due</th>
                <th>Updated</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              <tr *ngFor="let hold of holds()">
                <td>
                  <a class="table-link hold-title-link" [routerLink]="['/pos']" [queryParams]="{ holdId: hold.id }">
                    <strong>{{ hold.title }}</strong>
                    <small>{{ hold.id }}</small>
                  </a>
                </td>
                <td>{{ hold.clientName || 'Walk-in client' }}</td>
                <td>{{ hold.branchName || hold.branchId || 'Branch' }}</td>
                <td>{{ hold.staffName || 'Unassigned' }}</td>
                <td>{{ hold.items.length }}</td>
                <td class="right">{{ hold.total | auraMoney:'1.0-0' }}</td>
                <td class="right">{{ hold.balanceDue | auraMoney:'1.0-0' }}</td>
                <td>{{ hold.updatedAt | auraDate:'date' }}</td>
                <td><button class="ghost-button mini" type="button" (click)="deleteHold(hold.id)">Delete</button></td>
              </tr>
            </tbody>
          </table>
        </div>

        <ng-template #emptyState>
          <div class="empty-state">
            <strong>No held invoices</strong>
            <span>Add invoice items in POS and click Hold invoice. Draft will appear here.</span>
            <a class="primary-button fit" routerLink="/pos">Create hold invoice</a>
          </div>
        </ng-template>
      </section>
    </section>
  `
})
export class PosHoldsComponent implements OnInit {
  readonly holds = signal<PosHeldInvoiceDraft[]>([]);

  constructor(private readonly settings: PosSettingsService) {}

  ngOnInit(): void {
    this.refresh();
  }

  refresh(): void {
    this.holds.set(this.settings.loadHeldInvoices());
  }

  totalHeld(): number {
    return this.money(this.holds().reduce((sum, hold) => sum + Number(hold.total || 0), 0));
  }

  totalDue(): number {
    return this.money(this.holds().reduce((sum, hold) => sum + Number(hold.balanceDue || 0), 0));
  }

  deleteHold(id: string): void {
    this.settings.deleteHeldInvoice(id);
    this.refresh();
  }

  clearAll(): void {
    this.settings.clearHeldInvoices();
    this.refresh();
  }

  private money(value: number | string): number {
    return Math.round((Number(value) || 0) * 100) / 100;
  }
}
