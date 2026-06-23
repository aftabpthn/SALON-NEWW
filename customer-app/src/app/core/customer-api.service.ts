import { HttpClient, HttpParams } from "@angular/common/http";
import { Injectable } from "@angular/core";
import { map, Observable } from "rxjs";
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
  CustomerFavorite,
  CustomerDeviceInfo,
  CustomerDeviceSession,
  CustomerGiftCard,
  CustomerInvoice,
  CustomerMembership,
  CustomerMembershipPlan,
  CustomerNotification,
  CustomerPackage,
  CustomerPayment,
  CustomerPaymentLink,
  CustomerProfile,
  CustomerRewardSummary,
  CustomerWallet,
  CustomerWaitlistEntry,
  FirebaseAuthPayload,
  JoinWaitlistPayload,
  LiveConsultationRequest,
  LiveConsultationResponse,
  OtpRequestResponse,
  PurchaseGiftCardPayload,
  RedeemGiftCardPayload,
  RedeemGiftCardResponse,
  RescheduleBookingPayload,
  SearchBusinessesParams,
  ServiceItem,
  StaffMember,
  BusinessReview
} from "./api.types";

type ApiResponse<T> = T | ApiEnvelope<T>;

@Injectable({ providedIn: "root" })
export class CustomerApiService {
  private readonly baseUrl = environment.apiBaseUrl.replace(/\/$/, "");

  constructor(private readonly http: HttpClient) {}

  listPublicBusinesses(params: SearchBusinessesParams = {}): Observable<Business[]> {
    return this.http.get<ApiResponse<Business[] | ApiList<Business>>>(`${this.baseUrl}/public/businesses`, { params: this.toParams(params) }).pipe(
      map((response) => this.unwrapList<Business>(response))
    );
  }

  getPublicBusiness(slug: string): Observable<Business> {
    return this.http.get<ApiResponse<Business>>(`${this.baseUrl}/public/businesses/${encodeURIComponent(slug)}`).pipe(
      map((response) => this.unwrap<Business>(response))
    );
  }

  getPublicBusinessServices(slug: string): Observable<ServiceItem[]> {
    return this.http.get<ApiResponse<ServiceItem[] | ApiList<ServiceItem>>>(`${this.baseUrl}/public/businesses/${encodeURIComponent(slug)}/services`).pipe(
      map((response) => this.unwrapList<ServiceItem>(response))
    );
  }

  getPublicBusinessStaff(slug: string): Observable<StaffMember[]> {
    return this.http.get<ApiResponse<StaffMember[] | ApiList<StaffMember>>>(`${this.baseUrl}/public/businesses/${encodeURIComponent(slug)}/staff`).pipe(
      map((response) => this.unwrapList<StaffMember>(response))
    );
  }

  getAvailability(slug: string, params: AvailabilityQuery): Observable<AvailabilityDay[]> {
    return this.http.get<ApiResponse<AvailabilityDay[] | ApiList<AvailabilityDay>>>(`${this.baseUrl}/public/businesses/${encodeURIComponent(slug)}/availability`, { params: this.toParams(params) }).pipe(
      map((response) => this.unwrapList<AvailabilityDay>(response))
    );
  }

  listPublicCategories(): Observable<Category[]> {
    return this.http.get<ApiResponse<Category[] | ApiList<Category>>>(`${this.baseUrl}/public/categories`).pipe(
      map((response) => this.unwrapList<Category>(response))
    );
  }

  listMembershipPlans(params: { branchId?: string } = {}): Observable<CustomerMembershipPlan[]> {
    return this.http.get<ApiResponse<CustomerMembershipPlan[] | ApiList<CustomerMembershipPlan>>>(`${this.baseUrl}/public/membership-plans`, { params: this.toParams(params) }).pipe(
      map((response) => this.unwrapList<CustomerMembershipPlan>(response))
    );
  }

