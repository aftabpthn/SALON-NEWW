# Real API Integration Plan

Scope: this plan applies only to the standalone customer app in `customer-app/`.

Do not modify the existing SaaS frontend, backend, database, or config while executing this plan unless a separate backend task explicitly authorizes it. The existing SaaS remains the source of truth. The customer app should call only public/customer-safe APIs.

## 1. Mock Files

### Primary mock/local data source

- `src/app/core/mock-marketplace.service.ts`
  - Owns mock businesses, services, staff, reviews, policies, gallery images, offers, bookings, customer profile, latest booking, login/OTP fallback, booking fallback, cancel fallback, and reschedule fallback.
  - Uses `localStorage` key `auraCustomer` for local customer profile persistence.
  - Uses local `signal(...)` state for marketplace rows, bookings, loading, error, `usingMockData`, and `latestBooking`.
  - Attempts some API calls first, then silently falls back to local/demo behavior in `catch` blocks.

### API placeholder service

- `src/app/core/customer-api.service.ts`
  - Contains planned endpoint methods.
  - Currently hardcodes `private readonly baseUrl = "/api/v1"`.
  - Does not itself implement mock fallback, but its failures are caught by `MockMarketplaceService`.
  - Missing typed response models for auth/session, availability, booking actions, profile, notifications, favorites, payments, offers, support, and settings.

### Mock model definitions

- `src/app/core/models.ts`
  - Current models are UI-shaped and mock-friendly.
  - They include denormalized fields such as `businessName`, `popularService`, `nextAvailableSlot`, `ratingAverage`, `ratingCount`, `coverImage`, `galleryImages`, and nested `services`, `staff`, `reviews`.
  - `BookingDraft` is not a real backend create-booking payload yet.

### Page-level mock/static placeholders

- `src/app/features/booking/booking-flow.page.ts`
  - Hardcoded date carousel in `dates`.
  - Hardcoded availability in `slotGroups`.
  - Defaults selected service to mock id `service_1`.
  - Uses "Any available professional" as local staff option.
  - Shows "Availability is mocked for now".
  - Shows `Pay at venue` as static payment.

- `src/app/features/utility/notifications.page.ts`
  - Hardcoded notification cards: booking confirmed, reminder, offer unlocked.

- `src/app/features/utility/settings.page.ts`
  - Hardcoded toggles: booking reminders, marketing offers, location suggestions.
  - Toggle state is not persisted or loaded from API.

- `src/app/features/utility/help.page.ts`
  - Hardcoded help/support content.
  - No real support ticket/chat API.

- `src/app/features/profile/profile.page.ts`
  - Hardcoded "Beauty Pass" and "3 bookings completed".
  - Saved places and payment methods are UI-only links with no route/API.
  - Logout only clears local customer mock state.

- `src/app/features/home/home.page.ts`
  - "Use current location" button is UI-only.
  - Home ranking/recommended/nearby/popular services are computed locally from mock businesses.

- `src/app/features/search/search.page.ts`
  - Search, filters, sort, "Map" UI, price filter, "Female staff", and "Available today" are computed locally from mock data.
  - No backend query, geolocation, map, or live inventory.

- `src/app/features/business/business-profile.page.ts`
  - Directions/map copy is placeholder.
  - Business profile is read from local mock service.

- `src/app/features/bookings/bookings.page.ts`
  - Booking tabs are local filters over mock/local bookings.
  - Directions button is UI-only.
  - Cancel/reschedule call mock service fallback.

- `src/app/features/bookings/booking-detail.page.ts`
  - Timeline is derived from mock/local booking data.
  - Payment is static `Pay at venue`.
  - Cancellation policy and support are placeholder copy.

- `src/app/features/booking/booking-summary.page.ts`
  - Uses `latestBooking()` fallback or first mock booking.

- `src/app/features/booking/booking-success.page.ts`
  - Uses `latestBooking()` fallback or first mock booking.

- `src/app/features/auth/login.page.ts`
  - Phone login calls mock service.
  - Copy states OTP is mocked until APIs are live.

- `src/app/features/auth/verify-otp.page.ts`
  - Any 6 digits work in demo mode.
  - "Use demo OTP" sets `123456`.

- `src/app/features/onboarding/onboarding.page.ts`
  - Marketing-only screen with no API dependencies.

### Generated files not to edit directly

- `www/`
  - Contains compiled build output. It may include compiled mock strings.
  - Do not edit directly. Regenerate with `npm.cmd run build`.

