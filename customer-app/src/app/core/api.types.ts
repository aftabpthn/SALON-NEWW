export interface ApiEnvelope<T> {
  success?: boolean;
  data?: T;
  error?: string | { message?: string; code?: string; details?: unknown };
}

export interface ApiList<T> {
  rows?: T[];
  items?: T[];
  data?: T[];
  nextCursor?: string;
}

export interface SearchBusinessesParams {
  q?: string;
  category?: string;
  area?: string;
  city?: string;
  lat?: number;
  lng?: number;
  radiusKm?: number;
  openNow?: boolean;
  topRated?: boolean;
  offers?: boolean;
  availableToday?: boolean;
  minPricePaise?: number;
  maxPricePaise?: number;
  staffGender?: string;
  sort?: "recommended" | "rating" | "distance" | "price";
  limit?: number;
  cursor?: string;
}

export interface Category {
  id: string;
  label: string;
  slug: string;
}

export interface ServiceItem {
  id: string;
  businessId?: string;
  name: string;
  description: string;
  durationMinutes: number;
  pricePaise: number;
  category: string;
  popular?: boolean;
  active?: boolean;
}

export interface StaffMember {
  id: string;
  businessId?: string;
  name: string;
  title: string;
  rating?: number;
  avatarGradient?: string;
  specialty?: string;
  image?: string;
  nextAvailable?: string;
  bookableServiceIds?: string[];
}

export interface BusinessReview {
  id: string;
  businessId?: string;
  author: string;
  rating: number;
  text: string;
  createdAt?: string;
  dateLabel?: string;
}

export interface BusinessHour {
  day: string;
  label: string;
  open: boolean;
  opensAt: string;
  closesAt: string;
  display: string;
  note?: string;
}

export interface Business {
  id: string;
  tenantId?: string;
  branchId?: string;
  slug: string;
  businessName: string;
  category: string;
  description: string;
  address: string;
  area: string;
  city: string;
  state?: string;
  postalCode?: string;
  country?: string;
  phone?: string;
  mobileNumber?: string;
  telephoneNumber?: string;
  appointmentNumber?: string;
  logoUrl?: string;
  websiteUrl?: string;
  instagramUrl?: string;
  mapsUrl?: string;
  latitude?: number;
  longitude?: number;
  distanceKm?: number;
  ratingAverage: number;
  ratingCount: number;
  createdAt?: string;
  isOpen: boolean;
  hoursLabel?: string;
  openingTime?: string;
  closingTime?: string;
  timezone?: string;
  businessHours?: BusinessHour[];
  nextOpenAt?: string;
  nextCloseAt?: string;
  nextAvailableSlot?: string;
  hasOffer: boolean;
  offerText?: string;
  coverGradient?: string;
  coverImage?: string;
  galleryImages: string[];
  popularService?: string;
  startingPricePaise: number;
  categories: string[];
  services: ServiceItem[];
  staff: StaffMember[];
  reviews: BusinessReview[];
  policies?: string[];
  paymentModes?: ("pay_at_venue" | "online")[];
}

export interface LiveConsultationPhoto {
  name: string;
  type: string;
  sizeBytes: number;
  dataUrl: string;
}

export interface LiveConsultationBusinessContext {
  id: string;
  slug: string;
  businessName: string;
  category?: string;
  description?: string;
  address?: string;
  area?: string;
  city?: string;
  state?: string;
  country?: string;
  phone?: string;
  mapsUrl?: string;
  ratingAverage?: number;
  ratingCount?: number;
  distanceKm?: number;
  isOpen?: boolean;
  hoursLabel?: string;
  nextAvailableSlot?: string;
  startingPricePaise?: number;
  popularService?: string;
  services: Pick<ServiceItem, "id" | "name" | "category" | "description" | "pricePaise" | "durationMinutes">[];
}

export interface LiveConsultationChatTurn {
  role: "customer" | "assistant";
  text: string;
}

