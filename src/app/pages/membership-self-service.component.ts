import { CommonModule } from '@angular/common';
import { Component, OnInit, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { catchError, of } from 'rxjs';
import { ApiRecord, ApiService } from '../core/api.service';
import { StateComponent } from '../shared/ui/state/state.component';
import { AuraMoneyPipe } from '../shared/pipes/aura-money.pipe';
import { AuraDatePipe } from '../shared/pipes/aura-date.pipe';

@Component({
  selector: 'app-membership-self-service',
  standalone: true,
  imports: [AuraDatePipe, AuraMoneyPipe, CommonModule, FormsModule, StateComponent],
  template: `
    <section class="page-stack self-service-page inner-page-shell">
      <div class="module-hero compact-hero inner-page-header">
        <div>
          <h2>Membership status</h2>
        </div>
      </div>

      <app-state [loading]="loading()" [error]="error()"></app-state>
      <div class="state success" *ngIf="message()">{{ message() }}</div>

      <section class="stats-grid inner-stats-grid" *ngIf="summary() as data">
        <article class="metric-card">
          <span>Active plan</span>
          <strong>{{ data.wallet?.activePlanName || 'None' }}</strong>
          <small>{{ data.wallet?.bestDiscountPercent || 0 }}% service discount</small>
        </article>
        <article class="metric-card">
          <span>Remaining credits</span>
          <strong>{{ data.remainingCredits || 0 }}</strong>
          <small>{{ data.wallet?.serviceCredits?.used || 0 }} used</small>
        </article>
        <article class="metric-card">
          <span>Expiry</span>
          <strong>{{ data.expiryDate || '-' }}</strong>
          <small>{{ data.daysLeft ?? '-' }} days left</small>
        </article>
        <article class="metric-card">
          <span>Wallet</span>
          <strong>{{ (data.wallet?.walletBalance || 0) | auraMoney:'1.0-0' }}</strong>
          <small>{{ data.wallet?.walletConnection?.source || 'membership wallet' }}</small>
        </article>
      </section>

      <div class="two-grid" *ngIf="summary() as data">
        <section class="panel inner-page-card">
          <div class="section-title"><h2>Membership wallet</h2></div>
          <div class="detail-grid">
            <div><span>Client</span><strong>{{ data.client?.name || data.client?.id }}</strong></div>
            <div><span>Phone</span><strong>{{ data.client?.phone || '-' }}</strong></div>
            <div><span>Product discount</span><strong>{{ data.wallet?.productDiscount || 0 }}%</strong></div>
            <div><span>Family sharing</span><strong>{{ data.wallet?.familySharing?.status || 'not_shared' }}</strong></div>
          </div>
        </section>

        <section class="panel">
          <div class="section-title"><h2>Expiry reminders</h2></div>
          <div class="quick-grid" *ngIf="data.expiryReminders?.length; else noReminders">
            <article class="action-card" *ngFor="let reminder of data.expiryReminders">
              <strong>{{ reminder.reminderType }}</strong>
              <span>{{ reminder.dueOn }} · {{ reminder.status }}</span>
            </article>
          </div>
          <ng-template #noReminders>
            <div class="empty-panel compact-empty"><strong>No reminder queued yet.</strong><span>The salon team can generate expiry reminders from the membership desk.</span></div>
          </ng-template>
        </section>
      </div>

      <section class="panel inner-page-card" *ngIf="summary() as data">
        <div class="section-title"><h2>Requests</h2></div>
        <div class="self-service-actions">
          <button class="primary-button" type="button" (click)="requestRenewLink()" [disabled]="saving() || !data.membershipId">Request renewal payment link</button>
          <button class="ghost-button" type="button" (click)="requestPaymentMethodUpdate()" [disabled]="saving() || !data.membershipId">Request payment method update</button>
        </div>
        <label class="field">
          <span>Cancellation reason</span>
          <textarea [(ngModel)]="cancelReason" placeholder="Tell the salon why you want to cancel"></textarea>
        </label>
        <button class="ghost-button danger-text" type="button" (click)="requestCancel()" [disabled]="saving() || !cancelReason.trim() || !data.membershipId">Request cancellation approval</button>
      </section>

      <section class="panel inner-page-card" *ngIf="summary() as data">
        <div class="section-title"><h2>Request history</h2></div>
        <div class="table-wrap inner-table-wrap">
          <table>
            <thead><tr><th>When</th><th>Type</th><th>Status</th><th>Reason</th></tr></thead>
            <tbody>
              <tr *ngFor="let request of data.requests || []">
                <td>{{ request.createdAt | auraDate:'date' }}</td>
                <td>{{ label(request.requestType) }}</td>
                <td>{{ request.status }}</td>
                <td>{{ request.reason || '-' }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>
    </section>
  `,
  styles: [`
    .self-service-page {
      gap: 18px;
    }

    .self-service-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 10px;
      margin-bottom: 14px;
    }

    .fine-print {
      color: #64748b;
      font-size: 0.9rem;
      margin: 10px 0 0;
    }
  `]
})
export class MembershipSelfServiceComponent implements OnInit {
  readonly loading = signal(true);
  readonly saving = signal(false);
  readonly error = signal('');
  readonly message = signal('');
  readonly summary = signal<ApiRecord | null>(null);
  cancelReason = '';
  private token = '';

  constructor(private readonly route: ActivatedRoute, private readonly api: ApiService) {}

  ngOnInit(): void {
    this.token = this.route.snapshot.paramMap.get('token') || '';
    this.load();
  }

  load(): void {
    if (!this.token) {
      this.error.set('Self-service link is missing.');
      this.loading.set(false);
      return;
    }
    this.loading.set(true);
    this.api.get<ApiRecord>('membership-enterprise/self-service/public', this.token).pipe(
      catchError((error) => {
        this.error.set(error?.error?.error || error?.message || 'Unable to load membership status');
        return of(null);
      })
    ).subscribe((summary) => {
      this.summary.set(summary);
      this.loading.set(false);
    });
  }

  requestRenewLink(): void {
    this.createRequest('renew-link', {}, 'Renew payment link request created. Salon team will share the approved link.');
  }

  requestPaymentMethodUpdate(): void {
    this.createRequest('payment-method-update', { reason: 'Client requested payment method update' }, 'Payment method update request created.');
  }

  requestCancel(): void {
    this.createRequest('cancel-request', { reason: this.cancelReason }, 'Cancellation request sent for owner/manager approval.');
  }

  label(value: string): string {
    return String(value || '').replace(/_/g, ' ');
  }

  private createRequest(path: string, payload: ApiRecord, success: string): void {
    this.saving.set(true);
    this.error.set('');
    this.api.post<ApiRecord>(`membership-enterprise/self-service/public/${this.token}/${path}`, payload).pipe(
      catchError((error) => {
        this.error.set(error?.error?.error || error?.message || 'Unable to create request');
        return of(null);
      })
    ).subscribe((result) => {
      this.saving.set(false);
      if (!result) return;
      this.message.set(success);
      this.load();
    });
  }
}