## 2. Components Using Mock Data

Direct imports of `MockMarketplaceService`:

- `src/app/shared/business-card.component.ts`
  - Uses mock service only for `formatMoney`.
  - Receives `Business` input from pages.

- `src/app/features/home/home.page.ts`
  - Reads `businesses()`.
  - Locally computes featured, matching businesses, recommended, nearby, and popular services.

- `src/app/features/search/search.page.ts`
  - Reads `businesses()`.
  - Locally filters/sorts by open, top, nearest, offers, price, female staff, available today.

- `src/app/features/business/business-profile.page.ts`
  - Uses `findBusiness(slug)` for full profile, services, staff, reviews, policies.

- `src/app/features/booking/booking-flow.page.ts`
  - Uses `findBusiness(slug)`, local service/staff selection, static date/slot availability, and `createBooking(...)`.

- `src/app/features/booking/booking-summary.page.ts`
  - Uses `latestBooking()` or first mock booking.

- `src/app/features/booking/booking-success.page.ts`
  - Uses `latestBooking()` or first mock booking.

- `src/app/features/bookings/bookings.page.ts`
  - Uses `bookings()`, `cancelBooking(...)`, and `rescheduleBooking(...)`.

- `src/app/features/bookings/booking-detail.page.ts`
  - Uses `findBooking(id)`, `cancelBooking(...)`, and `rescheduleBooking(...)`.

- `src/app/features/offers/offers.page.ts`
  - Filters mock businesses by `hasOffer`.

- `src/app/features/profile/profile.page.ts`
  - Uses `customer()` and `logout()`.

- `src/app/features/auth/login.page.ts`
  - Uses `login(phone)`.

- `src/app/features/auth/verify-otp.page.ts`
  - Uses `verifyOtp(phone, otp)` and `customer().phone`.

Static/local placeholder pages that do not import the mock service:

- `src/app/features/utility/notifications.page.ts`
- `src/app/features/utility/settings.page.ts`
- `src/app/features/utility/help.page.ts`
- `src/app/features/onboarding/onboarding.page.ts`

## 3. Required Real API Endpoints

The customer app should use public/customer-safe endpoints only. All responses should be normalized by `CustomerApiService` before page components consume them.

### Public marketplace

- `GET /api/v1/public/businesses`
  - Query params:
    - `q?: string`
    - `category?: string`
    - `area?: string`
    - `city?: string`
    - `lat?: number`
    - `lng?: number`
    - `openNow?: boolean`
    - `topRated?: boolean`
    - `offers?: boolean`
    - `availableToday?: boolean`
    - `minPricePaise?: number`
    - `maxPricePaise?: number`
    - `staffGender?: string`
    - `sort?: "recommended" | "rating" | "distance" | "price"`
    - `limit?: number`
    - `cursor?: string`
  - Replaces home/search local filtering and mock business list.

- `GET /api/v1/public/businesses/:slug`
  - Returns full public business profile with categories, services, staff preview, reviews preview, policies, gallery, address, rating, current open status, next available slot, offers.

- `GET /api/v1/public/businesses/:slug/services`
  - Returns service groups/categories and bookable services.
  - Can be folded into the profile endpoint initially if payload size is acceptable.

- `GET /api/v1/public/businesses/:slug/staff`
  - Returns customer-safe staff list for booking selection.
  - Must not expose private staff/admin fields.
  - Include `allowAnyProfessional` metadata if supported.

- `GET /api/v1/public/businesses/:slug/reviews`
  - Query params: `limit`, `cursor`, `rating`.
  - Replaces mock review list.

- `GET /api/v1/public/businesses/:slug/offers`
  - Returns active public customer offers.

- `GET /api/v1/public/offers`
  - Returns marketplace-wide offers for the Offers tab.

### Availability

- `GET /api/v1/public/businesses/:slug/availability`
  - Query params:
    - `serviceId: string`
    - `staffId?: string`
    - `date: string` in `YYYY-MM-DD`
    - `timezone?: string`
  - Response should include available and unavailable slots grouped by day/period.
  - Replaces hardcoded `dates` and `slotGroups`.

- Optional: `GET /api/v1/public/businesses/:slug/availability/dates`
  - Query params: `serviceId`, `staffId?`, `startDate`, `days`.
  - Use if date availability needs to be loaded separately from time slots.

### Customer auth/session

