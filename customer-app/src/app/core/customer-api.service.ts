import { HttpClient, HttpParams } from "@angular/common/http";
import { Injectable } from "@angular/core";
import { map, Observable, of } from "rxjs";
import { environment } from "../../environments/environment";
import {
  ApiEnvelope,
  ApiList,
  AuthSession,
  AvailabilityDay,
  AvailabilityQuery,
  Booking,
  Business,
  CancelBookingPayload,
  Category,
  CreateBookingPayload,
  CreateReviewPayload,
  CustomerBookingCheckInPayload,
  CustomerBookingCheckInResult,
  CustomerBookingContactlessPayload,
  CustomerBookingSelfPayPayload,
  CustomerFavorite,
  FieldJobTracking,
  CustomerCommerceCheckout,
  CustomerDeviceInfo,
  CustomerDeviceSession,
  CustomerDevSessionPayload,
  CustomerGiftCard,
  CustomerInvoice,
  CustomerFamilyMemberPayload,
  CustomerMembership,
  CustomerMembershipActionResponse,
  CustomerMembershipPlan,
  CustomerMarketingOffer,
  CustomerNotification,
  CustomerPackage,
  CustomerPackagePlan,
  CustomerPayment,
  CustomerPaymentLink,
  CustomerPaymentMethod,
  CustomerProfile,
  CustomerProfileExtensionRecord,
  CustomerPushProof,
  CustomerRefund,
  CustomerGoalPayload,
  CustomerRewardSummary,
  CustomerSupportMessagePayload,
  CustomerSupportTicketPayload,
  CustomerWallet,
  CustomerWaitlistEntry,
  FirebaseAuthPayload,
  JoinWaitlistPayload,
  KioskContext,
  KioskGuestSession,
  LiveConsultationRequest,
  LiveConsultationResponse,
  OtpRequestResponse,
  ClaimGiftCardPayload,
  PurchaseGiftCardPayload,
  PurchasePackagePayload,
  PurchaseProductPayload,
  RedeemGiftCardPayload,
  RedeemGiftCardResponse,
  RedeemLoyaltyPayload,
  RedeemLoyaltyResponse,
  RescheduleBookingPayload,
  SearchBusinessesParams,
  ServiceItem,
  StaffMember,
  BusinessReview,
  WebstoreProduct
} from "./api.types";

type ApiResponse<T> = T | ApiEnvelope<T>;

@Injectable({ providedIn: "root" })
export class CustomerApiService {
  private readonly baseUrl = environment.apiBaseUrl.replace(/\/$/, "");

  constructor(private readonly http: HttpClient) {}

  listPublicBusinesses(params: SearchBusinessesParams = {}): Observable<Business[]> {
    return this.http.get<ApiResponse<Business[] | ApiList<Business>>>(`${this.baseUrl}/marketplace/businesses`, { params: this.toParams(params) }).pipe(
      map((response) => this.unwrapList<Business>(response))
    );
  }

  getFieldJobTracking(token: string): Observable<FieldJobTracking> {
    return this.http.get<ApiResponse<FieldJobTracking>>(`${this.baseUrl}/operations/tracking/${encodeURIComponent(token)}`).pipe(
      map((response) => this.unwrap<FieldJobTracking>(response))
    );
  }

  getPublicBusiness(slug: string): Observable<Business> {
    return this.http.get<ApiResponse<Business>>(`${this.baseUrl}/marketplace/businesses/${encodeURIComponent(slug)}`).pipe(
      map((response) => this.unwrap<Business>(response))
    );
  }

  getPublicBusinessServices(slug: string): Observable<ServiceItem[]> {
    return this.http.get<ApiResponse<ServiceItem[] | ApiList<ServiceItem>>>(`${this.baseUrl}/marketplace/businesses/${encodeURIComponent(slug)}/services`).pipe(
      map((response) => this.unwrapList<ServiceItem>(response))
    );
  }

  getPublicBusinessProducts(slug: string): Observable<WebstoreProduct[]> {
    return this.http.get<ApiResponse<WebstoreProduct[] | ApiList<WebstoreProduct>>>(`${this.baseUrl}/marketplace/businesses/${encodeURIComponent(slug)}/products`).pipe(
      map((response) => this.unwrapList<WebstoreProduct>(response))
    );
  }

  getPublicBusinessStaff(slug: string): Observable<StaffMember[]> {
    return this.http.get<ApiResponse<StaffMember[] | ApiList<StaffMember>>>(`${this.baseUrl}/marketplace/businesses/${encodeURIComponent(slug)}/staff`).pipe(
      map((response) => this.unwrapList<StaffMember>(response))
    );
  }

  getAvailability(slug: string, params: AvailabilityQuery): Observable<AvailabilityDay[]> {
    return this.http.get<ApiResponse<AvailabilityDay[] | ApiList<AvailabilityDay> | { date?: string; slots?: unknown[] }>>(`${this.baseUrl}/marketplace/businesses/${encodeURIComponent(slug)}/availability`, {
      params: this.toParams({ serviceId: params.serviceId, date: params.date, count: 48 })
    }).pipe(
      map((response) => {
        const value = this.unwrap<AvailabilityDay[] | ApiList<AvailabilityDay> | { date?: string; slots?: unknown[] }>(response);
        if (Array.isArray(value)) return value;
        const record = value as ApiList<AvailabilityDay> & { date?: string; slots?: unknown[] };
        if (Array.isArray(record.slots)) return [this.marketplaceAvailabilityDay(record)];
        return record.rows ?? record.items ?? record.data ?? [];
      })
    );
  }

