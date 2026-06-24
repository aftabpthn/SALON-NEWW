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

export interface LiveConsultationRequest {
  message: string;
  goals: string[];
  location?: { label?: string; lat?: number; lng?: number } | null;
  photos: LiveConsultationPhoto[];
  businesses: LiveConsultationBusinessContext[];
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
  mode: "groq" | "local" | string;
  provider: "groq" | "local_rules" | string;
  providerWarning?: string;
  answer: string;
  actionPlan: string[];
  recommendedSalons: LiveConsultationSalonRecommendation[];
  recommendedServices: LiveConsultationServiceRecommendation[];
  locationInsights: string[];
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
  name: string;
  firstName?: string;
  lastName?: string;
  phone: string;
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

export interface CancelBookingPayload {
  reason?: string;
}

export interface RescheduleBookingPayload {
  startAt: string;
  staffId?: string;
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
  channel: string;
  message: string;
  status: string;
  createdAt: string;
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