- `POST /api/v1/customer/auth/request-otp`
  - Body: `{ phone: string }`
  - Response: `{ requestId: string, expiresAt: string, resendAfterSeconds: number }`

- `POST /api/v1/customer/auth/verify-otp`
  - Body: `{ phone: string, otp: string, requestId?: string }`
  - Response: `{ accessToken: string, refreshToken?: string, customer: CustomerProfile }`

- `POST /api/v1/customer/auth/logout`
  - Invalidates token/session where supported.

- Optional: `POST /api/v1/customer/auth/refresh`
  - Body: `{ refreshToken: string }`

### Customer profile/account

- `GET /api/v1/customer/profile`
  - Replaces `localStorage` profile fallback.

- `PATCH /api/v1/customer/profile`
  - Updates name, email, phone metadata, preferences.

- `GET /api/v1/customer/preferences`
  - Loads settings toggles.

- `PATCH /api/v1/customer/preferences`
  - Saves booking reminders, marketing offers, location suggestions, notification preferences.

- `GET /api/v1/customer/membership`
  - Returns Beauty Pass/member status, booking count, saved value, loyalty metadata.

### Customer bookings

- `POST /api/v1/customer/bookings`
  - Body should use real IDs, not denormalized UI names:
    - `businessSlug` or `businessId`
    - `serviceId`
    - `staffId?: string`
    - `startAt`
    - `timezone`
    - `notes?: string`
    - `offerId?: string`
    - `paymentMode?: "pay_at_venue" | "online"`
  - Response: `Booking`.

- `GET /api/v1/customer/bookings`
  - Query params: `status?: upcoming | past | cancelled`, `limit?: number`, `cursor?: string`.
  - Replaces local `bookings()` list and tab filtering.

- `GET /api/v1/customer/bookings/:id`
  - Replaces local `findBooking(id)`.

- `POST /api/v1/customer/bookings/:id/cancel`
  - Body: `{ reason?: string }`
  - Replaces local status mutation.

- `POST /api/v1/customer/bookings/:id/reschedule`
  - Body: `{ startAt: string, staffId?: string }`
  - Replaces local start-time mutation.

### Favorites/saved places

- `GET /api/v1/customer/favorites`
- `POST /api/v1/customer/favorites`
  - Body: `{ businessId: string }`
- `DELETE /api/v1/customer/favorites/:businessId`

### Notifications

- `GET /api/v1/customer/notifications`
  - Query params: `limit`, `cursor`, `unreadOnly?`.

- `POST /api/v1/customer/notifications/:id/read`
- `POST /api/v1/customer/notifications/read-all`

### Payments

- `GET /api/v1/customer/payment-methods`
- `POST /api/v1/customer/payment-methods`
- `DELETE /api/v1/customer/payment-methods/:id`

If online payments are not in scope initially, return a clear `paymentMode` capability on business/profile/booking endpoints and keep `pay_at_venue`.

### Location/maps

- `GET /api/v1/public/areas`
  - For city/area autocomplete.

- Optional geocoding/maps integration endpoint or direct platform provider integration:
  - `GET /api/v1/public/businesses/:slug/location`
  - or client-side map provider using business lat/lng returned in profile.

### Support/help

- `GET /api/v1/customer/support/topics`
- `POST /api/v1/customer/support/tickets`
- `GET /api/v1/customer/support/tickets`

## 4. Required Data Models

Current UI models should be split into API DTOs and UI view models so backend payloads do not need to match every display string.

### Marketplace models

```ts
interface MarketplaceBusiness {
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
  latitude?: number;
  longitude?: number;
  distanceKm?: number;
  ratingAverage: number;
  ratingCount: number;
  isOpen: boolean;
  nextAvailableSlot?: string;
  hasOffer: boolean;
  offerText?: string;
  coverImage?: string;
  galleryImages: string[];
  popularService?: string;
  startingPricePaise: number;
  categories: string[];
}
```

```ts
interface BusinessProfile extends MarketplaceBusiness {
  services: ServiceItem[];
  staff: StaffMember[];
  reviews: BusinessReview[];
  policies: string[];
  openingHours?: OpeningHours[];
  paymentModes: ("pay_at_venue" | "online")[];
}
```

### Service models

```ts
interface ServiceItem {
  id: string;
  businessId: string;
  name: string;
  description: string;
  durationMinutes: number;
  pricePaise: number;
  category: string;
  popular?: boolean;
  active: boolean;
}
```

Money must remain integer paise in API payloads and app logic. UI formats paise to INR.

### Staff models

