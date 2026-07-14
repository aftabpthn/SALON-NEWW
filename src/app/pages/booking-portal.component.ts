import { CommonModule } from '@angular/common';
import { Component, OnInit, signal } from '@angular/core';
import { FormsModule, ReactiveFormsModule, UntypedFormBuilder, Validators } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ApiRecord, ApiService } from '../core/api.service';
import { StateComponent } from '../shared/ui/state/state.component';
import { AuraKpiCardComponent } from '../shared/ui/aura-kpi-card/aura-kpi-card.component';
import { HappyHoursBannerComponent } from './booking-portal/happy-hours-banner/happy-hours-banner.component';
import { AuraDatePipe } from '../shared/pipes/aura-date.pipe';

@Component({
  selector: 'app-booking-portal',
  standalone: true,
  imports: [AuraDatePipe, CommonModule, FormsModule, ReactiveFormsModule, RouterLink, StateComponent, AuraKpiCardComponent, HappyHoursBannerComponent],
  template: `
    <main class="portal-page inner-page-shell">
      <section class="module-hero inner-page-header">
        <div>
          <h2>{{ context()?.branding?.brandName || 'Book your salon appointment' }}</h2>
        </div>
        <a class="ghost-button" routerLink="/dashboard">Admin console</a>
      </section>

      <app-state [loading]="loading()" [error]="error()"></app-state>

      <app-happy-hours-banner
        *ngIf="bookingForm.value.branchId"
        [tenantId]="context()?.tenant?.id || tenantSlug()"
        [branchId]="bookingForm.value.branchId || ''"
        [serviceId]="bookingForm.value.serviceId || ''"
        [serviceCategory]="selectedService().category || ''"
        [staffId]="bookingForm.value.staffId || ''"
        [bookingDate]="bookingForm.value.date || ''"
        [cartTotalPaise]="selectedServicePricePaise()"
      ></app-happy-hours-banner>

      <section class="public-profile" *ngIf="profile() as publicProfile">
        <div class="profile-main">
          <h1>{{ publicProfile.tenant?.name || context()?.branding?.brandName || 'Aura Shine' }}</h1>
          <p>{{ branch().address || 'Salon address' }}<ng-container *ngIf="branch().city">, {{ branch().city }}</ng-container></p>
          <div class="trust-row">
            <span class="badge">Instant confirmation</span>
            <span class="badge">{{ branch().timezone || 'Asia/Kolkata' }}</span>
            <span class="badge">{{ (publicProfile.reviews?.rating || 0) | number: '1.1-1' }} / 5 rating</span>
            <a class="badge link-badge" *ngIf="publicProfile.reviews?.googleReviewUrl" [href]="publicProfile.reviews.googleReviewUrl" target="_blank" rel="noopener">Google reviews</a>
          </div>
        </div>
        <div class="profile-aside">
          <strong>{{ publicProfile.services?.length || 0 }}</strong>
          <span>online services</span>
          <strong>{{ publicProfile.staff?.length || 0 }}</strong>
          <span>bookable professionals</span>
          <small>{{ googleReviewLabel() }}</small>
        </div>
      </section>

      <section class="panel" *ngIf="salonPicks().length">
        <div class="section-title">
          <div>
            <h2>Featured services</h2>
          </div>
          <span class="badge">Fresha-style discovery</span>
        </div>
        <div class="pick-grid">
          <button class="pick-card" type="button" *ngFor="let service of salonPicks()" (click)="bookingForm.patchValue({ serviceId: service.id }); findSlots()">
            <span>{{ service.category || 'Service' }}</span>
            <strong>{{ service.name }}</strong>
            <small>{{ service.durationMinutes || 0 }} min</small>
            <div class="hh-price-block" *ngIf="service.happyHour; else pickNormalPrice">
              <span class="original-price">₹{{ servicePricePaise(service) / 100 | number:'1.0-0' }}</span>
              <span class="hh-price">₹{{ service.happyHour.finalPricePaise / 100 | number:'1.0-0' }}</span>
              <span class="hh-tag">{{ happyHourLabel(service) }}</span>
            </div>
            <ng-template #pickNormalPrice>
              <div class="normal-price-block"><span class="price">₹{{ servicePricePaise(service) / 100 | number:'1.0-0' }}</span></div>
            </ng-template>
            <small class="bundle-suggestion" *ngIf="service.bundleSuggestion">Add {{ bundleNames(service) }} for {{ bundleOfferLabel(service) }}</small>
            <em>{{ serviceStaffNames(service) }}</em>
          </button>
        </div>
      </section>

      <div class="metrics-grid" *ngIf="context()?.paymentReady as payment">
        <aura-kpi-card tone="neutral" target="/kpi-details/booking-portal/online-payment"><span>Online payment</span><strong>{{ payment.onlinePayment ? 'Ready' : 'Disabled' }}</strong><small>{{ payment.captureMode }}</small></aura-kpi-card>
        <aura-kpi-card tone="neutral" target="/kpi-details/booking-portal/payment-modes"><span>Payment modes</span><strong>{{ payment.modes.length }}</strong><small>{{ payment.modes.join(', ') }}</small></aura-kpi-card>
        <aura-kpi-card tone="neutral" target="/kpi-details/booking-portal/services"><span>Services</span><strong>{{ services().length }}</strong></aura-kpi-card>
        <aura-kpi-card tone="neutral" target="/kpi-details/booking-portal/staff"><span>Staff</span><strong>{{ staffForBranch().length }}</strong></aura-kpi-card>
      </div>

      <div class="dashboard-grid">
        <section class="form-panel">
          <h3>Choose appointment</h3>
          <form [formGroup]="bookingForm" (ngSubmit)="findSlots()">
            <label class="field">
              <span>Branch</span>
              <select formControlName="branchId" (change)="findSlots()"><option *ngFor="let branch of branches()" [value]="branch.id">{{ branch.name }}</option></select>
            </label>
            <label class="field">
              <span>Service</span>
              <select formControlName="serviceId" (change)="findSlots()"><option *ngFor="let service of services()" [value]="service.id">{{ serviceOptionLabel(service) }}</option></select>
            </label>
            <label class="field">
              <span>Staff</span>
              <select formControlName="staffId"><option value="">Auto assign</option><option *ngFor="let person of staffForBranch()" [value]="person.id">{{ person.name }}</option></select>
            </label>
            <label class="field">
              <span>Date</span>
              <input type="date" formControlName="date" />
            </label>
            <div class="form-actions"><button class="primary-button" type="submit" [disabled]="bookingForm.invalid">Find slots</button></div>
          </form>
        </section>

        <section class="form-panel">
          <h3>Your details</h3>
          <form [formGroup]="clientForm">
            <label class="field"><span>Name</span><input formControlName="name" /></label>
            <label class="field"><span>Phone</span><input formControlName="phone" /></label>
            <label class="field full"><span>Email</span><input formControlName="email" /></label>
            <label class="field full"><span>Notes</span><input formControlName="notes" placeholder="Hair concern, preferred look, allergy, occasion" /></label>
            <div class="form-actions">
              <button class="primary-button" type="button" (click)="confirm()" [disabled]="clientForm.invalid || !selectedSlot()">Confirm booking</button>
            </div>
          </form>
        </section>
      </div>

      <section class="panel" *ngIf="profile() as publicProfile">
        <div class="section-title">
          <div>
            <h2>Book by service or professional</h2>
          </div>
          <span class="badge">{{ publicProfile.categories?.length || 0 }} categories</span>
        </div>
        <div class="catalog-grid">
          <article class="service-card aura-card" *ngFor="let service of services().slice(0, 12)">
            <span>{{ service.category || 'Service' }}</span>
            <strong>{{ service.name }}</strong>
            <small>{{ service.durationMinutes || 0 }} min</small>
            <div class="hh-price-block" *ngIf="service.happyHour; else normalServicePrice">
              <span class="original-price">₹{{ servicePricePaise(service) / 100 | number:'1.0-0' }}</span>
              <span class="hh-price">₹{{ service.happyHour.finalPricePaise / 100 | number:'1.0-0' }}</span>
              <span class="hh-tag">{{ happyHourLabel(service) }}</span>
            </div>
            <ng-template #normalServicePrice>
              <div class="normal-price-block"><span class="price">₹{{ servicePricePaise(service) / 100 | number:'1.0-0' }}</span></div>
            </ng-template>
            <small class="bundle-suggestion" *ngIf="service.bundleSuggestion">Combo: {{ service.bundleSuggestion.bundleName }} · add {{ bundleNames(service) }}</small>
            <em>{{ serviceStaffNames(service) }}</em>
          </article>
        </div>
      </section>

      <section class="panel" *ngIf="staffForBranch().length">
        <div class="section-title">
          <div>
            <h2>Choose staff or auto assign</h2>
          </div>
          <span class="badge">Any professional enabled</span>
        </div>
        <div class="staff-grid">
          <button class="staff-card" type="button" *ngFor="let person of staffForBranch()" (click)="bookingForm.patchValue({ staffId: person.id }); findSlots()">
            <strong>{{ person.name }}</strong>
            <span>{{ person.role || 'Professional' }}</span>
            <small>{{ (person.rating || 0) | number: '1.1-1' }} rating · {{ person.assignedServices?.length || person.assignedServiceIds?.length || 0 }} service(s)</small>
          </button>
        </div>
      </section>

      <section class="panel">
        <div class="section-title"><h2>Available slots</h2></div>
        <div class="quick-grid" *ngIf="slots().length; else noSlots">
          <button class="action-card command-card" type="button" *ngFor="let slot of slots()" (click)="selectSlot(slot)" [class.active]="selectedSlot()?.startAt === slot.startAt" [class.hh-slot]="slot.hasHappyHour">
            <strong>{{ slot.startAt | auraDate:'dateTime' }}</strong>
            <span>{{ slot.staffName }} · {{ slot.chair }} · Score {{ slot.score }}</span>
            <small class="slot-hh-badge" *ngIf="slot.hasHappyHour">Happy Hours rate available</small>
          </button>
        </div>
        <ng-template #noSlots>
          <div class="empty-state"><strong>No slots loaded</strong><span>Pick branch, service and date, then find slots.</span></div>
        </ng-template>
      </section>

      <section class="panel" *ngIf="reviews().length">
        <div class="section-title">
          <div>
            <h2>Recent reviews</h2>
          </div>
          <span class="badge">{{ profile()?.reviews?.count || reviews().length }} review signals</span>
        </div>
        <div class="review-grid">
          <article class="review-card" *ngFor="let review of reviews()">
            <strong>{{ (review.rating || 0) | number: '1.1-1' }} / 5 · {{ review.platform }}</strong>
            <span>{{ review.reviewText || 'Verified visit feedback captured.' }}</span>
            <small>{{ review.reviewer }} · {{ review.createdAt | auraDate:'date' }}</small>
          </article>
        </div>
      </section>

      <section class="panel" *ngIf="appointment() as appt">
        <div class="section-title">
          <div>
            <h2>Appointment {{ appt.status }} for {{ appt.startAt | auraDate:'date' }}</h2>
          </div>
          <span class="badge">{{ appt.onlineStatus }}</span>
        </div>
        <div class="summary-lines">
          <div><span>Appointment ID</span><strong>{{ appt.id }}</strong></div>
          <div><span>Branch</span><strong>{{ branchName(appt.branchId) }}</strong></div>
          <div><span>Staff</span><strong>{{ staffName(appt.staffId) }}</strong></div>
          <div><span>Payment</span><strong>Online payment ready · pay-at-salon fallback</strong></div>
        </div>
        <div class="form-actions">
          <button class="ghost-button" type="button" (click)="cancel()" [disabled]="appt.status === 'cancelled' || appt.status === 'completed'">Cancel booking</button>
          <button class="primary-button" type="button" (click)="reschedule()" [disabled]="!selectedSlot() || appt.status === 'cancelled' || appt.status === 'completed'">Reschedule to selected slot</button>
        </div>
      </section>

      <pre class="result-json" *ngIf="result()">{{ result() | json }}</pre>
    </main>
  `,
  styles: [`
    .portal-page {
      width: 100%;
      max-width: none;
      display: grid;
      gap: 18px;
      padding: 24px 0 36px;
    }
    .public-profile {
      display: grid;
      grid-template-columns: minmax(0, 1fr) 220px;
      gap: 16px;
      align-items: stretch;
      padding: 22px;
      border: 1px solid rgba(75, 18, 56, 0.18);
      border-radius: 8px;
      background: #f8fffd;
    }
    .profile-main h1 {
      margin: 0 0 8px;
      font-family: var(--font-display);
      font-size: 3.6rem;
      line-height: .95;
      letter-spacing: 0;
      color: #0f172a;
    }
    .profile-main p {
      margin: 0;
      color: #475569;
      max-width: 68ch;
    }
    .trust-row {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin-top: 16px;
    }
    .link-badge {
      color: #4B1238;
      text-decoration: none;
    }
    .profile-aside {
      display: grid;
      align-content: center;
      gap: 4px;
      min-width: 0;
      padding: 16px;
      border-left: 1px solid rgba(75, 18, 56, 0.18);
    }
    .profile-aside strong {
      color: #4B1238;
      font-size: 2rem;
      line-height: 1;
    }
    .profile-aside span,
    .profile-aside small {
      color: #475569;
      font-weight: 700;
    }
    .pick-grid,
    .catalog-grid,
    .staff-grid,
    .review-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
      gap: 12px;
    }
    .pick-card,
    .service-card,
    .staff-card,
    .review-card {
      display: grid;
      gap: 7px;
      min-width: 0;
      min-height: 132px;
      padding: 14px;
      border: 1px solid #E7DDD6;
      border-radius: 8px;
      background: #fff;
      text-align: left;
      color: #0f172a;
    }
    .pick-card,
    .staff-card {
      cursor: pointer;
    }
    .pick-card:hover,
    .staff-card:hover {
      border-color: rgba(75, 18, 56, 0.55);
      box-shadow: 0 10px 24px rgba(15, 23, 42, 0.08);
    }
    .pick-card span,
    .service-card span {
      color: #4B1238;
      font-size: .75rem;
      font-weight: 900;
      text-transform: uppercase;
    }
    .pick-card strong,
    .service-card strong,
    .staff-card strong,
    .review-card strong {
      overflow-wrap: anywhere;
      font-size: 1rem;
    }
    .pick-card small,
    .pick-card em,
    .service-card small,
    .service-card em,
    .staff-card span,
    .staff-card small,
    .review-card span,
    .review-card small {
      color: #64748b;
      font-style: normal;
      line-height: 1.35;
    }
    .command-card.active {
      border-color: rgba(75, 18, 56, 0.6);
      background: #e8f5f3;
      box-shadow: inset 0 3px 0 var(--teal);
    }
    .command-card.hh-slot {
      border-color: #1D9E75;
    }
    .slot-hh-badge {
      display: inline-flex;
      width: max-content;
      padding: 2px 8px;
      border-radius: 999px;
      background: #e6f7f0;
      color: #0F6E56;
      font-size: .72rem;
      font-weight: 800;
    }
    .hh-price-block,
    .normal-price-block {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-top: 4px;
    }
    .original-price {
      text-decoration: line-through;
      color: #999;
      font-size: 13px;
    }
    .hh-price,
    .price {
      font-size: 16px;
      font-weight: 700;
      color: #0F6E56;
    }
    .hh-tag {
      background: #e6f7f0;
      color: #0F6E56;
      font-size: 11px;
      padding: 2px 8px;
      border-radius: 12px;
    }
    .bundle-suggestion {
      color: #9a3412 !important;
      background: #fff7ed;
      border: 1px solid #fed7aa;
      border-radius: 999px;
      display: inline-flex;
      padding: 3px 8px;
      width: max-content;
      max-width: 100%;
      overflow-wrap: anywhere;
      text-transform: none;
    }

    :host .booking-portal,
    :host .booking-page { background: #FAF8F6; }
    :host .portal-hero,
    :host .booking-hero,
    :host .booking-card,
    :host .booking-panel,
    :host .summary-card,
    :host .service-card,
    :host .staff-card,
    :host .slot-card,
    :host form {
      border-color: rgba(75, 18, 56, 0.13) !important;
      border-radius: 14px !important;
      background: #fff !important;
      background-image: none !important;
      box-shadow: 0 1px 2px rgba(75, 18, 56, 0.03), 0 10px 26px rgba(75, 18, 56, 0.045) !important;
    }
    :host h1, :host h2, :host h3, :host strong { color: #151827; font-weight: 630; }
    :host p, :host span, :host small, :host label { color: #4B1238; }
    :host input, :host select, :host textarea { border-color: rgba(75, 18, 56, 0.14) !important; border-radius: 10px !important; background: #fff !important; }
    :host button { border-radius: 10px !important; font-weight: 580 !important; }
    :host .primary-button, :host button[type='submit'] { background: #5A153F !important; border-color: #5A153F !important; color: #fff !important; }
    :host .public-profile {
      background: linear-gradient(135deg, #ffffff 0%, #f8f1f5 58%, #efe8ee 100%) !important;
      color: #151827 !important;
    }
    :host .public-profile h1,
    :host .public-profile p,
    :host .profile-aside strong,
    :host .profile-aside span,
    :host .profile-aside small {
      color: #151827 !important;
    }
    :host .trust-row .badge {
      background: #172033 !important;
      border-color: rgba(255,255,255,.24) !important;
      color: #fff !important;
    }
    :host .pick-card,
    :host .service-card,
    :host .staff-card,
    :host .review-card {
      background: #fff !important;
      color: #172033 !important;
    }
    :host .pick-card span,
    :host .service-card span,
    :host .pick-card strong,
    :host .service-card strong,
    :host .staff-card strong,
    :host .review-card strong,
    :host .hh-price,
    :host .price {
      color: #f8fafc !important;
    }
    :host .pick-card small,
    :host .pick-card em,
    :host .service-card small,
    :host .service-card em,
    :host .staff-card span,
    :host .staff-card small,
    :host .review-card span,
    :host .review-card small {
      color: #cbd5e1 !important;
    }
    :host .form-panel .field > span {
      color: #f8fafc !important;
    }
    :host .form-panel input,
    :host .form-panel select,
    :host .form-panel textarea {
      color: #172033 !important;
      background: #fff !important;
    }
    @media (max-width: 760px) {
      .public-profile {
        grid-template-columns: 1fr;
      }
      .profile-aside {
        border-left: 0;
        border-top: 1px solid rgba(75, 18, 56, 0.18);
      }
      .profile-main h1 {
        font-size: 2.4rem;
      }
    }
  `]
})
export class BookingPortalComponent implements OnInit {
  readonly context = signal<ApiRecord | null>(null);
  readonly profile = signal<ApiRecord | null>(null);
  readonly slots = signal<ApiRecord[]>([]);
  readonly selectedSlot = signal<ApiRecord | null>(null);
  readonly appointment = signal<ApiRecord | null>(null);
  readonly result = signal<ApiRecord | null>(null);
  readonly loading = signal(false);
  readonly error = signal('');

