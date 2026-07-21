import { Injectable, computed, signal } from "@angular/core";
import { firstValueFrom } from "rxjs";
import {
  AvailabilityDay,
  AvailabilityQuery,
  Booking,
  Business,
  Category,
  CreateBookingPayload,
  CustomerBookingCheckInPayload,
  CustomerBookingContactlessPayload,
  CustomerBookingSelfPayPayload,
  CustomerAccountModule,
  CustomerCommerceCheckout,
  CustomerFavorite,
  CustomerFamilyMemberPayload,
  CustomerGoalPayload,
  CustomerInvoice,
  CustomerMembershipPlan,
  CustomerPackagePlan,
  CustomerPayment,
  CustomerPaymentLink,
  CustomerPaymentMethod,
  CustomerProfile,
  CustomerProfileExtensionRecord,
  CustomerPushProof,
  CustomerRefund,
  CustomerSupportMessagePayload,
  CustomerSupportTicketPayload,
  CustomerWaitlistEntry,
  JoinWaitlistPayload,
  PurchaseGiftCardPayload,
  PurchasePackagePayload,
  RedeemGiftCardPayload,
  RedeemGiftCardResponse,
  RedeemLoyaltyPayload,
  RedeemLoyaltyResponse,
  RescheduleBookingPayload,
  SearchBusinessesParams
} from "./api.types";
import { AuthService } from "./auth.service";
import { CustomerApiService } from "./customer-api.service";

type CacheEntry<T> = {
  expiresAt: number;
  value?: T;
  promise?: Promise<T>;
};

@Injectable({ providedIn: "root" })
export class MarketplaceService {
  private readonly loadingCount = signal(0);
  private readonly requestCache = new Map<string, CacheEntry<unknown>>();
  readonly loading = computed(() => this.loadingCount() > 0);
  readonly error = signal("");
  readonly businesses = signal<Business[]>([]);
  readonly categories = signal<Category[]>([]);
  readonly favorites = signal<CustomerFavorite[]>([]);
  readonly selectedBusiness = signal<Business | null>(null);
  readonly bookings = signal<Booking[]>([]);
  readonly selectedBooking = signal<Booking | null>(null);
  readonly latestBooking = signal<Booking | null>(null);
  readonly availability = signal<AvailabilityDay[]>([]);
  readonly accountModule = signal<CustomerAccountModule | null>(null);
  readonly membershipPlans = signal<CustomerMembershipPlan[]>([]);
  readonly packagePlans = signal<CustomerPackagePlan[]>([]);
  readonly customer = computed(() => this.auth.customer());
  readonly isAuthenticated = computed(() => this.auth.isAuthenticated());
  private favoritesLoaded = false;

  constructor(private readonly api: CustomerApiService, private readonly auth: AuthService) {}

  async loadPublicBusinesses(params: SearchBusinessesParams = {}): Promise<Business[]> {
    return this.cached(
      this.cacheKey("businesses", params),
      20_000,
      "Unable to load businesses",
      async () => (await firstValueFrom(this.api.listPublicBusinesses(params))).map((business) => this.normalizeBusiness(business)),
      (rows) => this.businesses.set(rows)
    );
  }

  async searchBusinesses(params: SearchBusinessesParams = {}): Promise<Business[]> {
    return this.cached(
      this.cacheKey("business-search", params),
      10_000,
      "Search service is unavailable. Please try again.",
      async () => (await firstValueFrom(this.api.searchPublicBusinesses(params))).map((business) => this.normalizeBusiness(business)),
      (rows) => this.businesses.set(rows)
    );
  }

  async loadCategories(): Promise<Category[]> {
    return this.cached(
      "categories",
      60_000,
      "Unable to load categories",
      () => firstValueFrom(this.api.listPublicCategories()),
      (rows) => this.categories.set(rows)
    );
  }

