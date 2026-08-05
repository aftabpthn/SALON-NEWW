import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AuthService } from '../core/services/auth.service';
import { BillingStateService } from '../core/services/billing-state.service';

/**
 * Explains a subscription refusal, and offers the one action that resolves it.
 *
 * Only appears once the API has actually refused something. It is a report of
 * what happened, not a prediction — the app does not poll the subscription, so
 * it has nothing to say until a request comes back blocked.
 *
 * Owners and admins get a link to billing because they can act on it. Everyone
 * else gets the explanation without a link they would only be denied at, and is
 * told who to ask instead.
 */
@Component({
  selector: 'app-subscription-banner',
  imports: [RouterLink],
  template: `
    @if (block(); as state) {
      <aside class="subscription-banner" [class.read-only]="state.readOnly" role="status">
        <i class="bi" [class.bi-exclamation-octagon]="!state.readOnly" [class.bi-lock]="state.readOnly" aria-hidden="true"></i>
        <div class="banner-copy">
          <strong>{{ title(state.status, state.readOnly) }}</strong>
          <span>{{ detail(state.readOnly) }}</span>
        </div>
        @if (canManageBilling) {
          <a class="banner-action" routerLink="/saas">Manage subscription</a>
        }
      </aside>
    }
  `,
  styles: [`
    .subscription-banner {
      display: flex;
      align-items: center;
      gap: 12px;
      margin: 12px 16px 0;
      padding: 12px 16px;
      border: 1px solid color-mix(in srgb, #b3261e 40%, transparent);
      border-left: 3px solid #b3261e;
      border-radius: 6px;
      background: color-mix(in srgb, #b3261e 8%, transparent);
      color: inherit;
      font-size: 14px;
    }
    .subscription-banner.read-only {
      border-color: color-mix(in srgb, #9a6700 45%, transparent);
      border-left-color: #9a6700;
      background: color-mix(in srgb, #9a6700 10%, transparent);
    }
    .subscription-banner > .bi { font-size: 18px; flex: 0 0 auto; }
    .banner-copy { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1 1 auto; }
    .banner-copy strong { font-weight: 600; }
    .banner-copy span { opacity: .85; }
    .banner-action {
      flex: 0 0 auto;
      padding: 7px 14px;
      border-radius: 6px;
      background: #b3261e;
      color: #fff;
      font-weight: 600;
      text-decoration: none;
      white-space: nowrap;
    }
    .subscription-banner.read-only .banner-action { background: #9a6700; }
    .banner-action:hover { filter: brightness(1.08); }
    .banner-action:focus-visible { outline: 2px solid currentColor; outline-offset: 2px; }
    @media (max-width: 720px) {
      .subscription-banner { flex-wrap: wrap; }
      .banner-action { width: 100%; text-align: center; }
    }
  `],
})
export class SubscriptionBannerComponent {
  private readonly billing = inject(BillingStateService);
  private readonly auth = inject(AuthService);

  readonly block = this.billing.block;
  readonly canManageBilling = this.auth.hasRole('owner', 'admin');

  title(status: string, readOnly: boolean): string {
    if (readOnly) return 'Payment due — the salon is read-only';
    if (status === 'paused') return 'Subscription paused';
    return 'Subscription is not active';
  }

  detail(readOnly: boolean): string {
    // Says what still works, so nobody assumes their data is gone.
    return readOnly
      ? 'Everything can still be viewed and exported. New bills, bookings and edits resume once payment clears.'
      : 'Access is limited until the subscription is renewed.';
  }
}