  readonly bookingForm = this.fb.group({ branchId: ['', Validators.required], serviceId: ['', Validators.required], staffId: [''], date: [new Date().toISOString().slice(0, 10), Validators.required] });
  readonly clientForm = this.fb.group({ name: ['Aarav Customer', Validators.required], phone: ['+91 90000 55555', Validators.required], email: ['customer@example.com'], notes: [''] });

  constructor(private readonly api: ApiService, private readonly fb: UntypedFormBuilder) {}

  ngOnInit(): void {
    this.load();
  }

  branches(): ApiRecord[] {
    const profileBranch = this.profile()?.branch;
    return profileBranch ? [profileBranch] : this.context()?.branches || [];
  }

  services(): ApiRecord[] {
    return this.profile()?.services?.length ? this.profile()?.services || [] : this.context()?.services || [];
  }

  staffForBranch(): ApiRecord[] {
    const rows = this.profile()?.staff?.length ? this.profile()?.staff || [] : this.context()?.staff || [];
    return rows.filter((person: ApiRecord) => !this.bookingForm.value.branchId || person.branchId === this.bookingForm.value.branchId);
  }

  load(): void {
    this.loading.set(true);
    this.api.list<ApiRecord>('booking-portal/context').subscribe({
      next: (context) => {
        this.context.set(context);
        if (context.branches?.[0]) this.bookingForm.patchValue({ branchId: context.branches[0].id });
        if (context.services?.[0]) this.bookingForm.patchValue({ serviceId: context.services[0].id });
        this.loading.set(false);
        this.loadPublicProfile();
        this.findSlots();
      },
      error: (error) => {
        this.error.set(error?.error?.error || 'Unable to load booking portal');
        this.loading.set(false);
      }
    });
  }