  async loadBusiness(slug: string): Promise<Business> {
    return this.cached(
      `business:${slug}`,
      30_000,
      "Unable to load business profile",
      async () => {
        const [business, services, staff, reviews] = await Promise.all([
          firstValueFrom(this.api.getPublicBusiness(slug)),
          firstValueFrom(this.api.getPublicBusinessServices(slug)),
          firstValueFrom(this.api.getPublicBusinessStaff(slug)),
          firstValueFrom(this.api.listBusinessReviews(slug)).catch(() => [])
        ]);
        return this.normalizeBusiness({ ...business, services, staff, reviews });
      },
      (profile) => {
      this.selectedBusiness.set(profile);
      this.businesses.update((rows) => {
        const index = rows.findIndex((row) => row.slug === slug || row.id === profile.id);
        if (index === -1) return [profile, ...rows];
        return rows.map((row, rowIndex) => rowIndex === index ? profile : row);
      });
      }
    );
  }

  findBusiness(slug: string | null): Business | null {
    if (!slug) return this.selectedBusiness();
    const selected = this.selectedBusiness();
    if (selected && this.matchesBusinessIdentifier(selected, slug)) return selected;
    return this.businesses().find((business) => this.matchesBusinessIdentifier(business, slug)) ?? null;
  }

  private matchesBusinessIdentifier(business: Business, identifier: string): boolean {
    return business.slug === identifier
      || business.id === identifier
      || business.branchId === identifier
      || business.branchCode === identifier;
  }

  async loadAvailability(slug: string, query: AvailabilityQuery): Promise<AvailabilityDay[]> {
    return this.cached(
      `availability:${slug}:${this.cacheKey("", query)}`,
      10_000,
      "Unable to load availability",
      () => firstValueFrom(this.api.getAvailability(slug, query)),
      (rows) => this.availability.set(rows)
    );
  }

  async loadBookings(status?: "upcoming" | "past" | "cancelled"): Promise<Booking[]> {
    return this.cached(
      `bookings:${status || "all"}`,
      15_000,
      "Unable to load bookings",
      () => firstValueFrom(this.api.listBookings(status)),
      (rows) => this.bookings.set(rows)
    );
  }

  async loadBooking(id: string): Promise<Booking> {
    return this.cached(
      `booking:${id}`,
      15_000,
      "Unable to load booking",
      () => firstValueFrom(this.api.getBooking(id)),
      (booking) => this.replaceBooking(booking)
    );
  }

  async loadContactlessBooking(id: string): Promise<Booking> {
    return this.cached(
      `contactless:${id}`,
      10_000,
      "Unable to load contactless journey",
      () => firstValueFrom(this.api.getBookingContactless(id)),
      (booking) => this.replaceBooking(booking)
    );
  }

  async loadBookingReceiptHtml(id: string): Promise<string> {
    return this.run("Unable to load digital receipt", () => firstValueFrom(this.api.getBookingReceiptHtml(id)));
  }

  findBooking(id: string | null): Booking | null {
    if (!id) return this.selectedBooking() ?? this.latestBooking();
    return this.selectedBooking()?.id === id ? this.selectedBooking() : this.bookings().find((booking) => booking.id === id) ?? null;
  }

  async createBooking(payload: CreateBookingPayload): Promise<Booking> {
    return this.run("Unable to create booking", async () => {
      const booking = await firstValueFrom(this.api.createBooking(payload));
      this.invalidateBookingData(booking.id);
      this.latestBooking.set(booking);
      this.bookings.update((rows) => [booking, ...rows.filter((row) => row.id !== booking.id)]);
      return booking;
    });
  }

  async createBookingPaymentLink(bookingId: string): Promise<CustomerPaymentLink> {
    return this.run("Unable to create the deposit payment link", async () => {
      const payment = await firstValueFrom(this.api.createBookingPaymentLink(bookingId));
      const paymentUrl = payment.url || payment.shortUrl || "";
      this.invalidateBookingData(bookingId);
      this.bookings.update((rows) => rows.map((booking) => booking.id === bookingId
        ? { ...booking, paymentStatus: "pending", paymentUrl, depositAmountPaise: payment.amountPaise }
        : booking));
      this.latestBooking.update((booking) => booking?.id === bookingId
        ? { ...booking, paymentStatus: "pending", paymentUrl, depositAmountPaise: payment.amountPaise }
        : booking);
      return payment;
    });
  }