  listPublicCategories(): Observable<Category[]> {
    return this.http.get<ApiResponse<Category[] | ApiList<Category>>>(`${this.baseUrl}/marketplace/categories`).pipe(
      map((response) => this.unwrapList<Category>(response))
    );
  }

  listMembershipPlans(params: { branchId?: string } = {}): Observable<CustomerMembershipPlan[]> {
    if (!params.branchId) return of([]);
    return this.http.get<ApiResponse<CustomerMembershipPlan[] | ApiList<CustomerMembershipPlan>>>(`${this.baseUrl}/marketplace/businesses/${encodeURIComponent(params.branchId)}/membership-plans`).pipe(
      map((response) => this.unwrapList<CustomerMembershipPlan>(response))
    );
  }

  searchPublicBusinesses(params: SearchBusinessesParams = {}): Observable<Business[]> {
    return this.http.get<ApiResponse<Business[] | ApiList<Business>>>(`${this.baseUrl}/marketplace/businesses`, { params: this.toParams(params) }).pipe(
      map((response) => this.unwrapList<Business>(response))
    );
  }

  createLiveConsultation(payload: LiveConsultationRequest): Observable<LiveConsultationResponse> {
    return this.http.post<ApiResponse<LiveConsultationResponse>>(`${this.baseUrl}/public/live-consultations`, payload).pipe(
      map((response) => this.unwrap<LiveConsultationResponse>(response))
    );
  }

  requestOtp(phone: string, channel: "sms" | "whatsapp" = "sms"): Observable<OtpRequestResponse> {
    return this.http.post<ApiResponse<OtpRequestResponse>>(`${this.baseUrl}/customer/auth/request-otp`, { phone, channel }).pipe(
      map((response) => this.unwrap<OtpRequestResponse>(response))
    );
  }

  requestEmailCode(email: string): Observable<OtpRequestResponse> {
    return this.http.post<ApiResponse<OtpRequestResponse>>(`${this.baseUrl}/customer/auth/request-email-code`, { email }).pipe(
      map((response) => this.unwrap<OtpRequestResponse>(response))
    );
  }

  verifyOtp(phone: string, otp: string, device?: CustomerDeviceInfo): Observable<AuthSession> {
    return this.http.post<ApiResponse<AuthSession>>(`${this.baseUrl}/customer/auth/verify-otp`, { phone, code: otp, device: this.devicePayload(device) }).pipe(
      map((response) => this.unwrap<AuthSession>(response))
    );
  }

  verifyEmailCode(email: string, code: string, name = "", device?: CustomerDeviceInfo): Observable<AuthSession> {
    return this.http.post<ApiResponse<AuthSession>>(`${this.baseUrl}/customer/auth/verify-email-code`, { email, code, name, device: this.devicePayload(device) }).pipe(
      map((response) => this.unwrap<AuthSession>(response))
    );
  }

  exchangeFirebaseToken(payload: FirebaseAuthPayload): Observable<AuthSession> {
    return this.http.post<ApiResponse<AuthSession>>(`${this.baseUrl}/customer/auth/firebase`, { ...payload, device: this.devicePayload(payload.device) }).pipe(
      map((response) => this.unwrap<AuthSession>(response))
    );
  }

  listPublicOffers(branchId?: string): Observable<CustomerMarketingOffer[]> {
    return this.http.get<ApiResponse<CustomerMarketingOffer[] | ApiList<CustomerMarketingOffer>>>(`${this.baseUrl}/marketplace/offers`, {
      params: this.toParams({ branchId })
    }).pipe(map((response) => this.unwrapList<CustomerMarketingOffer>(response)));
  }

  listMarketingOffers(branchId?: string): Observable<CustomerMarketingOffer[]> {
    return this.http.get<ApiResponse<CustomerMarketingOffer[] | ApiList<CustomerMarketingOffer>>>(`${this.baseUrl}/customer/marketing-offers`, {
      params: this.toParams({ branchId })
    }).pipe(map((response) => this.unwrapList<CustomerMarketingOffer>(response)));
  }

  marketingOfferCreative(offerId: string): Observable<Blob> {
    return this.http.get(`${this.baseUrl}/customer/marketing-offers/${encodeURIComponent(offerId)}/creative`, { responseType: "blob" });
  }

  trackMarketingOfferClick(offerId: string, channel: string): Observable<void> {
    return this.http.post<ApiResponse<unknown>>(`${this.baseUrl}/customer/marketing-offers/events`, { offerId, channel }).pipe(map(() => undefined));
  }

  publicOfferCreativeUrl(offerId: string): string {
    return `${this.baseUrl}/marketplace/offers/${encodeURIComponent(offerId)}/creative`;
  }

  trackPublicOfferClick(offerId: string, channel: string): Observable<void> {
    return this.http.post<ApiResponse<unknown>>(`${this.baseUrl}/marketplace/offers/events`, { offerId, channel }).pipe(map(() => undefined));
  }