  loadPublicProfile(): void {
    this.api.list<ApiRecord>(`booking-profile/${this.tenantSlug()}`).subscribe({
      next: (profile) => {
        this.profile.set(profile);
        const branchId = profile.branch?.id || this.bookingForm.value.branchId || '';
        const serviceId = profile.services?.some((service: ApiRecord) => service.id === this.bookingForm.value.serviceId)
          ? this.bookingForm.value.serviceId
          : profile.services?.[0]?.id || this.bookingForm.value.serviceId || '';
        const staffId = profile.staff?.some((person: ApiRecord) => person.id === this.bookingForm.value.staffId)
          ? this.bookingForm.value.staffId
          : '';
        this.bookingForm.patchValue({ branchId, serviceId, staffId });
        this.slots.set([]);
        this.selectedSlot.set(null);
        this.findSlots();
      },
      error: () => {
        this.profile.set(null);
      }
    });
  }

  findSlots(): void {
    if (this.bookingForm.invalid) return;
    this.api.post<ApiRecord>('booking-portal/slots', this.bookingForm.value).subscribe({
      next: (response) => {
        this.slots.set(response.recommendations || []);
        this.selectedSlot.set((response.recommendations || [])[0] || null);
      },
      error: (error) => this.error.set(error?.error?.error || 'Unable to find slots')
    });
  }