```ts
interface StaffMember {
  id: string;
  businessId: string;
  name: string;
  title: string;
  rating?: number;
  specialty?: string;
  image?: string;
  nextAvailable?: string;
  bookableServiceIds?: string[];
}
```

### Review models

```ts
interface BusinessReview {
  id: string;
  businessId: string;
  author: string;
  rating: number;
  text: string;
  createdAt: string;
  dateLabel?: string;
}
```

### Availability models

```ts
interface AvailabilityQuery {
  businessSlug: string;
  serviceId: string;
  staffId?: string;
  date: string;
  timezone: string;
}

interface AvailabilityDay {
  date: string;
  label: string;
  dayLabel: string;
  periods: AvailabilityPeriod[];
}

interface AvailabilityPeriod {
  label: "Morning" | "Afternoon" | "Evening";
  slots: AvailabilitySlot[];
}

interface AvailabilitySlot {
  startAt: string;
  endAt: string;
  displayTime: string;
  available: boolean;
  staffId?: string;
}
```

### Auth/profile models

```ts
interface OtpRequestResponse {
  requestId: string;
  expiresAt: string;
  resendAfterSeconds: number;
}

interface AuthSession {
  accessToken: string;
  refreshToken?: string;
  customer: CustomerProfile;
}

interface CustomerProfile {
  id: string;
  name: string;
  phone: string;
  email?: string;
  avatarUrl?: string;
  isLoggedIn: boolean;
  bookingCount?: number;
  membershipLabel?: string;
}
```

### Booking models

```ts
interface CreateBookingPayload {
  businessId?: string;
  businessSlug: string;
  serviceId: string;
  staffId?: string;
  startAt: string;
  timezone: string;
  offerId?: string;
  notes?: string;
  paymentMode: "pay_at_venue" | "online";
}

interface Booking {
  id: string;
  reference: string;
  businessId: string;
  businessName: string;
  serviceId: string;
  serviceName: string;
  staffId?: string;
  staffName: string;
  startAt: string;
  displayStartAt: string;
  address: string;
  status: "pending" | "confirmed" | "completed" | "cancelled";
  paymentStatus?: "not_required" | "pending" | "paid" | "refunded";
  cancellationPolicy?: string;
}
```

### Other customer models

```ts
interface CustomerNotification {
  id: string;
  title: string;
  body: string;
  type: "booking" | "offer" | "system";
  readAt?: string;
  createdAt: string;
  actionUrl?: string;
}

interface CustomerPreferences {
  bookingReminders: boolean;
  marketingOffers: boolean;
  locationSuggestions: boolean;
  pushEnabled?: boolean;
}

interface CustomerFavorite {
  businessId: string;
  createdAt: string;
  business?: MarketplaceBusiness;
}

interface Offer {
  id: string;
  businessId?: string;
  title: string;
  description: string;
  badgeText: string;
  validUntil?: string;
  terms?: string[];
}
```

## 5. Required Environment Variables

Current state:

- No `src/environments/environment*.ts` files exist.
- `CustomerApiService` hardcodes `baseUrl = "/api/v1"`.
- No token storage config exists.

Required config before real API integration:

- `CUSTOMER_API_BASE_URL`
  - Example web/dev value: `/api/v1`
  - Example native value: `https://your-domain.example/api/v1`
  - Needed because Capacitor Android/iOS cannot rely on the same relative proxy behavior as local web dev.

- `CUSTOMER_APP_ENV`
  - Values: `development`, `staging`, `production`.
  - Used for diagnostics and selecting safe runtime behavior.

- `CUSTOMER_AUTH_TOKEN_STORAGE_KEY`
  - Example: `auraCustomerAccessToken`.
  - Allows replacing `auraCustomer` local profile storage with explicit session/token storage.

- `CUSTOMER_REFRESH_TOKEN_STORAGE_KEY`
  - Optional if refresh tokens are supported.

- `CUSTOMER_ENABLE_MOCK_FALLBACK`
  - Values: `true` in development only, `false` in staging/production.
  - Prevents silent fallback to mock bookings/auth in real builds.

- `CUSTOMER_MAPS_PROVIDER`
  - Optional: `none`, `google`, `mapbox`, or platform-specific provider.

- `CUSTOMER_MAPS_API_KEY`
  - Optional. Use only if map provider is introduced.

Recommended implementation approach:

- Add a small customer-app-only runtime config file, for example `src/app/core/customer-app.config.ts`, and optionally load production values from `assets/customer-config.json`.
- Keep secrets out of the client. Public map keys are not secrets; API secrets must never be shipped in the app.
- Do not add or modify SaaS `.env` files from this customer-app task.

## 6. Exact Steps To Replace Mocks With Real API Calls

### Phase 1: Introduce API config without changing UI

1. Add customer-app-only config for API base URL and mock fallback flag.
2. Update `CustomerApiService` to use the configured base URL instead of hardcoded `/api/v1`.
3. Add typed API response wrappers and mapping helpers.
4. Keep `MockMarketplaceService` in place temporarily, but rename the future real facade target in planning as `MarketplaceService`.
5. Build with `npm.cmd run build`.

### Phase 2: Replace public marketplace reads

1. Add real methods to `CustomerApiService`:
   - `searchBusinesses(params)`
   - `getBusinessProfile(slug)`
   - `getBusinessServices(slug)`
   - `getBusinessStaff(slug)`
   - `getBusinessReviews(slug, params)`
   - `listOffers(params)`
2. Create a new customer-app-only facade service, for example `MarketplaceService`, that owns signals for businesses, selected business, loading, and errors.
3. Move `formatMoney` into a small utility or keep it in the new facade.
4. Replace `MockMarketplaceService.businesses()` usage in:
   - `home.page.ts`
   - `search.page.ts`
   - `offers.page.ts`
   - `business-profile.page.ts`
   - `business-card.component.ts` if still needed for formatting.
5. Keep mock data behind `CUSTOMER_ENABLE_MOCK_FALLBACK=true` for development only.
6. Build and verify:
   - `/tabs/home`
   - `/tabs/search`
   - `/tabs/offers`
   - `/business/:slug`

### Phase 3: Replace availability

1. Add typed availability methods:
   - `getAvailability(slug, { serviceId, staffId, date, timezone })`
   - optional `getAvailabilityDates(...)`.
2. Replace hardcoded `dates` and `slotGroups` in `booking-flow.page.ts`.
3. When service or staff changes, reload availability.
4. Store selected slot as real `startAt` ISO timestamp, not display text.
5. Disable confirm until a real available slot is selected.
6. Build and verify booking flow through confirmation screen.

### Phase 4: Replace customer auth/profile

1. Add an `AuthSessionService` inside `customer-app/src/app/core`.
2. Replace `MockMarketplaceService.login(...)` with:
   - `CustomerApiService.requestOtp(phone)`
   - store `requestId`
   - navigate to OTP.
3. Replace `verifyOtp(...)` with:
   - `CustomerApiService.verifyOtp(phone, otp, requestId)`
   - store `accessToken` and `refreshToken` where appropriate.
   - load customer profile from response or `GET /customer/profile`.
4. Add an HTTP interceptor or request wrapper to attach `Authorization: Bearer <token>` to customer endpoints.
5. Replace `localStorage` profile object with session/profile services.
6. Update `profile.page.ts` to load real profile and membership data.
7. Build and verify login, OTP, logout, profile.

### Phase 5: Replace booking creation/list/detail

1. Replace `BookingDraft` with `CreateBookingPayload`.
2. In `booking-flow.page.ts`, submit real IDs:
   - `businessSlug` or `businessId`
   - `serviceId`
   - `staffId`
   - `startAt`
   - `timezone`
   - `paymentMode`
3. Replace `latestBooking()` with navigation to returned booking id:
   - `/bookings/:id` or `/booking/success?id=:id`.
4. Replace `bookings.page.ts` local `bookings()` with `GET /customer/bookings?status=...`.
5. Replace `booking-detail.page.ts` local `findBooking(id)` with `GET /customer/bookings/:id`.
6. Build and verify create, list, detail, success.

### Phase 6: Replace cancel/reschedule

1. Replace local `cancelBooking(id)` mutation with `POST /customer/bookings/:id/cancel`.
2. Replace local `rescheduleBooking(id, startsAt)` mutation with a real reschedule flow:
   - open date/time picker or route back to booking flow with existing booking id.
   - call `GET availability`.
   - call `POST /customer/bookings/:id/reschedule`.
3. Refresh booking detail/list after action succeeds.
4. Show backend validation errors instead of silently mutating local state.
5. Build and verify alert flows.

### Phase 7: Replace profile extras

1. Saved places:
   - Wire favorite button in `business-card.component.ts`.
   - Wire saved places menu in `profile.page.ts`.
   - Use `/customer/favorites`.
