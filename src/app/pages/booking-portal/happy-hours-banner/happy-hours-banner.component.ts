import { CommonModule } from '@angular/common';
import { Component, Input, OnChanges } from '@angular/core';
import { HappyHoursPortalService } from '../happy-hours-portal.service';

@Component({
  selector: 'app-happy-hours-banner',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './happy-hours-banner.component.html',
  styleUrls: ['./happy-hours-banner.component.css']
})
export class HappyHoursBannerComponent implements OnChanges {
  @Input() tenantId = '';
  @Input() branchId = '';
  @Input() serviceId = '';
  @Input() serviceCategory = '';
  @Input() staffId = '';
  @Input() bookingDate = '';
  @Input() cartTotalPaise = 0;

  publicOffers: any[] = [];
  activeOffers: any[] = [];
  upcomingOffers: any[] = [];
  isActive = false;

  constructor(private hhService: HappyHoursPortalService) {}

  ngOnChanges(): void {
    if (!this.branchId) return;
    this.hhService.getPublicOffers(this.branchId, this.tenantId, {
      serviceId: this.serviceId,
      serviceCategory: this.serviceCategory,
      staffId: this.staffId,
      currentDate: this.bookingDate,
      cartTotalPaise: this.cartTotalPaise
    }).subscribe({
      next: (data: any) => {
        this.publicOffers = (data?.offers || []).slice(0, 5);
      },
      error: () => {
        this.publicOffers = [];
      }
    });
    this.hhService.getActiveNow(this.branchId, this.tenantId).subscribe((data: any) => {
      this.activeOffers = data || [];
      this.isActive = this.activeOffers.length > 0;
    });
    this.hhService.getUpcoming(this.branchId, this.tenantId).subscribe((data: any) => {
      this.upcomingOffers = (data || []).slice(0, 3);
    });
  }

  formatDiscount(hh: any): string {
    if (hh.discountType === 'percent') return `${hh.discountValue}% off`;
    return `₹${(hh.discountValue / 100).toFixed(0)} off`;
  }

  formatOffer(offer: any): string {
    if (offer.discountSummary) return offer.discountSummary;
    if (offer.discountType) return this.formatDiscount(offer);
    if (offer.code) return `Use code ${offer.code}`;
    return offer.promoType ? String(offer.promoType).replace(/_/g, ' ') : 'Special offer';
  }

  offerWindow(offer: any): string {
    const dateText = [offer.validFrom || offer.startDate, offer.validTo || offer.endDate].filter(Boolean).join(' to ');
    const timeText = offer.startTime && offer.endTime ? `${offer.startTime}-${offer.endTime}` : '';
    return [dateText, timeText].filter(Boolean).join(' · ');
  }
}