  selectSlot(slot: ApiRecord): void {
    this.selectedSlot.set(slot);
  }

  confirm(): void {
    if (!this.selectedSlot() || this.clientForm.invalid) return;
    this.api.post<ApiRecord>('booking-portal/confirm', {
      branchId: this.bookingForm.value.branchId,
      serviceId: this.bookingForm.value.serviceId,
      staffId: this.bookingForm.value.staffId,
      slot: this.selectedSlot(),
      client: this.clientForm.value,
      paymentMode: 'pay-at-salon'
    }).subscribe((response) => {
      this.result.set(response);
      this.appointment.set(response.appointment);
    });
  }

  cancel(): void {
    const appt = this.appointment();
    if (!appt) return;
    this.api.patch<ApiRecord>(`booking-portal/appointments/${appt.id}/cancel`, { reason: 'Customer portal cancellation' }).subscribe((response) => {
      this.result.set(response);
      this.appointment.set(response.appointment);
    });
  }

  reschedule(): void {
    const appt = this.appointment();
    if (!appt || !this.selectedSlot()) return;
    this.api.patch<ApiRecord>(`booking-portal/appointments/${appt.id}/reschedule`, { slot: this.selectedSlot() }).subscribe((response) => {
      this.result.set(response);
      this.appointment.set(response.appointment);
    });
  }