  issueDevSession(payload: CustomerDevSessionPayload, secret: string): Observable<AuthSession> {
    return this.http.post<ApiResponse<AuthSession>>(`${this.baseUrl}/customer/auth/dev-session`, { ...payload, device: this.devicePayload(payload.device) }, {
      headers: { "x-dev-session-secret": secret }
    }).pipe(
      map((response) => this.unwrap<AuthSession>(response))
    );
  }

  refreshCustomerSession(refreshToken: string, device?: CustomerDeviceInfo): Observable<AuthSession> {
    return this.http.post<ApiResponse<AuthSession>>(`${this.baseUrl}/customer/auth/refresh`, { refreshToken, device: this.devicePayload(device) }).pipe(
      map((response) => this.unwrap<AuthSession>(response))
    );
  }

  logout(refreshToken: string): Observable<void> {
    return this.http.post<ApiResponse<void>>(`${this.baseUrl}/customer/auth/logout`, { refreshToken }).pipe(
      map(() => undefined)
    );
  }

  listDevices(): Observable<CustomerDeviceSession[]> {
    return this.http.get<ApiResponse<{ currentSessionId: string; sessions: CustomerDeviceSession[] }>>(`${this.baseUrl}/customer/sessions`).pipe(
      map((response) => {
        const data = this.unwrap<{ currentSessionId: string; sessions: CustomerDeviceSession[] }>(response);
        return data.sessions.map((session) => ({ ...session, current: session.id === data.currentSessionId }));
      })
    );
  }

  logoutDevice(sessionId: string): Observable<void> {
    return this.http.delete<ApiResponse<void>>(`${this.baseUrl}/customer/sessions/${encodeURIComponent(sessionId)}`).pipe(
      map(() => undefined)
    );
  }

  logoutAllDevices(): Observable<void> {
    return this.http.delete<ApiResponse<void>>(`${this.baseUrl}/customer/sessions`).pipe(
      map(() => undefined)
    );
  }

  getMe(): Observable<CustomerProfile> {
    return this.http.get<ApiResponse<CustomerProfile>>(`${this.baseUrl}/customer/me`).pipe(
      map((response) => this.unwrap<CustomerProfile>(response))
    );
  }

  updateMe(payload: Partial<CustomerProfile>): Observable<CustomerProfile> {
    return this.http.patch<ApiResponse<CustomerProfile>>(`${this.baseUrl}/customer/me`, payload).pipe(
      map((response) => this.unwrap<CustomerProfile>(response))
    );
  }

  requestProfileEmailCode(email: string): Observable<OtpRequestResponse> {
    return this.http.post<ApiResponse<OtpRequestResponse>>(`${this.baseUrl}/customer/me/email/request-code`, { email }).pipe(
      map((response) => this.unwrap<OtpRequestResponse>(response))
    );
  }

  verifyProfileEmailCode(email: string, code: string): Observable<CustomerProfile> {
    return this.http.post<ApiResponse<CustomerProfile>>(`${this.baseUrl}/customer/me/email/verify`, { email, code }).pipe(
      map((response) => this.unwrap<CustomerProfile>(response))
    );
  }

  requestProfilePhoneOtp(phone: string, channel: "sms" | "whatsapp" = "sms"): Observable<OtpRequestResponse> {
    return this.http.post<ApiResponse<OtpRequestResponse>>(`${this.baseUrl}/customer/me/phone/request-otp`, { phone, channel }).pipe(
      map((response) => this.unwrap<OtpRequestResponse>(response))
    );
  }

  verifyProfilePhoneOtp(phone: string, otp: string): Observable<CustomerProfile> {
    return this.http.post<ApiResponse<CustomerProfile>>(`${this.baseUrl}/customer/me/phone/verify`, { phone, code: otp }).pipe(
      map((response) => this.unwrap<CustomerProfile>(response))
    );
  }

  deleteMe(): Observable<{ deleted: boolean; id?: string }> {
    return this.http.delete<ApiResponse<{ deleted: boolean; id?: string }>>(`${this.baseUrl}/customer/me`).pipe(
      map((response) => this.unwrap<{ deleted: boolean; id?: string }>(response))
    );
  }

  listBookings(status?: "upcoming" | "past" | "cancelled"): Observable<Booking[]> {
    return this.http.get<ApiResponse<Booking[] | ApiList<Booking>>>(`${this.baseUrl}/customer/bookings`, { params: this.toParams({ status }) }).pipe(
      map((response) => this.unwrapList<Booking>(response))
    );
  }

  getBooking(id: string): Observable<Booking> {
    return this.http.get<ApiResponse<Booking>>(`${this.baseUrl}/customer/bookings/${encodeURIComponent(id)}`).pipe(
      map((response) => this.unwrap<Booking>(response))
    );
  }

  createBooking(payload: CreateBookingPayload): Observable<Booking> {
    return this.http.post<ApiResponse<Booking>>(`${this.baseUrl}/customer/bookings`, {
      ...payload,
      idempotencyKey: payload.idempotencyKey || this.requestKey("booking")
    }).pipe(
      map((response) => this.unwrap<Booking>(response))
    );
  }

  createBookingPaymentLink(bookingId: string): Observable<CustomerPaymentLink> {
    return this.http.post<ApiResponse<CustomerPaymentLink>>(`${this.baseUrl}/customer/bookings/${encodeURIComponent(bookingId)}/payment-link`, {}).pipe(
      map((response) => this.unwrap<CustomerPaymentLink>(response))
    );
  }