  searchPublicBusinesses(params: SearchBusinessesParams = {}): Observable<Business[]> {
    return this.http.get<ApiResponse<Business[] | ApiList<Business>>>(`${this.baseUrl}/public/search`, { params: this.toParams(params) }).pipe(
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
    return this.http.post<ApiResponse<AuthSession>>(`${this.baseUrl}/customer/auth/verify-otp`, { phone, otp, device }).pipe(
      map((response) => this.unwrap<AuthSession>(response))
    );
  }

  verifyEmailCode(email: string, code: string, name = "", device?: CustomerDeviceInfo): Observable<AuthSession> {
    return this.http.post<ApiResponse<AuthSession>>(`${this.baseUrl}/customer/auth/verify-email-code`, { email, code, name, device }).pipe(
      map((response) => this.unwrap<AuthSession>(response))
    );
  }

  exchangeFirebaseToken(payload: FirebaseAuthPayload): Observable<AuthSession> {
    return this.http.post<ApiResponse<AuthSession>>(`${this.baseUrl}/customer/auth/firebase`, payload).pipe(
      map((response) => this.unwrap<AuthSession>(response))
    );
  }

  refreshCustomerSession(refreshToken: string, device?: CustomerDeviceInfo): Observable<AuthSession> {
    return this.http.post<ApiResponse<AuthSession>>(`${this.baseUrl}/customer/auth/refresh`, { refreshToken, device }).pipe(
      map((response) => this.unwrap<AuthSession>(response))
    );
  }

  logout(): Observable<void> {
    return this.http.post<ApiResponse<void>>(`${this.baseUrl}/customer/auth/logout`, {}).pipe(
      map(() => undefined)
    );
  }

  listDevices(): Observable<CustomerDeviceSession[]> {
    return this.http.get<ApiResponse<CustomerDeviceSession[] | ApiList<CustomerDeviceSession>>>(`${this.baseUrl}/customer/devices`).pipe(
      map((response) => this.unwrapList<CustomerDeviceSession>(response))
    );
  }

  logoutDevice(sessionId: string): Observable<void> {
    return this.http.delete<ApiResponse<void>>(`${this.baseUrl}/customer/devices/${encodeURIComponent(sessionId)}`).pipe(
      map(() => undefined)
    );
  }

  logoutAllDevices(): Observable<void> {
    return this.http.delete<ApiResponse<void>>(`${this.baseUrl}/customer/devices`).pipe(
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
    return this.http.post<ApiResponse<CustomerProfile>>(`${this.baseUrl}/customer/me/phone/verify`, { phone, otp }).pipe(
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
    return this.http.post<ApiResponse<Booking>>(`${this.baseUrl}/customer/bookings`, payload).pipe(
      map((response) => this.unwrap<Booking>(response))
    );
  }

  cancelBooking(id: string, payload: CancelBookingPayload = {}): Observable<Booking> {
    return this.http.post<ApiResponse<Booking>>(`${this.baseUrl}/customer/bookings/${encodeURIComponent(id)}/cancel`, payload).pipe(
      map((response) => this.unwrap<Booking>(response))
    );
  }

  rescheduleBooking(id: string, payload: RescheduleBookingPayload): Observable<Booking> {
    return this.http.post<ApiResponse<Booking>>(`${this.baseUrl}/customer/bookings/${encodeURIComponent(id)}/reschedule`, payload).pipe(
      map((response) => this.unwrap<Booking>(response))
    );
  }

  joinBookingWaitlist(id: string, payload: JoinWaitlistPayload = {}): Observable<CustomerWaitlistEntry> {
    return this.http.post<ApiResponse<CustomerWaitlistEntry>>(`${this.baseUrl}/customer/bookings/${encodeURIComponent(id)}/waitlist`, payload).pipe(
      map((response) => this.unwrap<CustomerWaitlistEntry>(response))
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
    return this.http.get<ApiResponse<BusinessReview[] | ApiList<BusinessReview>>>(`${this.baseUrl}/public/businesses/${encodeURIComponent(slug)}/reviews`).pipe(
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

  buyMembership(planId: string, branchId?: string): Observable<{ membership: CustomerMembership; paymentRequired: boolean; amountPaise: number }> {
    return this.http.post<ApiResponse<{ membership: CustomerMembership; paymentRequired: boolean; amountPaise: number }>>(`${this.baseUrl}/customer/memberships`, { planId, branchId }).pipe(
      map((response) => this.unwrap<{ membership: CustomerMembership; paymentRequired: boolean; amountPaise: number }>(response))
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

  purchaseGiftCard(payload: PurchaseGiftCardPayload): Observable<CustomerGiftCard> {
    return this.http.post<ApiResponse<CustomerGiftCard>>(`${this.baseUrl}/customer/gift-cards`, payload).pipe(
      map((response) => this.unwrap<CustomerGiftCard>(response))
    );
  }

  redeemGiftCard(payload: RedeemGiftCardPayload): Observable<RedeemGiftCardResponse> {
    return this.http.post<ApiResponse<RedeemGiftCardResponse>>(`${this.baseUrl}/customer/gift-cards/redeem`, payload).pipe(
      map((response) => this.unwrap<RedeemGiftCardResponse>(response))
    );
  }

  listInvoices(): Observable<CustomerInvoice[]> {
    return this.http.get<ApiResponse<CustomerInvoice[] | ApiList<CustomerInvoice>>>(`${this.baseUrl}/customer/invoices`).pipe(
      map((response) => this.unwrapList<CustomerInvoice>(response))
    );
  }

  createInvoicePaymentLink(invoiceId: string, amountPaise?: number): Observable<CustomerPaymentLink> {
    return this.http.post<ApiResponse<CustomerPaymentLink>>(`${this.baseUrl}/customer/invoices/${encodeURIComponent(invoiceId)}/payment-link`, { amountPaise }).pipe(
      map((response) => this.unwrap<CustomerPaymentLink>(response))
    );
  }

  listPayments(): Observable<CustomerPayment[]> {
    return this.http.get<ApiResponse<CustomerPayment[] | ApiList<CustomerPayment>>>(`${this.baseUrl}/customer/payments`).pipe(
      map((response) => this.unwrapList<CustomerPayment>(response))
    );
  }

  listNotifications(): Observable<CustomerNotification[]> {
    return this.http.get<ApiResponse<CustomerNotification[] | ApiList<CustomerNotification>>>(`${this.baseUrl}/customer/notifications`).pipe(
      map((response) => this.unwrapList<CustomerNotification>(response))
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

  private isEnvelope<T>(response: ApiResponse<T>): response is ApiEnvelope<T> {
    return !!response && typeof response === "object" && ("data" in response || "success" in response || "error" in response);
  }

  private errorMessage<T>(response: ApiEnvelope<T>): string {
    if (typeof response.error === "string") return response.error;
    return response.error?.message || "API request failed";
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