export interface LiveConsultationProblemProfile {
  concern?: string;
  timeframe?: string;
  budget?: string;
  event?: string;
  history?: string;
  sensitivities?: string;
  desiredOutcome?: string;
}

export interface LiveConsultationRequest {
  message: string;
  goals: string[];
  location?: { label?: string; lat?: number; lng?: number } | null;
  photos: LiveConsultationPhoto[];
  businesses: LiveConsultationBusinessContext[];
  conversation?: LiveConsultationChatTurn[];
  problemProfile?: LiveConsultationProblemProfile;
}

export interface LiveConsultationSalonRecommendation {
  businessName: string;
  slug: string;
  reason: string;
  location: string;
  distanceKm?: number;
  rating?: number;
  openStatus?: string;
  nextStep?: string;
}

export interface LiveConsultationServiceRecommendation {
  name: string;
  businessName: string;
  slug: string;
  priceLabel: string;
  durationLabel: string;
  reason: string;
}

export interface LiveConsultationResponse {
  consultationId: string;
  createdAt: string;
  mode: "openai" | "gemini" | "local" | string;
  provider: "openai" | "gemini" | "local_rules" | string;
  providerWarning?: string;
  answer: string;
  concernSummary?: string;
  consultationStage?: string;
  confidence?: string;
  missingInfo?: string[];
  suggestedReplies?: string[];
  visualAssessment?: string[];
  hairPlan?: string[];
  actionPlan: string[];
  recommendedSalons: LiveConsultationSalonRecommendation[];
  recommendedServices: LiveConsultationServiceRecommendation[];
  locationInsights: string[];
  preparationChecklist?: string[];
  afterCare?: string[];
  budgetInsights?: string[];
  followUpQuestions: string[];
  safetyNote: string;
}

export interface AvailabilityQuery {
  serviceId: string;
  staffId?: string;
  date: string;
  timezone?: string;
}

export interface AvailabilitySlot {
  startAt: string;
  endAt?: string;
  displayTime: string;
  available: boolean;
  staffId?: string;
}

export interface AvailabilityPeriod {
  label: "Morning" | "Afternoon" | "Evening" | string;
  slots: AvailabilitySlot[];
}

export interface AvailabilityDay {
  date: string;
  label: string;
  dayLabel: string;
  periods: AvailabilityPeriod[];
}

export interface OtpRequestResponse {
  requestId: string;
  expiresAt?: string;
  resendAfterSeconds?: number;
  devOtp?: string;
  deliveryChannel?: "sms" | "whatsapp" | "local" | string;
  requestedChannel?: "sms" | "whatsapp" | string;
  fallbackChannels?: ("sms" | "whatsapp" | string)[];
  deliveryWarning?: string;
}

export interface CustomerProfile {
  id?: string;
  uid?: string;
  name: string;
  displayName?: string;
  firstName?: string;
  lastName?: string;
  phone: string;
  phoneNumber?: string;
  email?: string;
  avatarUrl?: string;
  isLoggedIn: boolean;
  bookingCount?: number;
  loyaltyPoints?: number;
  membershipLabel?: string;
  firebaseUid?: string;
  appleUserId?: string;
  facebookUserId?: string;
  authProvider?: string;
  createdAt?: string;
  lastLoginAt?: string;
  phoneVerifiedAt?: string;
  emailVerifiedAt?: string;
  profileComplete?: boolean;
  notificationPreferences?: CustomerNotificationPreferences;
}

export interface CustomerNotificationPreferences {
  bookingReminders: boolean;
  promotions: boolean;
  loyalty: boolean;
  membership: boolean;
}

export interface AuthSession {
  accessToken: string;
  refreshToken?: string;
  refreshExpiresAt?: string;
  customer: CustomerProfile;
  isNewCustomer?: boolean;
}

export interface CustomerDeviceInfo {
  deviceId: string;
  deviceName: string;
  platform: string;
  userAgent?: string;
}