  getBookingContactless(bookingId: string): Observable<Booking> {
    return this.http.get<ApiResponse<Booking>>(`${this.baseUrl}/customer/bookings/${encodeURIComponent(bookingId)}/contactless`).pipe(
      map((response) => this.unwrap<Booking>(response))
    );
  }

  getBookingReceiptHtml(bookingId: string): Observable<string> {
    return this.http.get(`${this.baseUrl}/customer/bookings/${encodeURIComponent(bookingId)}/receipt`, { responseType: "text" });
  }

  submitBookingContactlessForm(bookingId: string, payload: CustomerBookingContactlessPayload): Observable<CustomerProfileExtensionRecord> {
    return this.http.post<ApiResponse<CustomerProfileExtensionRecord>>(`${this.baseUrl}/customer/bookings/${encodeURIComponent(bookingId)}/contactless-form`, payload).pipe(
      map((response) => this.unwrap<CustomerProfileExtensionRecord>(response))
    );
  }

  checkInBooking(bookingId: string, payload: CustomerBookingCheckInPayload): Observable<CustomerBookingCheckInResult> {
    return this.http.post<ApiResponse<CustomerBookingCheckInResult>>(`${this.baseUrl}/customer/bookings/${encodeURIComponent(bookingId)}/check-in`, payload).pipe(
      map((response) => this.unwrap<CustomerBookingCheckInResult>(response))
    );
  }

  createBookingSelfPayLink(bookingId: string, payload: CustomerBookingSelfPayPayload): Observable<CustomerPaymentLink> {
    return this.http.post<ApiResponse<CustomerPaymentLink>>(`${this.baseUrl}/customer/bookings/${encodeURIComponent(bookingId)}/self-pay-link`, {
      ...payload,
      idempotencyKey: payload.idempotencyKey || this.requestKey("booking-self-pay")
    }).pipe(
      map((response) => this.unwrap<CustomerPaymentLink>(response))
    );
  }

  openBookingChat(bookingId: string, body?: string): Observable<CustomerProfileExtensionRecord> {
    return this.http.post<ApiResponse<CustomerProfileExtensionRecord>>(`${this.baseUrl}/customer/bookings/${encodeURIComponent(bookingId)}/chat`, { body }).pipe(
      map((response) => this.unwrap<CustomerProfileExtensionRecord>(response))
    );
  }

  cancelBooking(id: string, payload: CancelBookingPayload = {}): Observable<Booking> {
    return this.http.post<ApiResponse<Booking>>(`${this.baseUrl}/customer/bookings/${encodeURIComponent(id)}/cancel`, payload).pipe(
      map((response) => this.unwrap<Booking>(response))
    );
  }

  rescheduleBooking(id: string, payload: RescheduleBookingPayload): Observable<{ booking: Booking | null; pendingApproval: boolean }> {
    return this.http.post<ApiResponse<Booking>>(`${this.baseUrl}/customer/bookings/${encodeURIComponent(id)}/reschedule`, payload).pipe(
      map((response: any) => ({ booking: this.unwrap<Booking>(response), pendingApproval: Boolean(response?.pendingApproval) }))
    );
  }

  joinBookingWaitlist(id: string, payload: JoinWaitlistPayload = {}): Observable<CustomerWaitlistEntry> {
    return this.http.post<ApiResponse<CustomerWaitlistEntry>>(`${this.baseUrl}/customer/bookings/${encodeURIComponent(id)}/waitlist`, payload).pipe(
      map((response) => this.unwrap<CustomerWaitlistEntry>(response))
    );
  }

  acceptWaitlistOffer(id: string): Observable<Booking> {
    return this.http.post<ApiResponse<Booking>>(`${this.baseUrl}/customer/bookings/${encodeURIComponent(id)}/waitlist-offer/accept`, {}).pipe(
      map((response) => this.unwrap<Booking>(response))
    );
  }

  declineWaitlistOffer(id: string): Observable<{ id: string; status: string }> {
    return this.http.post<ApiResponse<{ id: string; status: string }>>(`${this.baseUrl}/customer/bookings/${encodeURIComponent(id)}/waitlist-offer/decline`, {}).pipe(
      map((response) => this.unwrap<{ id: string; status: string }>(response))
    );
  }

  listFavorites(): Observable<CustomerFavorite[]> {
    return this.http.get<ApiResponse<CustomerFavorite[] | ApiList<CustomerFavorite>>>(`${this.baseUrl}/customer/favorites`).pipe(
      map((response) => this.unwrapList<CustomerFavorite>(response))
    );
  }

  addFavorite(businessId: string): Observable<CustomerFavorite> {
    return this.http.post<ApiResponse<CustomerFavorite>>(`${this.baseUrl}/customer/favorites/${encodeURIComponent(businessId)}`, {}).pipe(
      map((response) => this.unwrap<CustomerFavorite>(response))
    );
  }

  removeFavorite(businessId: string): Observable<void> {
    return this.http.delete<ApiResponse<void>>(`${this.baseUrl}/customer/favorites/${encodeURIComponent(businessId)}`).pipe(
      map(() => undefined)
    );
  }