  branchName(id: string): string {
    return this.branches().find((branch) => branch.id === id)?.name || id;
  }

  staffName(id: string): string {
    return this.staffForBranch().find((person: ApiRecord) => person.id === id)?.name || id;
  }

  branch(): ApiRecord {
    return this.profile()?.branch || this.branches()[0] || {};
  }

  reviews(): ApiRecord[] {
    return this.profile()?.reviews?.latest || [];
  }

  salonPicks(): ApiRecord[] {
    return this.profile()?.salonPicks?.length ? this.profile()?.salonPicks || [] : this.services().slice(0, 4);
  }

  price(service: ApiRecord): number {
    return Number(service.pricePaise || 0) ? Number(service.pricePaise || 0) / 100 : Number(service.price || 0);
  }

  servicePricePaise(service: ApiRecord): number {
    return Number(service.pricePaise || 0) || Math.round(Number(service.price || 0) * 100);
  }

  selectedService(): ApiRecord {
    const serviceId = String(this.bookingForm.value.serviceId || '');
    return this.services().find((service) => String(service.id) === serviceId) || {};
  }

  selectedServicePricePaise(): number {
    const service = this.selectedService();
    return service.id ? this.servicePricePaise(service) : 0;
  }

  serviceOptionLabel(service: ApiRecord): string {
    const finalPaise = service.happyHour?.finalPricePaise || this.servicePricePaise(service);
    const suffix = service.happyHour ? ` · Happy Hours ${this.happyHourLabel(service)}` : '';
    return `${service.name} · ₹${Math.round(finalPaise / 100)}${suffix}`;
  }

