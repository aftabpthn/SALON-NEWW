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

export interface CustomerMarketingOffer {
  id: string;
  branchId: string;
  businessSlug: string;
  businessName: string;
  branchName: string;
  code: string;
  title: string;
  customerDescription: string;
  benefitType: string;
  benefitValue: number;
  targetServiceIds: string[];
  applicableServices: Pick<ServiceItem, "id" | "name">[];
  startsAt?: string;
  endsAt?: string;
  minimumBillPaise: number;
  perClientLimit: number;
  hasCreative: boolean;
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
  addons?: ServiceAddon[];
}

export interface ServiceAddon {
  id: string;
  name: string;
  durationMinutes: number;
  pricePaise: number;
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
  branchCode?: string;
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
  bookingDepositPercent?: number;
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
  languageCode?: string;
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
  languageCode?: string;
  supportedLanguages?: string[];
  requiresExplicitBookingConfirmation?: boolean;
  bookingConfirmationPolicy?: string;
  runtimeSafetyProof?: Record<string, unknown>;
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
  requestId?: string;
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
  communicationPreferences?: Record<string, unknown>;
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

export interface CustomerDevSessionPayload {
  tenantId: string;
  branchId: string;
  email?: string;
  phone?: string;
  firstName?: string;
  lastName?: string;
  device?: CustomerDeviceInfo;
}

export interface CreateBookingPayload {
  tenantId: string;
  branchId: string;
  serviceIds: string[];
  serviceSelections?: BookingServiceSelection[];
  clientId?: string;
  packageCreditId?: string;
  staffId?: string;
  startAt: string;
  endAt: string;
  notes?: string;
  rebookFromBookingId?: string;
  source?: string;
  paymentMode: "pay_at_venue" | "online";
  cardGuaranteeAccepted?: boolean;
}

export interface BookingServiceSelection {
  serviceId: string;
  variantId?: string;
  addonIds: string[];
}

export interface Booking {
  id: string;
  reference: string;
  businessId?: string;
  businessName: string;
  serviceIds?: string[];
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
  status: "pending" | "confirmed" | "completed" | "cancelled" | "waitlist_offer";
  paymentStatus?: "not_required" | "pending" | "paid" | "refunded";
  paymentUrl?: string;
  depositAmountPaise?: number;
  invoiceId?: string;
  invoiceNumber?: string;
  invoiceStatus?: string;
  invoiceTotalPaise?: number;
  invoicePaidPaise?: number;
  invoiceBalancePaise?: number;
  tipPaise?: number;
  receiptAvailable?: boolean;
  queueStatus?: string;
  queueEtaMinutes?: number;
  queueUpdatedAt?: string;
  chatTicketId?: string;
  safetyFormSubmittedAt?: string;
  allergies?: string;
  preferences?: string;
  smartRebookAfter?: string;
  smartRebookReason?: string;
  rebookFromBookingId?: string;
  cancellationPolicy?: string;
}

export interface CancelBookingPayload {
  reason?: string;
}

export interface RescheduleBookingPayload {
  startAt: string;
  staffId?: string;
}

export interface JoinWaitlistPayload {
  preferredDate?: string;
  preferredStartDate?: string;
  preferredEndDate?: string;
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
  autoRenewStatus?: "active" | "paused" | "disabled" | "failed" | "payment_required" | string;
  frozenAt?: string;
  frozenUntil?: string;
  freezeReason?: string;
  loyaltyMultiplier: number;
  status: string;
  redeemHistory: unknown[];
  branchId: string;
  createdAt: string;
  updatedAt: string;
}

export interface CustomerMembershipActionResponse {
  id: string;
  status?: string;
  days?: number;
  autoRenew?: boolean;
  autoRenewStatus?: string;
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

export interface CustomerPackage {
  id: string;
  packageId?: string;
  branchId?: string;
  name: string;
  pricePaise: number;
  creditsRemaining?: number;
  serviceCredits?: CustomerPackageCredit[];
  status: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface CustomerPackageCredit {
  id: string;
  serviceId: string;
  serviceName: string;
  remainingQty: number;
  totalQty: number;
  expiresAt?: string;
}

export interface CustomerPackagePlan {
  id: string;
  branchId: string;
  name: string;
  description: string;
  pricePaise: number;
  validityDays: number;
  paidSessions?: number;
  freeSessions?: number;
  serviceRows?: unknown[];
  serviceIds?: unknown[];
}

export interface PurchasePackagePayload {
  packageId: string;
  branchId?: string;
  idempotencyKey?: string;
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
  idempotencyKey?: string;
}

export interface ClaimGiftCardPayload {
  code: string;
  branchId?: string;
}

export interface RedeemGiftCardPayload {
  code: string;
  invoiceId: string;
  amountPaise: number;
  idempotencyKey?: string;
}

export interface RedeemGiftCardResponse {
  giftCardId: string;
  invoiceId: string;
  amountPaise: number;
  balanceAfterPaise: number;
}

export interface RedeemLoyaltyPayload {
  invoiceId: string;
  points: number;
  amountPaise: number;
  idempotencyKey?: string;
}

export interface RedeemLoyaltyResponse {
  redemptionId: string;
  invoiceId: string;
  points: number;
  amountPaise: number;
  balanceAfterPoints: number;
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

export interface CustomerPaymentMethod {
  id: string;
  recordType: "paymentMethod";
  title?: string;
  branchId: string;
  clientId: string;
  provider: string;
  methodType: string;
  brand: string;
  last4: string;
  expiryMonth?: number;
  expiryYear?: number;
  recurringEnabled: boolean;
  status: string;
  cardGuaranteeEligible: boolean;
  consentedAt?: string;
  lastUsedAt?: string;
  createdAt?: string;
  updatedAt?: string;
}

export interface CustomerRefund {
  id: string;
  recordType: "refund";
  title?: string;
  invoiceId: string;
  invoiceNumber: string;
  branchId: string;
  amountPaise: number;
  reason?: string;
  notes?: string;
  status: string;
  provider?: string;
  providerRefundId?: string;
  createdAt: string;
}

export interface CustomerPushProof {
  id?: string;
  recordType?: "pushProof";
  title?: string;
  status?: string;
  mobilePushProviderConfigured: boolean;
  latestCustomerNotifications: number;
  paymentProviderEnvironment: string;
  paymentProviders: Array<{ provider: string; enabled: boolean; webhookConfigured: boolean }>;
  proofLevel: string;
  note: string;
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

export interface CustomerCommerceCheckout {
  saleId: string;
  invoiceId: string;
  amountPaise: number;
  status: string;
  paymentRequired: boolean;
  activationRequired: boolean;
  paymentLink?: CustomerPaymentLink | null;
}

export interface CustomerProfileExtensionRecord {
  id: string;
  recordType?: string;
  branchId?: string;
  clientId?: string;
  bookingId?: string;
  ticketId?: string;
  authorType?: string;
  body?: string;
  title?: string;
  subject?: string;
  code?: string;
  category?: string;
  priority?: string;
  status?: string;
  latestMessage?: string;
  relationshipType?: string;
  accountCode?: string;
  employeeCode?: string;
  department?: string;
  spendingLimitPaise?: number;
  outstandingPaise?: number;
  remainingLimitPaise?: number;
  benefitLabel?: string;
  bookingClientId?: string;
  canBook?: boolean;
  photoType?: string;
  contentType?: string;
  byteSize?: number;
  goalType?: string;
  targetDate?: string;
  notes?: string;
  createdAt?: string;
  updatedAt?: string;
  completedAt?: string;
}

export interface CustomerBookingContactlessPayload {
  allergies?: string;
  sensitivities?: string;
  patchTestNotes?: string;
  goals?: string;
  budget?: string;
  timeframe?: string;
  preferences?: string;
  pregnancyContext?: string;
  consentAccepted: boolean;
  signatureName: string;
}

export interface CustomerBookingCheckInPayload {
  etaMinutes: number;
}

export interface CustomerBookingCheckInResult {
  appointmentId: string;
  etaMinutes: number;
  status: string;
  updatedAt?: string;
}

export interface CustomerBookingSelfPayPayload {
  amountPaise?: number;
  idempotencyKey?: string;
}

export interface CustomerSupportTicketPayload {
  branchId?: string;
  subject: string;
  body?: string;
  category?: "booking" | "payment" | "service" | "account" | "other";
  priority?: "normal" | "urgent";
  bookingId?: string;
}

export interface CustomerSupportMessagePayload {
  body: string;
}

export interface CustomerFamilyMemberPayload {
  branchId?: string;
  firstName: string;
  lastName?: string;
  phone?: string;
  relationshipType?: "spouse" | "parent" | "child" | "sibling" | "guardian" | "dependent" | "partner" | "other";
}

export interface CustomerGoalPayload {
  branchId?: string;
  title: string;
  goalType?: "hair" | "skin" | "wellness" | "event" | "other";
  targetDate?: string;
  notes?: string;
}

export interface CustomerNotification {
  id: string;
  type: string;
  channel: string;
  message: string;
  status: string;
  createdAt: string;
  bookingId?: string;
  resourceId?: string;
  deepLink?: string;
  metadata?: Record<string, unknown>;
}

export type CustomerPaymentRecord =
  | CustomerPayment
  | CustomerPaymentMethod
  | CustomerRefund
  | CustomerProfileExtensionRecord;

export type CustomerAccountModule =
  | CustomerRewardSummary
  | CustomerWallet
  | CustomerMembership[]
  | CustomerPackage[]
  | CustomerGiftCard[]
  | CustomerInvoice[]
  | CustomerPayment[]
  | CustomerPaymentMethod[]
  | CustomerRefund[]
  | CustomerPaymentRecord[]
  | CustomerProfileExtensionRecord[]
  | CustomerNotification[];