  listBusinessReviews(slug: string): Observable<BusinessReview[]> {
    return this.http.get<ApiResponse<BusinessReview[] | ApiList<BusinessReview>>>(`${this.baseUrl}/marketplace/businesses/${encodeURIComponent(slug)}/reviews`).pipe(
      map((response) => this.unwrapList<BusinessReview>(response))
    );
  }

  createBookingReview(bookingId: string, payload: CreateReviewPayload): Observable<BusinessReview> {
    return this.http.post<ApiResponse<BusinessReview>>(`${this.baseUrl}/customer/bookings/${encodeURIComponent(bookingId)}/review`, payload).pipe(
      map((response) => this.unwrap<BusinessReview>(response))
    );
  }

  getRewards(): Observable<CustomerRewardSummary> {
    return this.http.get<ApiResponse<CustomerRewardSummary>>(`${this.baseUrl}/customer/rewards`).pipe(
      map((response) => this.unwrap<CustomerRewardSummary>(response))
    );
  }

  redeemLoyalty(payload: RedeemLoyaltyPayload): Observable<RedeemLoyaltyResponse> {
    return this.http.post<ApiResponse<RedeemLoyaltyResponse>>(`${this.baseUrl}/customer/rewards/redeem`, {
      ...payload,
      idempotencyKey: payload.idempotencyKey || this.requestKey("loyalty-redemption")
    }).pipe(
      map((response) => this.unwrap<RedeemLoyaltyResponse>(response))
    );
  }

  getWallet(): Observable<CustomerWallet> {
    return this.http.get<ApiResponse<CustomerWallet>>(`${this.baseUrl}/customer/wallet`).pipe(
      map((response) => this.unwrap<CustomerWallet>(response))
    );
  }

  listMemberships(): Observable<CustomerMembership[]> {
    return this.http.get<ApiResponse<CustomerMembership[] | ApiList<CustomerMembership>>>(`${this.baseUrl}/customer/memberships`).pipe(
      map((response) => this.unwrapList<CustomerMembership>(response))
    );
  }

  freezeMembership(id: string, payload: { days: number; reason?: string }): Observable<CustomerMembershipActionResponse> {
    return this.http.post<ApiResponse<CustomerMembershipActionResponse>>(`${this.baseUrl}/customer/memberships/${encodeURIComponent(id)}/freeze`, payload).pipe(
      map((response) => this.unwrap<CustomerMembershipActionResponse>(response))
    );
  }

  resumeMembership(id: string): Observable<CustomerMembershipActionResponse> {
    return this.http.post<ApiResponse<CustomerMembershipActionResponse>>(`${this.baseUrl}/customer/memberships/${encodeURIComponent(id)}/resume`, {}).pipe(
      map((response) => this.unwrap<CustomerMembershipActionResponse>(response))
    );
  }

  cancelMembership(id: string, reason?: string): Observable<CustomerMembershipActionResponse> {
    return this.http.post<ApiResponse<CustomerMembershipActionResponse>>(`${this.baseUrl}/customer/memberships/${encodeURIComponent(id)}/cancel`, { reason }).pipe(
      map((response) => this.unwrap<CustomerMembershipActionResponse>(response))
    );
  }

  updateMembershipAutoRenew(id: string, status: "active" | "paused" | "disabled"): Observable<CustomerMembershipActionResponse> {
    return this.http.post<ApiResponse<CustomerMembershipActionResponse>>(`${this.baseUrl}/customer/memberships/${encodeURIComponent(id)}/auto-renew`, { status }).pipe(
      map((response) => this.unwrap<CustomerMembershipActionResponse>(response))
    );
  }

  listPackagePlans(branchId: string): Observable<CustomerPackagePlan[]> {
    return this.http.get<ApiResponse<CustomerPackagePlan[] | ApiList<CustomerPackagePlan>>>(`${this.baseUrl}/marketplace/businesses/${encodeURIComponent(branchId)}/packages`).pipe(
      map((response) => this.unwrapList<CustomerPackagePlan>(response))
    );
  }

  buyPackage(payload: PurchasePackagePayload): Observable<CustomerCommerceCheckout> {
    return this.http.post<ApiResponse<CustomerCommerceCheckout>>(`${this.baseUrl}/customer/packages`, {
      ...payload,
      idempotencyKey: payload.idempotencyKey || this.requestKey("package")
    }).pipe(
      map((response) => this.unwrap<CustomerCommerceCheckout>(response))
    );
  }

  activateKiosk(activationCode: string): Observable<{ deviceId: string; activated: boolean }> {
    return this.http.post<ApiResponse<{ deviceId: string; activated: boolean }>>(`${this.baseUrl}/public/kiosk/activate`, { activationCode }, { withCredentials: true }).pipe(map((response) => this.unwrap(response)));
  }

  getKioskContext(): Observable<KioskContext> {
    return this.http.get<ApiResponse<KioskContext>>(`${this.baseUrl}/public/kiosk/context`, { withCredentials: true }).pipe(map((response) => this.unwrap(response)));
  }

  switchKioskBranch(branchId: string): Observable<KioskContext> {
    return this.http.post<ApiResponse<KioskContext>>(`${this.baseUrl}/public/kiosk/branch`, { branchId }, { withCredentials: true }).pipe(map((response) => this.unwrap(response)));
  }