2. Notifications:
   - Replace hardcoded `notifications.page.ts` cards with `/customer/notifications`.
   - Add read/read-all actions if needed.
3. Settings:
   - Replace hardcoded toggles with `/customer/preferences`.
   - Persist toggle changes.
4. Help/support:
   - Replace static help with `/customer/support/topics`.
   - Add ticket creation if support is in scope.
5. Payment methods:
   - Add a real page or hide the menu item until `/customer/payment-methods` exists.

### Phase 8: Remove mock fallback from production

1. Keep `mock-marketplace.service.ts` only for local development/story/demo if needed.
2. Ensure `CUSTOMER_ENABLE_MOCK_FALLBACK=false` in staging/production.
3. Fail loudly for missing required APIs in production builds.
4. Remove demo-only UI text:
   - "mocked until APIs are live"
   - "Use demo OTP"
   - "Availability is mocked for now"
   - "Added booking locally for demo"
5. Build with `npm.cmd run build`.
6. Run `npx.cmd cap sync`.

## Mock Feature Inventory

### Mock marketplace

- Business list is hardcoded in `MockMarketplaceService.businesses`.
- Marketplace images are Unsplash URLs generated by local `image(...)` helper.
- Home/search/offers/business profile all consume this mock business list.

### Mock businesses

Hardcoded businesses:

1. Aura Luxe Studio
2. Velvet Nail Bar
3. Moon Ritual Spa
4. The Groom Room
5. Skin Theory Clinic
6. Bloom Hair Atelier
7. Zen Massage House
8. Urban Glow Beauty

### Mock services

- Services are nested under each mock business.
- Prices are integer paise and should stay that way.
- Service availability is not validated against real staff calendars.

### Mock staff

- Staff are nested under each mock business.
- Staff ratings, specialties, images, and next available labels are hardcoded.
- "Any available professional" is local UI logic.

### Mock reviews

- Reviews are nested under each mock business.
- No review pagination, moderation, verified booking status, or backend source.

### Mock bookings

- Bookings are hardcoded in `MockMarketplaceService.bookings`.
- Newly created bookings are prepended to local signal state.
- Latest booking is tracked in `latestBooking`.
- Booking references are generated locally with `Math.random()`.

### Mock OTP/login

- `login(phone)` attempts `requestOtp`, then continues in demo mode on failure.
- `verifyOtp(phone, otp)` attempts `verifyOtp`, then continues in demo mode on failure.
- OTP page accepts any 6 digits and has a "Use demo OTP" action.
- Customer profile is stored locally in `localStorage`.

### Mock cancel/reschedule

- `cancelBooking(id)` attempts API, then locally sets `status: "cancelled"` on failure.
- `rescheduleBooking(id, startsAt)` attempts API, then locally sets a new display time and `status: "confirmed"` on failure.
- Default reschedule time is hardcoded as `Tomorrow, 11:30 AM`.

### Mock availability

- `booking-flow.page.ts` hardcodes dates and time slots.
- `CustomerApiService.getAvailability(...)` exists but is not used by the booking flow yet.
- Availability is display text, not real ISO timestamps.

### Mock profile

- Customer profile defaults to `{ name: "Guest", phone: "", isLoggedIn: false }`.
- Logged-in demo profile is `{ name: "Nisha Kapoor", phone, isLoggedIn: true }`.
- Profile page includes static Beauty Pass and completed booking count.
- Logout clears local profile only.

### Mock notifications/settings/help

- Notifications page uses hardcoded cards.
- Settings toggles are hardcoded and not persisted.
- Help/support content is hardcoded.

### API fallback behavior

Fallback is in `MockMarketplaceService`, not `CustomerApiService`:

- `loadPublicBusinesses()` falls back to mock businesses.
- `login()` falls back to local customer profile.
- `verifyOtp()` falls back to demo login.
- `createBooking()` falls back to local booking creation.
- `cancelBooking()` falls back to local cancellation.
- `rescheduleBooking()` falls back to local reschedule.

## Completion Criteria For Real Integration

- No production route depends on `MockMarketplaceService`.
- No production flow silently succeeds after an API failure.
- Business, service, staff, review, availability, booking, profile, notifications, settings, favorites, and offers load from real customer-safe APIs.
- Booking create/cancel/reschedule return backend-confirmed state.
- Auth uses real OTP/session tokens.
- `npm.cmd run build` passes.
- `npx.cmd cap sync` passes after build.