  async submitBookingContactlessForm(bookingId: string, payload: CustomerBookingContactlessPayload): Promise<void> {
    return this.run("Unable to save contactless form", async () => {
      await firstValueFrom(this.api.submitBookingContactlessForm(bookingId, payload));
      this.invalidateBookingData(bookingId);
      await this.loadContactlessBooking(bookingId);
    });
  }

  async checkInBooking(bookingId: string, payload: CustomerBookingCheckInPayload): Promise<void> {
    return this.run("Unable to check in", async () => {
      await firstValueFrom(this.api.checkInBooking(bookingId, payload));
      this.invalidateBookingData(bookingId);
      await this.loadContactlessBooking(bookingId);
    });
  }

  async createBookingSelfPayLink(bookingId: string, payload: CustomerBookingSelfPayPayload): Promise<CustomerPaymentLink> {
    return this.run("Unable to create self-pay link", async () => {
      const link = await firstValueFrom(this.api.createBookingSelfPayLink(bookingId, payload));
      this.invalidateBookingData(bookingId);
      this.invalidateAccountData("payments");
      await this.loadContactlessBooking(bookingId).catch(() => null);
      await this.loadAccountModule("payments").catch(() => null);
      return link;
    });
  }

  async openBookingChat(bookingId: string, body?: string): Promise<CustomerProfileExtensionRecord> {
    return this.run("Unable to open booking chat", async () => {
      const ticket = await firstValueFrom(this.api.openBookingChat(bookingId, body));
      this.invalidateBookingData(bookingId);
      this.invalidateAccountData("support");
      await this.loadContactlessBooking(bookingId).catch(() => null);
      await this.loadAccountModule("support").catch(() => null);
      return ticket;
    });
  }

  async cancelBooking(id: string): Promise<Booking> {
    return this.run("Unable to cancel booking", async () => {
      const booking = await firstValueFrom(this.api.cancelBooking(id));
      this.invalidateBookingData(id);
      this.replaceBooking(booking);
      return booking;
    });
  }

  async rescheduleBooking(id: string, payload: RescheduleBookingPayload): Promise<{ booking: Booking | null; pendingApproval: boolean }> {
    return this.run("Unable to reschedule booking", async () => {
      const result = await firstValueFrom(this.api.rescheduleBooking(id, payload));
      this.invalidateBookingData(id);
      if (result.booking) this.replaceBooking(result.booking);
      return result;
    });
  }

  async joinBookingWaitlist(id: string, payload: JoinWaitlistPayload = {}): Promise<CustomerWaitlistEntry> {
    return this.run("Unable to join waitlist", async () => {
      const waitlist = await firstValueFrom(this.api.joinBookingWaitlist(id, payload));
      this.invalidateBookingData(id);
      return waitlist;
    });
  }

  async acceptWaitlistOffer(id: string): Promise<Booking> {
    return this.run("Unable to accept waitlist offer", async () => {
      const booking = await firstValueFrom(this.api.acceptWaitlistOffer(id));
      this.invalidateBookingData(id);
      this.replaceBooking(booking);
      return booking;
    });
  }

  async declineWaitlistOffer(id: string): Promise<void> {
    return this.run("Unable to decline waitlist offer", async () => {
      await firstValueFrom(this.api.declineWaitlistOffer(id));
      this.invalidateBookingData(id);
      this.selectedBooking.update((booking) => booking?.id === id ? null : booking);
      this.latestBooking.update((booking) => booking?.id === id ? null : booking);
      this.bookings.update((rows) => rows.filter((booking) => booking.id !== id));
    });
  }

  async login(phone: string, channel: "sms" | "whatsapp" = "sms") {
    return this.auth.requestOtp(phone, channel);
  }

  async verifyOtp(phone: string, otp: string) {
    return this.auth.verifyOtp(phone, otp);
  }

  async logout() {
    return this.run("Unable to logout", () => this.auth.logout());
  }

  async loadCustomer() {
    return this.run("Unable to load customer profile", () => this.auth.loadMe());
  }

  async loadFavorites(): Promise<CustomerFavorite[]> {
    return this.run("Unable to load saved salons", async () => {
      const rows = await firstValueFrom(this.api.listFavorites());
      this.favorites.set(rows);
      this.favoritesLoaded = true;
      return rows;
    });
  }