  identifyKioskBooking(appointmentId: string, phone: string): Observable<KioskGuestSession> {
    return this.http.post<ApiResponse<KioskGuestSession>>(`${this.baseUrl}/public/kiosk/identify`, { appointmentId, phone }, { withCredentials: true }).pipe(map((response) => this.unwrap(response)));
  }

  getKioskSession(): Observable<KioskGuestSession> {
    return this.http.get<ApiResponse<KioskGuestSession>>(`${this.baseUrl}/public/kiosk/session`, { withCredentials: true }).pipe(map((response) => this.unwrap(response)));
  }

  kioskCheckIn(payload: object): Observable<Record<string, unknown>> {
    return this.http.post<ApiResponse<Record<string, unknown>>>(`${this.baseUrl}/public/kiosk/check-in`, payload, { withCredentials: true }).pipe(map((response) => this.unwrap(response)));
  }

  completeKioskProfile(payload: object): Observable<Record<string, boolean>> {
    return this.http.patch<ApiResponse<Record<string, boolean>>>(`${this.baseUrl}/public/kiosk/profile`, payload, { withCredentials: true }).pipe(map((response) => this.unwrap(response)));
  }

  requestKioskAddOn(addOnId: string): Observable<Record<string, unknown>> {
    return this.http.post<ApiResponse<Record<string, unknown>>>(`${this.baseUrl}/public/kiosk/add-on-request`, { addOnId, idempotencyKey: this.requestKey("kiosk-add-on") }, { withCredentials: true }).pipe(map((response) => this.unwrap(response)));
  }

  getKioskCheckout(): Observable<Record<string, unknown>> {
    return this.http.get<ApiResponse<Record<string, unknown>>>(`${this.baseUrl}/public/kiosk/checkout`, { withCredentials: true }).pipe(map((response) => this.unwrap(response)));
  }

  getKioskFormToken(definitionId: string): Observable<{ token: string; endpoint: string }> {
    return this.http.post<ApiResponse<{ token: string; endpoint: string }>>(`${this.baseUrl}/public/kiosk/forms/${encodeURIComponent(definitionId)}/token`, {}, { withCredentials: true }).pipe(map((response) => this.unwrap(response)));
  }

  getPublicKioskForm(endpoint: string, token: string): Observable<any> {
    return this.http.get<ApiResponse<any>>(endpoint, { headers: { "x-public-booking-token": token } }).pipe(map((response) => this.unwrap(response)));
  }

  submitPublicKioskForm(endpoint: string, token: string, payload: object): Observable<any> {
    return this.http.post<ApiResponse<any>>(`${endpoint}/submissions`, payload, { headers: { "x-public-booking-token": token } }).pipe(map((response) => this.unwrap(response)));
  }

  resetKiosk(): Observable<{ reset: boolean }> {
    return this.http.post<ApiResponse<{ reset: boolean }>>(`${this.baseUrl}/public/kiosk/reset`, {}, { withCredentials: true }).pipe(map((response) => this.unwrap(response)));
  }

  deactivateKiosk(pin: string): Observable<{ deactivated: boolean }> {
    return this.http.post<ApiResponse<{ deactivated: boolean }>>(`${this.baseUrl}/public/kiosk/deactivate`, { pin }, { withCredentials: true }).pipe(map((response) => this.unwrap(response)));
  }

  buyProduct(payload: PurchaseProductPayload): Observable<CustomerCommerceCheckout> {
    return this.http.post<ApiResponse<CustomerCommerceCheckout>>(`${this.baseUrl}/customer/products/checkout`, {
      ...payload,
      idempotencyKey: payload.idempotencyKey || this.requestKey("product")
    }).pipe(
      map((response) => this.unwrap<CustomerCommerceCheckout>(response))
    );
  }

  buyMembership(planId: string, branchId?: string): Observable<CustomerCommerceCheckout> {
    return this.http.post<ApiResponse<CustomerCommerceCheckout>>(`${this.baseUrl}/customer/memberships`, {
      planId,
      branchId,
      idempotencyKey: this.requestKey("membership")
    }).pipe(
      map((response) => this.unwrap<CustomerCommerceCheckout>(response))
    );
  }

  listPackages(): Observable<CustomerPackage[]> {
    return this.http.get<ApiResponse<CustomerPackage[] | ApiList<CustomerPackage>>>(`${this.baseUrl}/customer/packages`).pipe(
      map((response) => this.unwrapList<CustomerPackage>(response))
    );
  }

  listGiftCards(): Observable<CustomerGiftCard[]> {
    return this.http.get<ApiResponse<CustomerGiftCard[] | ApiList<CustomerGiftCard>>>(`${this.baseUrl}/customer/gift-cards`).pipe(
      map((response) => this.unwrapList<CustomerGiftCard>(response))
    );
  }

  purchaseGiftCard(payload: PurchaseGiftCardPayload): Observable<CustomerCommerceCheckout> {
    return this.http.post<ApiResponse<CustomerCommerceCheckout>>(`${this.baseUrl}/customer/gift-cards`, {
      ...payload,
      idempotencyKey: payload.idempotencyKey || this.requestKey("gift-card")
    }).pipe(
      map((response) => this.unwrap<CustomerCommerceCheckout>(response))
    );
  }

