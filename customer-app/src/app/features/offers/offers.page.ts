import { Component, OnInit, signal } from "@angular/core";
import { RouterLink } from "@angular/router";
import { IonButton, IonContent } from "@ionic/angular/standalone";
import { firstValueFrom } from "rxjs";
import { CustomerMarketingOffer } from "../../core/api.types";
import { CustomerApiService } from "../../core/customer-api.service";

@Component({
  standalone: true,
  imports: [RouterLink, IonButton, IonContent],
  template: `
    <ion-content>
      <main class="page offers-page">
        <header class="page-head"><h1>Salon offers</h1></header>
        @if (loading()) {
          <section class="state-card premium-card"><h2>Loading offers</h2></section>
        }
        @if (error()) {
          <section class="state-card premium-card error"><h2>Could not load offers</h2><ion-button (click)="reload()">Retry</ion-button></section>
        }
        <div class="offer-grid">
          @for (offer of offers(); track offer.id) {
            <article class="offer-card premium-card">
              @if (offer.hasCreative) {
                <img class="offer-image" [src]="creativeUrl(offer)" [alt]="offer.title" />
              }
              <div class="offer-body">
                <div class="offer-top"><span>{{ offer.branchName || offer.businessName }}</span><b>{{ statusLabel(offer) }}</b></div>
                <h2>{{ offer.title }}</h2>
                <strong class="benefit">{{ benefitLabel(offer) }}</strong>
                @if (offer.customerDescription) { <p>{{ offer.customerDescription }}</p> }
                <dl>
                  <div><dt>Code</dt><dd>{{ offer.code }}</dd></div>
                  <div><dt>Validity</dt><dd>{{ validityLabel(offer) }}</dd></div>
                  @if (offer.minimumBillPaise > 0) { <div><dt>Minimum bill</dt><dd>{{ money(offer.minimumBillPaise) }}</dd></div> }
                  @if (offer.perClientLimit > 0) { <div><dt>Limit</dt><dd>{{ offer.perClientLimit }} per customer</dd></div> }
                </dl>
                <div class="services">
                  @for (service of offer.applicableServices; track service.id) { <span>{{ service.name }}</span> }
                  @empty { <span>All services</span> }
                </div>
                <ion-button expand="block" [routerLink]="['/business', offer.businessSlug, 'book']" [queryParams]="bookingParams(offer)">Book now</ion-button>
              </div>
            </article>
          } @empty {
            @if (!loading() && !error()) { <section class="state-card premium-card"><h2>No offers available</h2></section> }
          }
        </div>
      </main>
    </ion-content>
  `,
  styles: [`
    .offers-page { padding-bottom: 96px; }
    .page-head { margin-bottom: 16px; }
    .page-head h1, .offer-card h2, .state-card h2 { margin: 0; }
    .offer-grid { display: grid; gap: 16px; }
    .offer-card { overflow: hidden; border-radius: 8px; }
    .offer-image { display: block; width: 100%; aspect-ratio: 16 / 9; object-fit: cover; background: #eef4fb; }
    .offer-body { display: grid; gap: 12px; padding: 16px; }
    .offer-top { display: flex; justify-content: space-between; gap: 12px; color: #5f6f86; font-size: .82rem; }
    .offer-top b { color: #0a7a55; }
    .benefit { color: var(--primary); font-size: 1.05rem; }
    .offer-body p { margin: 0; color: #526178; line-height: 1.5; }
    dl { display: grid; gap: 8px; margin: 0; }
    dl div { display: flex; justify-content: space-between; gap: 16px; }
    dt { color: #68768b; } dd { margin: 0; text-align: right; font-weight: 600; }
    .services { display: flex; flex-wrap: wrap; gap: 8px; }
    .services span { padding: 6px 9px; border-radius: 6px; background: #edf5ff; color: #124d83; font-size: .82rem; }
    .state-card { padding: 20px; }
    @media (min-width: 768px) { .offer-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
    @media (min-width: 1200px) { .offer-grid { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
  `]
})
export class OffersPage implements OnInit {
  readonly offers = signal<CustomerMarketingOffer[]>([]);
  readonly loading = signal(false);
  readonly error = signal("");

  constructor(private readonly api: CustomerApiService) {}

  ngOnInit() {
    this.reload();
  }

  async reload() {
    this.loading.set(true);
    this.error.set("");
    try { this.offers.set(await firstValueFrom(this.api.listPublicOffers())); }
    catch { this.error.set("Unable to load offers"); }
    finally { this.loading.set(false); }
  }

  creativeUrl(offer: CustomerMarketingOffer): string { return this.api.publicOfferCreativeUrl(offer.id); }
  bookingParams(offer: CustomerMarketingOffer): Record<string, string> {
    return { serviceIds: offer.targetServiceIds.join(","), offer: offer.code, source: `marketing_offer:${offer.id}:customer_app` };
  }
  money(value: number): string { return (value / 100).toLocaleString("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }); }
  benefitLabel(offer: CustomerMarketingOffer): string {
    if (offer.benefitType === "percentage_discount") return `${offer.benefitValue / 100}% off`;
    if (["fixed_discount", "wallet_credit"].includes(offer.benefitType)) return `${this.money(offer.benefitValue)} ${offer.benefitType === "fixed_discount" ? "off" : "wallet credit"}`;
    return offer.benefitType.replace(/_/g, " ");
  }
  statusLabel(offer: CustomerMarketingOffer): string { return offer.endsAt && Date.parse(offer.endsAt) <= Date.now() + 7 * 86400000 ? "Expiring" : "Live"; }
  validityLabel(offer: CustomerMarketingOffer): string {
    const start = offer.startsAt ? new Date(offer.startsAt).toLocaleDateString("en-IN") : "Now";
    const end = offer.endsAt ? new Date(offer.endsAt).toLocaleDateString("en-IN") : "No expiry";
    return `${start} - ${end}`;
  }
}
