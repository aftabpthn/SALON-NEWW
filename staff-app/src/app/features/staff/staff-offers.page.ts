import { Component, HostListener, OnDestroy, OnInit, signal } from "@angular/core";
import { PaiseInrPipe } from "../../core/paise-inr.pipe";
import { StaffAppService, StaffOffer } from "../../core/staff-app.service";
import { StaffPageStateComponent } from "./staff-page-state.component";

@Component({
  standalone: true,
  imports: [PaiseInrPipe, StaffPageStateComponent],
  template: `
    <section class="page">
      <header class="page-head"><div><p class="eyebrow">Offers</p><h1>Salon offers</h1></div></header>
      @if (!canReadOffers()) { <section staffPageState class="notice">You do not have permission to view offers.</section> }
      @if (loading()) { <section staffPageState class="state" [loading]="true">Loading offers...</section> }
      @if (staff.error()) { <section staffPageState class="notice">{{ staff.error() }}</section> }
      @if (canReadOffers()) {
        <section class="grid three">
          <article class="kpi"><span>Running</span><strong>{{ offers().length }}</strong></article>
          <article class="kpi"><span>Expiring</span><strong>{{ expiringCount() }}</strong></article>
          <article class="kpi"><span>Service offers</span><strong>{{ serviceOfferCount() }}</strong></article>
        </section>
        <section class="offer-grid">
            @for (offer of offers(); track offer.id) {
              <article class="offer-card">
                <div class="offer-creative">
                  @if (creativeUrls()[offer.id]; as creativeUrl) {
                    <img [src]="creativeUrl" [alt]="offer.title + ' offer'" />
                  } @else {
                    <span>{{ offer.code }}</span>
                  }
                </div>
                <div class="offer-content">
                  <div class="offer-heading"><div><h2>{{ offer.title }}</h2><strong>{{ offer.code }}</strong></div><span class="badge green">{{ statusLabel(offer) }}</span></div>
                  @if (offer.customerDescription) { <p>{{ offer.customerDescription }}</p> }
                  <dl class="offer-facts">
                    <div><dt>Offer</dt><dd>{{ benefitLabel(offer) }}</dd></div>
                    <div><dt>Validity</dt><dd>{{ validityLabel(offer) }}</dd></div>
                    @if (offer.minimumBillPaise > 0) { <div><dt>Minimum bill</dt><dd>{{ offer.minimumBillPaise | paiseInr }}</dd></div> }
                    <div><dt>Limit</dt><dd>{{ offer.perClientLimit }} per client</dd></div>
                  </dl>
                  @if (offer.applicableServices.length || !offer.targetPackageIds.length) { <div class="offer-services"><span>Applicable services</span><div>@for (service of offer.applicableServices; track service.id) { <b>{{ service.name }}</b> } @empty { <b>All services</b> }</div></div> }
                  @if (offer.applicablePackages.length) { <div class="offer-services"><span>Applicable packages</span><div>@for (itemPackage of offer.applicablePackages; track itemPackage.id) { <b>{{ itemPackage.name }}</b> }</div></div> }
                  @if (offer.staffInstructions) { <div class="offer-instructions"><span>Staff instructions</span><p>{{ offer.staffInstructions }}</p></div> }
                </div>
              </article>
            } @empty {
              <p class="empty">No running offers.</p>
            }
        </section>
      }
    </section>
  `,
  styleUrls: ["./staff-app.styles.css"]
})
export class StaffOffersPage implements OnInit, OnDestroy {
  readonly offers = signal<StaffOffer[]>([]);
  readonly loading = signal(false);
  readonly creativeUrls = signal<Record<string, string>>({});
  private loadGeneration = 0;
  constructor(readonly staff: StaffAppService) {}
  ngOnInit() { if (this.canReadOffers()) void this.load(); }
  ngOnDestroy() { this.revokeCreatives(); }
  @HostListener("window:aura:offers-updated") onOffersUpdated() { if (this.canReadOffers()) void this.load(); }
  async load() {
    const generation = ++this.loadGeneration;
    this.loading.set(true);
    try {
      const offers = await this.staff.offers();
      if (generation !== this.loadGeneration) return;
      this.offers.set(offers);
      void this.loadCreatives(offers, generation);
    } finally { if (generation === this.loadGeneration) this.loading.set(false); }
  }
  canReadOffers(): boolean { return this.staff.hasPermission("staff.app.offers.read"); }
  serviceOfferCount(): number { return this.offers().filter((offer) => offer.targetServiceIds?.length).length; }
  expiringCount(): number {
    const soon = Date.now() + 7 * 86400000;
    return this.offers().filter((offer) => offer.endsAt && Date.parse(offer.endsAt) <= soon).length;
  }
  benefitLabel(offer: StaffOffer): string {
    const type = offer.benefitType.replace(/_/g, " ");
    if (offer.benefitType === "percentage_discount") return `${offer.benefitValue / 100}% ${type}`;
    if (offer.benefitType === "fixed_discount" || offer.benefitType === "wallet_credit") return `${offer.benefitValue} paise ${type}`;
    return type;
  }
  statusLabel(offer: StaffOffer): string { return offer.endsAt && Date.parse(offer.endsAt) <= Date.now() + 7 * 86400000 ? "Expiring" : "Live"; }
  validityLabel(offer: StaffOffer): string {
    const start = offer.startsAt ? new Date(offer.startsAt).toLocaleDateString("en-IN") : "Now";
    const end = offer.endsAt ? new Date(offer.endsAt).toLocaleDateString("en-IN") : "No expiry";
    return `${start} - ${end}`;
  }
  private async loadCreatives(offers: StaffOffer[], generation: number) {
    this.revokeCreatives();
    const entries = await Promise.all(offers.filter((offer) => offer.hasCreative).map(async (offer) => {
      try { return [offer.id, URL.createObjectURL(await this.staff.offerCreative(offer.id))] as const; }
      catch { return null; }
    }));
    if (generation !== this.loadGeneration) { entries.forEach((entry) => entry && URL.revokeObjectURL(entry[1])); return; }
    this.creativeUrls.set(Object.fromEntries(entries.filter((entry): entry is readonly [string, string] => !!entry)));
  }
  private revokeCreatives() {
    Object.values(this.creativeUrls()).forEach((url) => URL.revokeObjectURL(url));
    this.creativeUrls.set({});
  }
}