  async ensureFavorites(): Promise<CustomerFavorite[]> {
    if (!this.isAuthenticated()) return [];
    if (this.favoritesLoaded) return this.favorites();
    return this.loadFavorites();
  }

  isFavorite(businessId: string): boolean {
    return this.favorites().some((favorite) => favorite.businessId === businessId || favorite.business?.id === businessId || favorite.business?.slug === businessId);
  }

  async addFavorite(businessId: string): Promise<CustomerFavorite> {
    return this.run("Unable to save salon", async () => {
      const favorite = await firstValueFrom(this.api.addFavorite(businessId));
      this.favorites.update((rows) => [favorite, ...rows.filter((row) => row.businessId !== favorite.businessId)]);
      this.favoritesLoaded = true;
      return favorite;
    });
  }

  async removeFavorite(businessId: string): Promise<void> {
    return this.run("Unable to remove saved salon", async () => {
      await firstValueFrom(this.api.removeFavorite(businessId));
      this.favorites.update((rows) => rows.filter((row) => row.businessId !== businessId && row.business?.id !== businessId && row.business?.slug !== businessId));
      this.favoritesLoaded = true;
    });
  }

  async toggleFavorite(businessId: string): Promise<boolean> {
    if (this.isFavorite(businessId)) {
      await this.removeFavorite(businessId);
      return false;
    }
    await this.addFavorite(businessId);
    return true;
  }

  async updateCustomer(payload: Partial<CustomerProfile>): Promise<CustomerProfile> {
    return this.run("Unable to update customer profile", () => this.auth.updateMe(payload));
  }

  async requestProfileEmailCode(email: string) {
    return this.run("Unable to send email verification code", () => this.auth.requestProfileEmailCode(email));
  }

  async verifyProfileEmailCode(email: string, code: string): Promise<CustomerProfile> {
    return this.run("Unable to verify email code", () => this.auth.verifyProfileEmailCode(email, code));
  }

  async requestProfilePhoneOtp(phone: string, channel: "sms" | "whatsapp" = "sms") {
    return this.run("Unable to send mobile OTP", () => this.auth.requestProfilePhoneOtp(phone, channel));
  }

  async verifyProfilePhoneOtp(phone: string, otp: string): Promise<CustomerProfile> {
    return this.run("Unable to verify mobile OTP", () => this.auth.verifyProfilePhoneOtp(phone, otp));
  }

  async changePassword(currentPassword: string, newPassword: string): Promise<void> {
    return this.run("Unable to change password", () => this.auth.changePassword(currentPassword, newPassword));
  }

  async changePasswordWithPhoneOtp(phone: string, otp: string, newPassword: string): Promise<void> {
    return this.run("Unable to change password with mobile OTP", () => this.auth.changePasswordWithPhoneOtp(phone, otp, newPassword));
  }

  async deleteAccount(currentPassword = ""): Promise<void> {
    return this.run("Unable to delete account", () => this.auth.deleteAccount(currentPassword));
  }

  async loadAccountModule(slug: string): Promise<CustomerAccountModule> {
    return this.cached(
      `account:${slug}`,
      20_000,
      "Unable to load customer records",
      () => this.accountModuleRequest(slug),
      (data) => this.accountModule.set(data)
    );
  }

  async loadMembershipPlans(branchId?: string): Promise<CustomerMembershipPlan[]> {
    return this.run("Unable to load memberships", async () => {
      const rows = await firstValueFrom(this.api.listMembershipPlans({ branchId }));
      this.membershipPlans.set(rows);
      return rows;
    });
  }

  async buyMembership(planId: string, branchId?: string): Promise<CustomerCommerceCheckout> {
    return this.run("Unable to buy membership", () => firstValueFrom(this.api.buyMembership(planId, branchId)));
  }

  async freezeMembership(id: string, days: number, reason?: string): Promise<void> {
    return this.run("Unable to freeze membership", async () => {
      await firstValueFrom(this.api.freezeMembership(id, { days, reason }));
      this.invalidateAccountData("memberships");
      await this.loadAccountModule("memberships").catch(() => null);
    });
  }

  async resumeMembership(id: string): Promise<void> {
    return this.run("Unable to resume membership", async () => {
      await firstValueFrom(this.api.resumeMembership(id));
      this.invalidateAccountData("memberships");
      await this.loadAccountModule("memberships").catch(() => null);
    });
  }