  redeemGiftCard(payload: RedeemGiftCardPayload): Observable<RedeemGiftCardResponse> {
    return this.http.post<ApiResponse<RedeemGiftCardResponse>>(`${this.baseUrl}/customer/gift-cards/redeem`, {
      ...payload,
      idempotencyKey: payload.idempotencyKey || this.requestKey("gift-card-redemption")
    }).pipe(
      map((response) => this.unwrap<RedeemGiftCardResponse>(response))
    );
  }

  listInvoices(): Observable<CustomerInvoice[]> {
    return this.http.get<ApiResponse<CustomerInvoice[] | ApiList<CustomerInvoice>>>(`${this.baseUrl}/customer/invoices`).pipe(
      map((response) => this.unwrapList<CustomerInvoice>(response))
    );
  }

  createInvoicePaymentLink(invoiceId: string, amountPaise?: number): Observable<CustomerPaymentLink> {
    return this.http.post<ApiResponse<CustomerPaymentLink>>(`${this.baseUrl}/customer/invoices/${encodeURIComponent(invoiceId)}/payment-link`, {
      amountPaise,
      idempotencyKey: this.requestKey("invoice-payment")
    }).pipe(
      map((response) => this.unwrap<CustomerPaymentLink>(response))
    );
  }

  listPayments(): Observable<CustomerPayment[]> {
    return this.http.get<ApiResponse<CustomerPayment[] | ApiList<CustomerPayment>>>(`${this.baseUrl}/customer/payments`).pipe(
      map((response) => this.unwrapList<CustomerPayment>(response))
    );
  }

  listPaymentMethods(): Observable<CustomerPaymentMethod[]> {
    return this.http.get<ApiResponse<CustomerPaymentMethod[] | ApiList<CustomerPaymentMethod>>>(`${this.baseUrl}/customer/payment-methods`).pipe(
      map((response) => this.unwrapList<CustomerPaymentMethod>(response))
    );
  }

  listRefunds(): Observable<CustomerRefund[]> {
    return this.http.get<ApiResponse<CustomerRefund[] | ApiList<CustomerRefund>>>(`${this.baseUrl}/customer/refunds`).pipe(
      map((response) => this.unwrapList<CustomerRefund>(response))
    );
  }

  getPushProof(): Observable<CustomerPushProof> {
    return this.http.get<ApiResponse<CustomerPushProof>>(`${this.baseUrl}/customer/notifications/push-proof`).pipe(
      map((response) => this.unwrap<CustomerPushProof>(response))
    );
  }

  listNotifications(): Observable<CustomerNotification[]> {
    return this.http.get<ApiResponse<CustomerNotification[] | ApiList<CustomerNotification>>>(`${this.baseUrl}/customer/notifications`).pipe(
      map((response) => this.unwrapList<CustomerNotification>(response))
    );
  }

  listSupportTickets(): Observable<CustomerProfileExtensionRecord[]> {
    return this.http.get<ApiResponse<CustomerProfileExtensionRecord[] | ApiList<CustomerProfileExtensionRecord>>>(`${this.baseUrl}/customer/support/tickets`).pipe(
      map((response) => this.unwrapList<CustomerProfileExtensionRecord>(response))
    );
  }

  createSupportTicket(payload: CustomerSupportTicketPayload): Observable<CustomerProfileExtensionRecord> {
    return this.http.post<ApiResponse<CustomerProfileExtensionRecord>>(`${this.baseUrl}/customer/support/tickets`, payload).pipe(
      map((response) => this.unwrap<CustomerProfileExtensionRecord>(response))
    );
  }

  addSupportMessage(ticketId: string, payload: CustomerSupportMessagePayload): Observable<CustomerProfileExtensionRecord> {
    return this.http.post<ApiResponse<CustomerProfileExtensionRecord>>(`${this.baseUrl}/customer/support/tickets/${encodeURIComponent(ticketId)}/messages`, payload).pipe(
      map((response) => this.unwrap<CustomerProfileExtensionRecord>(response))
    );
  }

  listSupportMessages(ticketId: string): Observable<CustomerProfileExtensionRecord[]> {
    return this.http.get<ApiResponse<CustomerProfileExtensionRecord[] | ApiList<CustomerProfileExtensionRecord>>>(`${this.baseUrl}/customer/support/tickets/${encodeURIComponent(ticketId)}/messages`).pipe(
      map((response) => this.unwrapList<CustomerProfileExtensionRecord>(response))
    );
  }

  listReferrals(): Observable<CustomerProfileExtensionRecord[]> {
    return this.http.get<ApiResponse<CustomerProfileExtensionRecord[] | ApiList<CustomerProfileExtensionRecord>>>(`${this.baseUrl}/customer/referrals`).pipe(
      map((response) => this.unwrapList<CustomerProfileExtensionRecord>(response))
    );
  }

  listOffers(): Observable<CustomerProfileExtensionRecord[]> {
    return this.http.get<ApiResponse<CustomerProfileExtensionRecord[] | ApiList<CustomerProfileExtensionRecord>>>(`${this.baseUrl}/customer/offers`).pipe(
      map((response) => this.unwrapList<CustomerProfileExtensionRecord>(response))
    );
  }

  createReferralCode(branchId?: string): Observable<CustomerProfileExtensionRecord> {
    return this.http.post<ApiResponse<CustomerProfileExtensionRecord>>(`${this.baseUrl}/customer/referrals/code`, { branchId }).pipe(
      map((response) => this.unwrap<CustomerProfileExtensionRecord>(response))
    );
  }