export interface CustomerPushDevicePayload {
  token: string;
  platform: "android" | "ios";
  appVersion?: string;
}

export interface CustomerDeviceSession {
  id: string;
  deviceId: string;
  deviceName: string;
  platform: string;
  userAgent?: string;
  lastSeenAt: string;
  createdAt: string;
  current?: boolean;
}

export interface FirebaseAuthPayload {
  idToken: string;
  provider: "google" | "apple" | "facebook" | "phone" | "password";
  device?: CustomerDeviceInfo;
}

export interface CreateBookingPayload {
  businessSlug: string;
  businessId?: string;
  serviceId: string;
  staffId?: string;
  startAt: string;
  timezone: string;
  offerId?: string;
  notes?: string;
  paymentMode: "pay_at_venue" | "online";
}

export interface Booking {
  id: string;
  reference: string;
  businessId?: string;
  businessName: string;
  serviceId?: string;
  serviceName: string;
  staffId?: string;
  staffName: string;
  startAt?: string;
  displayStartAt?: string;
  startsAt?: string;
  endAt?: string;
  endsAt?: string;
  durationMinutes?: number;
  serviceDurationMinutes?: number;
  address: string;
  latitude?: number | null;
  longitude?: number | null;
  status: "pending" | "confirmed" | "completed" | "cancelled";
  paymentStatus?: "not_required" | "pending" | "paid" | "refunded";
  cancellationPolicy?: string;
}

export type CustomerBookingChatStatus = "open" | "waiting_for_salon" | "waiting_for_customer" | "resolved" | "closed";

