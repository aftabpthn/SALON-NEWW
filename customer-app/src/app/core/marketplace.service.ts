import { Injectable, computed, signal } from "@angular/core";
import { firstValueFrom } from "rxjs";
import {
  AvailabilityDay,
  AvailabilityQuery,
  Booking,
  Business,
  Category,
  CreateBookingPayload,
  CustomerAccountModule,
  CustomerFavorite,
  CustomerGiftCard,
  CustomerInvoice,
  CustomerMembership,
  CustomerMembershipPlan,
  CustomerPaymentLink,
  CustomerPrimarySalon,
  CustomerProfile,
  CustomerSalonRelationship,
  CustomerSalonsResponse,
  CustomerWaitlistEntry,
  JoinWaitlistPayload,
  PurchaseGiftCardPayload,
  RedeemGiftCardPayload,
  RedeemGiftCardResponse,
  RescheduleBookingPayload,
  SearchBusinessesParams
} from "./api.types";
import { AuthService } from "./auth.service";
import { CustomerApiService } from "./customer-api.service";

@Injectable({ providedIn: "root" })
export class MarketplaceService {
  private readonly loadingCount = signal(0);
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
  readonly customer = computed(() => this.auth.customer());
  readonly isAuthenticated = computed(() => this.auth.isAuthenticated());
  readonly mySalons = signal<CustomerSalonRelationship[]>([]);
  readonly primarySalon = signal<CustomerPrimarySalon | null>(null);
  readonly shouldPromptPrimary = signal(false);
  readonly suggestedSalon = signal<CustomerSalonRelationship | null>(null);
  private favoritesLoaded = false;

  constructor(private readonly api: CustomerApiService, private readonly auth: AuthService) {}

  async loadPublicBusinesses(params: SearchBusinessesParams = {}): Promise<Business[]> {
    return this.run("Unable to load businesses", async () => {
      const rows = (await firstValueFrom(this.api.listPublicBusinesses(params))).map((business) => this.normalizeBusiness(business));
      this.businesses.set(rows);
      return rows;
    });
  }

  async searchBusinesses(params: SearchBusinessesParams = {}): Promise<Business[]> {
    return this.run("Search service is unavailable. Please try again.", async () => {
      const rows = (await firstValueFrom(this.api.searchPublicBusinesses(params))).map((business) => this.normalizeBusiness(business));
      this.businesses.set(rows);
      return rows;
    });
  }

  async loadCategories(): Promise<Category[]> {
    return this.run("Unable to load categories", async () => {
      const rows = await firstValueFrom(this.api.listPublicCategories());
      this.categories.set(rows);
      return rows;
    });
  }

  async loadBusiness(slug: string): Promise<Business> {
    return this.run("Unable to load business profile", async () => {
      const [business, services, staff, reviews] = await Promise.all([
        firstValueFrom(this.api.getPublicBusiness(slug)),
        firstValueFrom(this.api.getPublicBusinessServices(slug)),
        firstValueFrom(this.api.getPublicBusinessStaff(slug)),
        firstValueFrom(this.api.listBusinessReviews(slug)).catch(() => [])
      ]);
      const profile: Business = this.normalizeBusiness({ ...business, services, staff, reviews });
      this.selectedBusiness.set(profile);
      this.businesses.update((rows) => {
        const index = rows.findIndex((row) => row.slug === slug || row.id === profile.id);
        if (index === -1) return [profile, ...rows];
        return rows.map((row, rowIndex) => rowIndex === index ? profile : row);
      });
      return profile;
    });
  }

  findBusiness(slug: string | null): Business | null {
    if (!slug) return this.selectedBusiness();
    const selected = this.selectedBusiness();
    if (selected?.slug === slug || selected?.id === slug) return selected;
    return this.businesses().find((business) => business.slug === slug || business.id === slug) ?? null;
  }

  async loadAvailability(slug: string, query: AvailabilityQuery): Promise<AvailabilityDay[]> {
    return this.run("Unable to load availability", async () => {
      const rows = await firstValueFrom(this.api.getAvailability(slug, query));
      this.availability.set(rows);
      return rows;
    });
  }