  async cancelMembership(id: string, reason?: string): Promise<void> {
    return this.run("Unable to cancel membership", async () => {
      await firstValueFrom(this.api.cancelMembership(id, reason));
      this.invalidateAccountData("memberships");
      await this.loadAccountModule("memberships").catch(() => null);
    });
  }

  async updateMembershipAutoRenew(id: string, status: "active" | "paused" | "disabled"): Promise<void> {
    return this.run("Unable to update auto-renew", async () => {
      await firstValueFrom(this.api.updateMembershipAutoRenew(id, status));
      this.invalidateAccountData("memberships");
      await this.loadAccountModule("memberships").catch(() => null);
    });
  }

  async loadPackagePlans(branchId: string): Promise<CustomerPackagePlan[]> {
    return this.run("Unable to load packages", async () => {
      const rows = await firstValueFrom(this.api.listPackagePlans(branchId));
      this.packagePlans.set(rows);
      return rows;
    });
  }

  async buyPackage(payload: PurchasePackagePayload): Promise<CustomerCommerceCheckout> {
    return this.run("Unable to buy package", () => firstValueFrom(this.api.buyPackage(payload)));
  }

  async purchaseGiftCard(payload: PurchaseGiftCardPayload): Promise<CustomerCommerceCheckout> {
    return this.run("Unable to purchase gift card", () => firstValueFrom(this.api.purchaseGiftCard(payload)));
  }

  async claimGiftCard(code: string, branchId?: string): Promise<void> {
    return this.run("Unable to claim gift card", async () => {
      await firstValueFrom(this.api.claimGiftCard({ code, branchId }));
      this.invalidateAccountData("gift-cards");
      await this.loadAccountModule("gift-cards").catch(() => null);
    });
  }

  async redeemGiftCard(payload: RedeemGiftCardPayload): Promise<RedeemGiftCardResponse> {
    return this.run("Unable to redeem gift card", async () => {
      const result = await firstValueFrom(this.api.redeemGiftCard(payload));
      this.invalidateAccountData("gift-cards");
      await this.loadAccountModule("gift-cards").catch(() => null);
      return result;
    });
  }

  async redeemLoyalty(payload: RedeemLoyaltyPayload): Promise<RedeemLoyaltyResponse> {
    return this.run("Unable to redeem loyalty points", async () => {
      const result = await firstValueFrom(this.api.redeemLoyalty(payload));
      this.invalidateAccountData("rewards", "invoices");
      await Promise.all([
        this.loadAccountModule("rewards").catch(() => null),
        this.loadAccountModule("invoices").catch(() => null)
      ]);
      return result;
    });
  }

  async createInvoicePaymentLink(invoiceId: string, amountPaise?: number): Promise<CustomerPaymentLink> {
    return this.run("Unable to create payment link", () => firstValueFrom(this.api.createInvoicePaymentLink(invoiceId, amountPaise)));
  }

  async listCustomerInvoices(): Promise<CustomerInvoice[]> {
    return this.run("Unable to load customer invoices", () => firstValueFrom(this.api.listInvoices()));
  }

  async createSupportTicket(payload: CustomerSupportTicketPayload): Promise<CustomerProfileExtensionRecord> {
    return this.run("Unable to create support ticket", async () => {
      const ticket = await firstValueFrom(this.api.createSupportTicket(payload));
      this.invalidateAccountData("support");
      await this.loadAccountModule("support").catch(() => null);
      return ticket;
    });
  }

  async addSupportMessage(ticketId: string, payload: CustomerSupportMessagePayload): Promise<CustomerProfileExtensionRecord> {
    return this.run("Unable to add support message", async () => {
      const message = await firstValueFrom(this.api.addSupportMessage(ticketId, payload));
      this.invalidateAccountData("support");
      await this.loadAccountModule("support").catch(() => null);
      return message;
    });
  }

  async listSupportMessages(ticketId: string): Promise<CustomerProfileExtensionRecord[]> {
    return this.run("Unable to load booking chat", () => firstValueFrom(this.api.listSupportMessages(ticketId)));
  }