export interface CustomerBookingChatThread {
  id: string;
  bookingId: string;
  salonName: string;
  subject: string;
  status: CustomerBookingChatStatus;
  lastMessageAt: string | null;
  lastMessagePreview: string;
  unreadCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface CustomerBookingChatMessage {
  id: string;
  conversationId: string;
  senderType: "customer" | "staff" | "system";
  senderName: string;
  body: string;
  clientMessageId: string | null;
  customerReadAt: string | null;
  staffReadAt: string | null;
  createdAt: string;
}

export interface CustomerBookingChatMessagesResponse {
  thread: CustomerBookingChatThread;
  messages: CustomerBookingChatMessage[];
}

export interface SendCustomerBookingChatMessagePayload {
  body: string;
  clientMessageId: string;
}

export type CustomerBookingSupportCategory = "reschedule" | "cancellation" | "payment" | "salon_unavailable" | "other";
export type CustomerBookingSupportPreferredContact = "phone" | "email" | "in_app";
export type CustomerBookingSupportPriority = "low" | "medium" | "high";

export interface CreateCustomerBookingSupportTicketPayload {
  category: CustomerBookingSupportCategory;
  message: string;
  preferredContact?: CustomerBookingSupportPreferredContact;
  priority?: CustomerBookingSupportPriority;
}

export interface CustomerBookingSupportTicket {
  id: string;
  bookingId: string;
  branchId: string;
  category: CustomerBookingSupportCategory;
  message: string;
  preferredContact: CustomerBookingSupportPreferredContact;
  priority: CustomerBookingSupportPriority;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface CustomerSupportTicketQuery {
  status?: string;
  limit?: number;
}

export interface CancelBookingPayload {
  reason?: string;
}

export interface RescheduleBookingPayload {
  startAt: string;
  staffId?: string;
  serviceId?: string;
}

export interface JoinWaitlistPayload {
  preferredDate?: string;
  staffId?: string;
  serviceId?: string;
  reason?: string;
  priority?: "normal" | "high";
}

export interface CustomerWaitlistEntry {
  id: string;
  bookingId: string;
  businessId: string;
  businessName: string;
  serviceId: string;
  serviceName: string;
  preferredDate: string;
  status: string;
  recommendations: { startAt: string; endAt?: string; staffId?: string; displayTime: string }[];
}

export interface CustomerFavorite {
  businessId: string;
  createdAt?: string;
  business?: Business;
}

export interface CreateReviewPayload {
  rating: number;
  text: string;
}

export interface CustomerRewardSummary {
  loyaltyPoints: number;
  tier: string;
  history: CustomerRewardHistoryItem[];
}

export interface CustomerRewardHistoryItem {
  id: string;
  points: number;
  type: string;
  description: string;
  createdAt: string;
}

export interface CustomerWallet {
  balancePaise: number;
  transactions: CustomerWalletTransaction[];
}

export interface CustomerWalletTransaction {
  id: string;
  type: string;
  amountPaise: number;
  balanceAfterPaise: number;
  referenceType?: string;
  referenceId?: string;
  notes?: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
}

export interface CustomerMembership {
  id: string;
  planName: string;
  pricePaise: number;
  planCredits: number;
  creditsRemaining: number;
  serviceCredits: unknown[];
  validityDate: string;
  autoRenew: boolean;
  loyaltyMultiplier: number;
  status: string;
  redeemHistory: unknown[];
  branchId: string;
  createdAt: string;
  updatedAt: string;
}

export interface CustomerMembershipPlan {
  id: string;
  branchId: string;
  code: string;
  name: string;
  description: string;
  pricePaise: number;
  validityDays: number;
  discountPercent: number;
  productDiscountPercent: number;
  includedServices: unknown[];
  benefitRules: Record<string, unknown>;
}

export interface BuyMembershipResponse {
  membership: CustomerMembership;
  paymentRequired: boolean;
  amountPaise: number;
}

export interface CustomerPackage {
  id: string;
  name: string;
  pricePaise: number;
  creditsRemaining?: number;
  status: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface CustomerGiftCard {
  id: string;
  code: string;
  initialValuePaise: number;
  balancePaise: number;
  expiryDate: string;
  status: string;
  redeemHistory: unknown[];
  createdAt: string;
  updatedAt: string;
}

export interface PurchaseGiftCardPayload {
  amountPaise: number;
  branchId?: string;
  expiryDate?: string;
}

export interface RedeemGiftCardPayload {
  code: string;
  invoiceId: string;
  amountPaise: number;
}

export interface RedeemGiftCardResponse {
  giftCardId: string;
  invoiceId: string;
  amountPaise: number;
  balanceAfterPaise: number;
}

export interface CustomerInvoice {
  id: string;
  invoiceNumber: string;
  saleId: string;
  branchId: string;
  status: string;
  subtotalPaise: number;
  discountPaise: number;
  taxPaise: number;
  totalPaise: number;
  paidPaise: number;
  balancePaise: number;
  dueDate: string;
  lineItems: unknown[];
  createdAt: string;
  updatedAt: string;
}

export interface CustomerPayment {
  id: string;
  invoiceId: string;
  invoiceNumber: string;
  mode: string;
  amountPaise: number;
  reference: string;
  createdAt: string;
}

export interface CustomerPaymentLink {
  id?: string;
  invoiceId?: string;
  amount?: number;
  amountPaise?: number;
  provider?: string;
  status?: string;
  url?: string;
  shortUrl?: string;
  expiresAt?: string;
}

export interface CustomerNotification {
  id: string;
  type: string;
  category?: string;
  channel: string;
  title?: string;
  message: string;
  status: string;
  readAt?: string | null;
  deepLink?: string;
  data?: Record<string, unknown>;
  scheduledAt?: string;
  createdAt: string;
}

export interface CustomerSalonRelationship {
  id: string;
  customerId: string;
  tenantId: string;
  branchId: string;
  businessId: string;
  businessName: string;
  relationshipType: string;
  visitCount: number;
  lastVisitAt: string;
  isFavorite: number;
  createdAt: string;
  updatedAt: string;
}

export interface CustomerPrimarySalon {
  id: string;
  customerId: string;
  tenantId: string;
  branchId: string;
  businessId: string;
  businessName: string;
  reason: string;
  setAt: string;
}

export interface CustomerSalonsResponse {
  salons: CustomerSalonRelationship[];
  primarySalon: CustomerPrimarySalon | null;
  shouldPromptPrimary: boolean;
  suggestedSalon: CustomerSalonRelationship | null;
}

export type CustomerAccountModule =
  | CustomerRewardSummary
  | CustomerWallet
  | CustomerMembership[]
  | CustomerPackage[]
  | CustomerGiftCard[]
  | CustomerInvoice[]
  | CustomerPayment[]
  | CustomerNotification[];

// ─── Public Offers (from happy-hours control tower) ──────────────

export interface PublicOfferDiscountRule {
  type: "discount_rule";
  id: string;
  title: string;
  description: string;
  discountSummary: string;
  applyTo: string;
  validFrom: string;
  validTo: string;
}

export interface PublicOfferCoupon {
  type: "coupon";
  id: string;
  code: string;
  title: string;
  description: string;
  discountSummary: string;
  validFrom: string;
  validTo: string;
}

export interface PublicOfferCalendar {
  type: "calendar_promotion";
  id: string;
  title: string;
  description: string;
  promoType: string;
  startDate: string;
  endDate: string;
  startTime: string;
  endTime: string;
}

export type PublicOfferItem = PublicOfferDiscountRule | PublicOfferCoupon | PublicOfferCalendar;

export interface PublicOffersResponse {
  tenantId: string;
  branchId: string;
  safeForPublicSurfaces: boolean;
  eligibility: {
    currentDate: string;
    serviceId: string;
    serviceCategory: string;
    staffId: string;
    clientSegment: string;
    cartTotalPaise: number;
  };
  labels: Record<string, string>;
  offers: PublicOfferItem[];
  generatedAt: string;
}

// ─── My Salon Dashboard (aggregated) ────────────────────────────

export interface MySalonDashboardService {
  id: string;
  name: string;
  category: string;
  durationMinutes: number;
  pricePaise: number;
}

export interface MySalonDashboardStaff {
  id: string;
  name: string;
  title: string;
  specialty: string;
}

export interface MySalonDashboardBooking {
  id: string;
  serviceName: string;
  staffName: string;
  startAt: string;
  status: string;
  totalPricePaise: number;
}

export interface MySalonDashboardOffer {
  id: string;
  title: string;
  description: string;
  discountType: string;
  discountValue: number;
  validFrom: string;
  validTo: string;
}

export interface MySalonDashboardWallet {
  balancePaise: number;
  transactions: Array<{
    id: string;
    type: string;
    amountPaise: number;
    description: string;
    createdAt: string;
  }>;
}

export interface MySalonDashboardLoyalty {
  points: number;
  tier: string;
  lifetimePoints: number;
}

export interface MySalonDashboardMembership {
  planName: string;
  status: string;
  creditsRemaining: number;
  validityDate: string;
}

export interface MySalonDashboardPackage {
  id: string;
  name: string;
  pricePaise: number;
  sessionsTotal: number;
  sessionsUsed: number;
}

export interface MySalonDashboard {
  hasPrimarySalon: boolean;
  salon: {
    name: string;
    address: string;
    city: string;
    phone: string;
    slug: string;
    isOpen: boolean;
    hoursLabel: string;
    ratingAverage: number;
    ratingCount: number;
  } | null;
  wallet: MySalonDashboardWallet | null;
  loyalty: MySalonDashboardLoyalty | null;
  membership: MySalonDashboardMembership | null;
  packages: MySalonDashboardPackage[];
  recentBookings: MySalonDashboardBooking[];
  services: MySalonDashboardService[];
  staff: MySalonDashboardStaff[];
  offers: MySalonDashboardOffer[];
  relationship: {
    visitCount: number;
    type: string;
    lastVisitAt: string;
  } | null;
}