  async loadBookings(status?: "upcoming" | "past" | "cancelled"): Promise<Booking[]> {
    return this.run("Unable to load bookings", async () => {
      const rows = await firstValueFrom(this.api.listBookings(status));
      this.bookings.set(rows);
      return rows;
    });
  }

  async loadBooking(id: string): Promise<Booking> {
    return this.run("Unable to load booking", async () => {
      const booking = await firstValueFrom(this.api.getBooking(id));
      this.selectedBooking.set(booking);
      this.bookings.update((rows) => {
        const index = rows.findIndex((row) => row.id === booking.id);
        if (index === -1) return [booking, ...rows];
        return rows.map((row, rowIndex) => rowIndex === index ? booking : row);
      });
      return booking;
    });
  }

  findBooking(id: string | null): Booking | null {
    if (!id) return this.selectedBooking() ?? this.latestBooking();
    return this.selectedBooking()?.id === id ? this.selectedBooking() : this.bookings().find((booking) => booking.id === id) ?? null;
  }

  async createBooking(payload: CreateBookingPayload): Promise<Booking> {
    return this.run("Unable to create booking", async () => {
      const booking = await firstValueFrom(this.api.createBooking(payload));
      this.latestBooking.set(booking);
      this.bookings.update((rows) => [booking, ...rows.filter((row) => row.id !== booking.id)]);
      return booking;
    });
  }

  async cancelBooking(id: string): Promise<Booking> {
    return this.run("Unable to cancel booking", async () => {
      const booking = await firstValueFrom(this.api.cancelBooking(id));
      this.replaceBooking(booking);
      return booking;
    });
  }

  async rescheduleBooking(id: string, payload: RescheduleBookingPayload): Promise<Booking> {
    return this.run("Unable to reschedule booking", async () => {
      const booking = await firstValueFrom(this.api.rescheduleBooking(id, payload));
      this.replaceBooking(booking);
      return booking;
    });
  }

  async joinBookingWaitlist(id: string, payload: JoinWaitlistPayload = {}): Promise<CustomerWaitlistEntry> {
    return this.run("Unable to join waitlist", () => firstValueFrom(this.api.joinBookingWaitlist(id, payload)));
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
    return this.run("Unable to load customer records", async () => {
      const data = await this.accountModuleRequest(slug);
      this.accountModule.set(data);
      return data;
    });
  }

  async loadMembershipPlans(branchId?: string): Promise<CustomerMembershipPlan[]> {
    return this.run("Unable to load memberships", async () => {
      const rows = await firstValueFrom(this.api.listMembershipPlans({ branchId }));
      this.membershipPlans.set(rows);
      return rows;
    });
  }

  async buyMembership(planId: string, branchId?: string): Promise<CustomerMembership> {
    return this.run("Unable to buy membership", async () => {
      const result = await firstValueFrom(this.api.buyMembership(planId, branchId));
      this.mergeAccountList("memberships", result.membership);
      return result.membership;
    });
  }

  // ─── Customer-Salon Relationships ────────────────────────────────
  async loadMySalons(): Promise<CustomerSalonsResponse> {
    return this.run("Unable to load your salons", async () => {
      const response = await firstValueFrom(this.api.getMySalons());
      this.mySalons.set(response.salons || []);
      this.primarySalon.set(response.primarySalon);
      this.shouldPromptPrimary.set(response.shouldPromptPrimary);
      this.suggestedSalon.set(response.suggestedSalon);
      return response;
    });
  }

  async setPrimarySalon(tenantId: string, branchId: string, businessId: string, businessName: string): Promise<CustomerPrimarySalon> {
    return this.run("Unable to set primary salon", async () => {
      const { primarySalon } = await firstValueFrom(this.api.setPrimarySalon(tenantId, { branchId, businessId, businessName, reason: "manual" }));
      this.primarySalon.set(primarySalon);
      this.shouldPromptPrimary.set(false);
      this.suggestedSalon.set(null);
      return primarySalon;
    });
  }