  happyHourLabel(service: ApiRecord): string {
    const hh = service.happyHour || {};
    if (hh.discountType === 'percent') return `${hh.discountValue}% off`;
    return `₹${Math.round(Number(hh.discountValue || 0) / 100)} off`;
  }

  bundleNames(service: ApiRecord): string {
    return (service.bundleSuggestion?.addServiceNames || service.bundleSuggestion?.addServiceIds || []).slice(0, 2).join(', ');
  }

  bundleOfferLabel(service: ApiRecord): string {
    const suggestion = service.bundleSuggestion || {};
    if (suggestion.percentOff) return `${suggestion.percentOff}% combo`;
    if (suggestion.bundlePricePaise) return `₹${Math.round(Number(suggestion.bundlePricePaise || 0) / 100)} combo`;
    return 'combo price';
  }

  serviceStaffNames(service: ApiRecord): string {
    const names = (service.staff || []).map((person: ApiRecord) => person.name).filter(Boolean);
    return names.length ? names.slice(0, 3).join(', ') : 'Any professional';
  }

  googleReviewLabel(): string {
    const reviews = this.profile()?.reviews || {};
    const rating = Number(reviews.googleRating || reviews.rating || 0);
    const count = Number(reviews.googleReviewCount || reviews.count || 0);
    return rating ? `${rating.toFixed(1)} from ${count} review(s)` : 'Google review setup ready';
  }

  tenantSlug(): string {
    const tenant = this.context()?.tenant || {};
    return tenant.slug || tenant.id || 'tenant_aura';
  }
}