  listFamily(): Observable<CustomerProfileExtensionRecord[]> {
    return this.http.get<ApiResponse<CustomerProfileExtensionRecord[] | ApiList<CustomerProfileExtensionRecord>>>(`${this.baseUrl}/customer/family`).pipe(
      map((response) => this.unwrapList<CustomerProfileExtensionRecord>(response))
    );
  }

  createFamilyMember(payload: CustomerFamilyMemberPayload): Observable<CustomerProfileExtensionRecord> {
    return this.http.post<ApiResponse<CustomerProfileExtensionRecord>>(`${this.baseUrl}/customer/family`, payload).pipe(
      map((response) => this.unwrap<CustomerProfileExtensionRecord>(response))
    );
  }

  listCorporate(): Observable<CustomerProfileExtensionRecord[]> {
    return this.http.get<ApiResponse<CustomerProfileExtensionRecord[] | ApiList<CustomerProfileExtensionRecord>>>(`${this.baseUrl}/customer/corporate`).pipe(
      map((response) => this.unwrapList<CustomerProfileExtensionRecord>(response))
    );
  }

  listGallery(): Observable<CustomerProfileExtensionRecord[]> {
    return this.http.get<ApiResponse<CustomerProfileExtensionRecord[] | ApiList<CustomerProfileExtensionRecord>>>(`${this.baseUrl}/customer/gallery`).pipe(
      map((response) => this.unwrapList<CustomerProfileExtensionRecord>(response))
    );
  }

  listGoals(): Observable<CustomerProfileExtensionRecord[]> {
    return this.http.get<ApiResponse<CustomerProfileExtensionRecord[] | ApiList<CustomerProfileExtensionRecord>>>(`${this.baseUrl}/customer/goals`).pipe(
      map((response) => this.unwrapList<CustomerProfileExtensionRecord>(response))
    );
  }

  createGoal(payload: CustomerGoalPayload): Observable<CustomerProfileExtensionRecord> {
    return this.http.post<ApiResponse<CustomerProfileExtensionRecord>>(`${this.baseUrl}/customer/goals`, payload).pipe(
      map((response) => this.unwrap<CustomerProfileExtensionRecord>(response))
    );
  }

  private unwrap<T>(response: ApiResponse<T>): T {
    if (this.isEnvelope(response)) {
      if (response.data !== undefined) return response.data as T;
      if (response.success === false) throw new Error(this.errorMessage(response));
    }
    return response as T;
  }

  private unwrapList<T>(response: ApiResponse<T[] | ApiList<T>>): T[] {
    const value = this.unwrap<T[] | ApiList<T>>(response);
    if (Array.isArray(value)) return value;
    return value.rows ?? value.items ?? value.data ?? [];
  }

  claimGiftCard(payload: ClaimGiftCardPayload): Observable<CustomerGiftCard> {
    return this.http.post<ApiResponse<CustomerGiftCard>>(`${this.baseUrl}/customer/gift-cards/claim`, payload).pipe(
      map((response) => this.unwrap<CustomerGiftCard>(response))
    );
  }

  private marketplaceAvailabilityDay(value: { date?: string; slots?: unknown[] }): AvailabilityDay {
    const date = String(value.date || new Date().toISOString().slice(0, 10));
    const parsed = new Date(`${date}T00:00:00`);
    const label = Number.isNaN(parsed.getTime()) ? date : parsed.toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
    const dayLabel = Number.isNaN(parsed.getTime()) ? date : parsed.toLocaleDateString("en-IN", { weekday: "short" });
    return {
      date,
      label,
      dayLabel,
      periods: [{
        label: "Available",
        slots: (value.slots || []).map((slot) => {
          const item = slot as Record<string, unknown>;
          const startAt = String(item["startAt"] || "");
          const startsAt = new Date(startAt);
          return {
            startAt,
            endAt: String(item["endAt"] || ""),
            displayTime: Number.isNaN(startsAt.getTime()) ? startAt : startsAt.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" }),
            available: true,
            staffId: Array.isArray(item["availableStaffIds"]) ? String(item["availableStaffIds"][0] || "") : undefined
          };
        })
      }]
    };
  }

  private isEnvelope<T>(response: ApiResponse<T>): response is ApiEnvelope<T> {
    return !!response && typeof response === "object" && ("data" in response || "success" in response || "error" in response);
  }

  private errorMessage<T>(response: ApiEnvelope<T>): string {
    if (typeof response.error === "string") return response.error;
    return response.error?.message || "API request failed";
  }

  private requestKey(prefix: string): string {
    const id = globalThis.crypto?.randomUUID?.();
    if (!id) throw new Error("Secure request identity is unavailable");
    return `${prefix}:${id}`;
  }

  private devicePayload(device?: CustomerDeviceInfo): { name: string; deviceType: string } | undefined {
    return device ? { name: device.deviceName, deviceType: device.platform } : undefined;
  }

  private toParams(params: object): HttpParams {
    let httpParams = new HttpParams();
    Object.entries(params).forEach(([key, value]) => {
      if (value === undefined || value === null || value === "") return;
      httpParams = httpParams.set(key, String(value));
    });
    return httpParams;
  }
}