  async createReferralCode(branchId?: string): Promise<CustomerProfileExtensionRecord> {
    return this.run("Unable to create referral code", async () => {
      const code = await firstValueFrom(this.api.createReferralCode(branchId));
      this.invalidateAccountData("referrals");
      await this.loadAccountModule("referrals").catch(() => null);
      return code;
    });
  }

  async createFamilyMember(payload: CustomerFamilyMemberPayload): Promise<CustomerProfileExtensionRecord> {
    return this.run("Unable to save family profile", async () => {
      const member = await firstValueFrom(this.api.createFamilyMember(payload));
      this.invalidateAccountData("family");
      await this.loadAccountModule("family").catch(() => null);
      return member;
    });
  }

  async createGoal(payload: CustomerGoalPayload): Promise<CustomerProfileExtensionRecord> {
    return this.run("Unable to save beauty goal", async () => {
      const goal = await firstValueFrom(this.api.createGoal(payload));
      this.invalidateAccountData("goals");
      await this.loadAccountModule("goals").catch(() => null);
      return goal;
    });
  }

  formatMoney(pricePaise: number): string {
    return (pricePaise / 100).toLocaleString("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });
  }

  private replaceBooking(booking: Booking) {
    this.selectedBooking.set(booking);
    this.latestBooking.update((current) => current?.id === booking.id ? booking : current);
    this.bookings.update((rows) => rows.some((row) => row.id === booking.id) ? rows.map((row) => row.id === booking.id ? booking : row) : [booking, ...rows]);
  }

  private normalizeBusiness(business: Business): Business {
    return {
      ...business,
      slug: business.slug || business.id,
      branchId: business.branchId || business.id,
      category: business.category || business.categories?.[0] || "",
      description: business.description || "",
      address: business.address || "",
      area: business.area || "",
      city: business.city || "",
      ratingAverage: Number(business.ratingAverage || 0),
      ratingCount: Number(business.ratingCount || 0),
      isOpen: business.isOpen ?? true,
      hasOffer: business.hasOffer ?? false,
      startingPricePaise: Number(business.startingPricePaise || 0),
      galleryImages: business.galleryImages ?? [],
      categories: business.categories ?? [],
      services: (business.services ?? []).map((service) => ({
        ...service,
        durationMinutes: Number(service.durationMinutes || 0),
        pricePaise: Number(service.pricePaise || 0),
        addons: (service.addons ?? []).map((addon) => ({
          ...addon,
          durationMinutes: Number(addon.durationMinutes || 0),
          pricePaise: Number(addon.pricePaise || 0)
        }))
      })),
      staff: business.staff ?? [],
      reviews: business.reviews ?? [],
      policies: business.policies ?? [],
      businessHours: business.businessHours ?? [],
      paymentModes: business.paymentModes?.length ? business.paymentModes : ["pay_at_venue"]
    };
  }

  private accountModuleRequest(slug: string): Promise<CustomerAccountModule> {
    if (slug === "rewards") return firstValueFrom(this.api.getRewards());
    if (slug === "wallet") return firstValueFrom(this.api.getWallet());
    if (slug === "memberships") return firstValueFrom(this.api.listMemberships());
    if (slug === "packages") return firstValueFrom(this.api.listPackages());
    if (slug === "gift-cards") return firstValueFrom(this.api.listGiftCards());
    if (slug === "payments") return this.loadPaymentRecords();
    if (slug === "notifications") return firstValueFrom(this.api.listNotifications());
    if (slug === "invoices") return firstValueFrom(this.api.listInvoices());
    if (slug === "support") return firstValueFrom(this.api.listSupportTickets());
    if (slug === "referrals") return firstValueFrom(this.api.listReferrals());
    if (slug === "offers") return firstValueFrom(this.api.listOffers());
    if (slug === "family") return firstValueFrom(this.api.listFamily());
    if (slug === "corporate") return firstValueFrom(this.api.listCorporate());
    if (slug === "gallery") return firstValueFrom(this.api.listGallery());
    if (slug === "goals") return firstValueFrom(this.api.listGoals());
    return Promise.resolve([]);
  }

  private async loadPaymentRecords(): Promise<Array<CustomerPayment | CustomerPaymentMethod | CustomerRefund | CustomerProfileExtensionRecord>> {
    const [payments, methods, refunds, proof] = await Promise.all([
      firstValueFrom(this.api.listPayments()),
      firstValueFrom(this.api.listPaymentMethods()).catch(() => [] as CustomerPaymentMethod[]),
      firstValueFrom(this.api.listRefunds()).catch(() => [] as CustomerRefund[]),
      firstValueFrom(this.api.getPushProof()).catch(() => null as CustomerPushProof | null)
    ]);
    const proofRecord: CustomerProfileExtensionRecord[] = proof ? [{
      id: "payment-provider-proof",
      recordType: "pushProof",
      title: "Runtime provider proof",
      status: proof.proofLevel,
      benefitLabel: `${proof.latestCustomerNotifications} notification(s), ${proof.paymentProviders.filter((provider) => provider.enabled && provider.webhookConfigured).length} payment provider(s) verified`,
      notes: proof.note
    }] : [];
    return [...payments, ...methods, ...refunds, ...proofRecord];
  }

  private cached<T>(
    key: string,
    ttlMs: number,
    fallback: string,
    action: () => Promise<T>,
    apply: (value: T) => void = () => undefined
  ): Promise<T> {
    const entry = this.requestCache.get(key) as CacheEntry<T> | undefined;
    const now = Date.now();
    if (entry?.value !== undefined && entry.expiresAt > now) {
      apply(entry.value);
      return Promise.resolve(entry.value);
    }
    if (entry?.promise) {
      return entry.promise.then((value) => {
        apply(value);
        return value;
      });
    }
    const promise = this.run(fallback, action)
      .then((value) => {
        this.requestCache.set(key, { value, expiresAt: Date.now() + ttlMs });
        apply(value);
        return value;
      })
      .catch((error) => {
        if ((this.requestCache.get(key) as CacheEntry<T> | undefined)?.promise === promise) this.requestCache.delete(key);
        throw error;
      });
    this.requestCache.set(key, { promise, expiresAt: now + ttlMs });
    return promise;
  }

  private cacheKey(prefix: string, value: unknown): string {
    return `${prefix}:${JSON.stringify(value ?? {})}`;
  }

  private clearCache(prefix?: string): void {
    if (!prefix) {
      this.requestCache.clear();
      return;
    }
    Array.from(this.requestCache.keys())
      .filter((key) => key.startsWith(prefix))
      .forEach((key) => this.requestCache.delete(key));
  }

  private invalidateBookingData(bookingId?: string): void {
    this.clearCache("bookings:");
    this.clearCache("availability:");
    if (!bookingId) {
      this.clearCache("booking:");
      this.clearCache("contactless:");
      return;
    }
    this.clearCache(`booking:${bookingId}`);
    this.clearCache(`contactless:${bookingId}`);
  }

  private invalidateAccountData(...slugs: string[]): void {
    if (!slugs.length) {
      this.clearCache("account:");
      return;
    }
    slugs.forEach((slug) => this.clearCache(`account:${slug}`));
  }

  private async run<T>(fallback: string, action: () => Promise<T>): Promise<T> {
    // Clear the error only when starting a fresh batch (no other request in flight),
    // and track loading with a counter so parallel calls don't flip it off early.
    if (this.loadingCount() === 0) this.error.set("");
    this.loadingCount.update((count) => count + 1);
    try {
      return await action();
    } catch (error) {
      const message = this.message(error, fallback);
      this.error.set(message);
      throw error;
    } finally {
      this.loadingCount.update((count) => Math.max(0, count - 1));
    }
  }

  private message(error: unknown, fallback: string): string {
    if (error instanceof Error) return this.cleanErrorMessage(error.message, fallback);
    if (typeof error === "object" && error) {
      const status = "status" in error ? Number((error as { status?: unknown }).status) : null;
      if (status === 0) return "Search service is unavailable. Please try again.";
      if ("message" in error) return this.cleanErrorMessage(String((error as { message?: unknown }).message || ""), fallback);
    }
    return fallback;
  }

  private cleanErrorMessage(message: string, fallback: string): string {
    if (!message) return fallback;
    if (message.startsWith("Http failure response") || message.includes("Unknown Error")) return fallback;
    return message;
  }
}