  async removePrimarySalon(): Promise<void> {
    return this.run("Unable to remove primary salon", async () => {
      await firstValueFrom(this.api.removePrimarySalon());
      this.primarySalon.set(null);
    });
  }

  async recordSalonVisit(tenantId: string, branchId: string, businessId: string, businessName: string): Promise<void> {
    return this.run("Unable to record salon visit", async () => {
      const response = await firstValueFrom(this.api.recordSalonVisit(tenantId, { branchId, businessId, businessName }));
      if (response.shouldPromptPrimary) {
        this.shouldPromptPrimary.set(true);
        this.suggestedSalon.set(response.suggestedSalon as CustomerSalonRelationship | null);
      }
    });
  }

  hasPrimarySalon(): boolean {
    return this.primarySalon() !== null;
  }

  async purchaseGiftCard(payload: PurchaseGiftCardPayload): Promise<CustomerGiftCard> {
    return this.run("Unable to purchase gift card", async () => {
      const giftCard = await firstValueFrom(this.api.purchaseGiftCard(payload));
      this.mergeAccountList("gift-cards", giftCard);
      return giftCard;
    });
  }

  async redeemGiftCard(payload: RedeemGiftCardPayload): Promise<RedeemGiftCardResponse> {
    return this.run("Unable to redeem gift card", async () => {
      const result = await firstValueFrom(this.api.redeemGiftCard(payload));
      await Promise.all([
        this.loadAccountModule("gift-cards").catch(() => null),
        this.loadAccountModule("invoices").catch(() => null),
        this.loadAccountModule("payments").catch(() => null)
      ]);
      return result;
    });
  }

  async createInvoicePaymentLink(invoiceId: string, amountPaise?: number): Promise<CustomerPaymentLink> {
    return this.run("Unable to create payment link", () => firstValueFrom(this.api.createInvoicePaymentLink(invoiceId, amountPaise)));
  }

  formatMoney(pricePaise: number): string {
    return (pricePaise / 100).toLocaleString("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });
  }

  private replaceBooking(booking: Booking) {
    this.selectedBooking.update((current) => current?.id === booking.id ? booking : current);
    this.latestBooking.update((current) => current?.id === booking.id ? booking : current);
    this.bookings.update((rows) => rows.map((row) => row.id === booking.id ? booking : row));
  }

  private normalizeBusiness(business: Business): Business {
    return {
      ...business,
      galleryImages: business.galleryImages ?? [],
      categories: business.categories ?? [],
      services: business.services ?? [],
      staff: business.staff ?? [],
      reviews: business.reviews ?? [],
      policies: business.policies ?? [],
      businessHours: business.businessHours ?? []
    };
  }

  private accountModuleRequest(slug: string): Promise<CustomerAccountModule> {
    if (slug === "rewards") return firstValueFrom(this.api.getRewards());
    if (slug === "wallet") return firstValueFrom(this.api.getWallet());
    if (slug === "memberships") return firstValueFrom(this.api.listMemberships());
    if (slug === "packages") return firstValueFrom(this.api.listPackages());
    if (slug === "gift-cards") return firstValueFrom(this.api.listGiftCards());
    if (slug === "payments") return firstValueFrom(this.api.listPayments());
    if (slug === "notifications") return firstValueFrom(this.api.listNotifications());
    if (slug === "invoices") return firstValueFrom(this.api.listInvoices());
    return Promise.resolve([]);
  }

  private mergeAccountList(slug: "memberships" | "gift-cards" | "invoices", item: CustomerMembership | CustomerGiftCard | CustomerInvoice) {
    this.accountModule.update((current) => {
      if (!Array.isArray(current)) return current;
      const next = [item, ...current.filter((row) => {
        return !(row && typeof row === "object" && "id" in row && row.id === item.id);
      })];
      return next as CustomerAccountModule;
    });
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
