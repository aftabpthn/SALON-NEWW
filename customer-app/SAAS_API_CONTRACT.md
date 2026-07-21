# SaaS API Contract For Customer App

This contract defines the backend APIs required by the Ionic Angular customer app in this folder. The existing SaaS backend remains the source of truth for customers, businesses, branches, staff, services, availability, bookings, reviews, and favorites.

The customer app must not create or maintain a separate booking database. All booking and availability decisions must be made by the SaaS backend.

## Global Rules

- Base URL comes from `environment.apiBaseUrl`.
- All endpoint paths below are relative to `/api/v1`.
- Authenticated customer endpoints require `Authorization: Bearer <customerAccessToken>`.
- Public endpoints must not require customer auth.
- Public endpoints may expose only approved public business data. Do not expose internal tenant settings, staff private data, cost data, audit fields, or non-public customer details.
- All money values are integer INR paise, for example `120000` for INR 1,200.00.
- Timestamps must be ISO 8601 strings.
- Backend must calculate availability from real business hours, staff schedules, service duration, existing appointments, blackout dates, branch timezone, and booking rules.
- Backend must recheck the slot inside the booking transaction before creating or rescheduling a booking.
- Backend must prevent double booking.
- Customers can only access their own bookings, profile, favorites, and reviews.
- Every tenant-scoped lookup must validate `tenantId`. Every branch-scoped lookup must validate `branchId`.
- Public business URLs use `slug`, but backend must resolve the slug to a real business/tenant/branch record and validate that the business is public/bookable.

## Response Envelope

Preferred success shape:

```json
{
  "success": true,
  "data": {}
}
```

Preferred list shape:

```json
{
  "success": true,
  "data": {
    "rows": [],
    "nextCursor": null
  }
}
```

Preferred error shape:

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid request",
    "details": {
      "field": "phone"
    }
  }
}
```

Common error codes:

- `VALIDATION_ERROR`
- `UNAUTHORIZED`
- `FORBIDDEN`
- `NOT_FOUND`
- `CONFLICT`
- `SLOT_UNAVAILABLE`
- `RATE_LIMITED`
- `INTERNAL_ERROR`

## Shared Data Models

### Business

Required public fields:

```json
{
  "id": "business_123",
  "slug": "aura-luxe-studio",
  "businessName": "Aura Luxe Studio",
  "category": "Hair salon",
  "description": "Premium salon and beauty studio.",
  "address": "12 100 Feet Road",
  "area": "Indiranagar",
  "city": "Bengaluru",
  "latitude": 12.9716,
  "longitude": 77.5946,
  "distanceKm": 1.2,
  "ratingAverage": 4.9,
  "ratingCount": 284,
  "isOpen": true,
  "nextAvailableSlot": "2026-06-18T17:30:00+05:30",
  "hasOffer": true,
  "offerText": "20% off first visit",
  "coverImage": "https://cdn.example.com/businesses/aura/cover.jpg",
  "galleryImages": ["https://cdn.example.com/businesses/aura/1.jpg"],
  "popularService": "Hair spa",
  "startingPricePaise": 120000,
  "categories": ["hair", "spa"],
  "policies": ["Cancel free up to 4 hours before appointment."],
  "paymentModes": ["pay_at_venue", "online"]
}
```

Database fields required:

- Public business profile: `id`, `tenantId`, `branchId`, `slug`, `businessName`, `category`, `description`, `status`, `isPublic`, `isBookable`.
- Location: `address`, `area`, `city`, `latitude`, `longitude`.
- Media: public cover image and gallery image references.
- Ratings summary: average rating and review count, either stored or calculated.
- Pricing summary: starting service price in paise.
- Offer summary: active public offer reference or text.

Security and validation:

- Only return businesses with public marketplace visibility enabled.
- Never expose internal tenant, branch, staff, or customer records.
- Validate that returned branch belongs to the business tenant.

### Service

```json
{
  "id": "service_123",
  "businessId": "business_123",
  "name": "Hair spa",
  "description": "Deep nourishing hair spa treatment.",
  "durationMinutes": 60,
  "pricePaise": 120000,
  "category": "Hair",
  "popular": true,
  "active": true
}
```

Database fields required:

- `id`, `tenantId`, `branchId`, `businessId` or equivalent branch/service relation.
- `name`, `description`, `durationMinutes`, `pricePaise`, `category`, `active`, `publicBookable`.

Security and validation:

- Return only active, public-bookable services for the requested public business/branch.
- Price must be integer paise.

### Staff

```json
{
  "id": "staff_123",
  "businessId": "business_123",
  "name": "Maya Rao",
  "title": "Senior stylist",
  "rating": 4.8,
  "specialty": "Hair spa and color",
  "image": "https://cdn.example.com/staff/maya.jpg",
  "nextAvailable": "2026-06-18T17:30:00+05:30",
  "bookableServiceIds": ["service_123"]
}
```

Database fields required:

- `id`, `tenantId`, `branchId`, `name`, `role/title`, `status`, `publicBookable`.
- Service capability mapping between staff and services.
- Public avatar/image reference if available.

Security and validation:

- Return only active public-bookable staff for the requested business/branch.
- Do not expose staff phone, email, payroll, permissions, or internal schedule notes.

### Review

```json
{
  "id": "review_123",
  "businessId": "business_123",
  "author": "Priya S.",
  "rating": 5,
  "text": "Beautiful space and excellent service.",
  "createdAt": "2026-06-12T10:30:00+05:30"
}
```

Database fields required:

- `id`, `tenantId`, `branchId`, `businessId`, `bookingId`, `customerId`, `rating`, `text`, `status`, `createdAt`.

Security and validation:

- Public review list returns only approved reviews.
- Public review author must be masked or display-name only.

### Availability

```json
{
  "date": "2026-06-18",
  "label": "Today",
  "dayLabel": "Thu",
  "periods": [
    {
      "label": "Evening",
      "slots": [
        {
          "startAt": "2026-06-18T17:30:00+05:30",
          "endAt": "2026-06-18T18:30:00+05:30",
          "displayTime": "5:30 PM",
          "available": true,
          "staffId": "staff_123"
        }
      ]
    }
  ]
}
```

Database fields required:

- Business/branch hours, staff schedules, staff service capability, appointments/bookings, blackout periods, service duration, cleanup/buffer rules, timezone.

Security and validation:

- Availability must be calculated by backend.
- Do not trust requested staff, service, or time without validating against real branch/business data.

### Customer Profile

```json
{
  "id": "customer_123",
  "name": "Priya Sharma",
  "phone": "+919876543210",
  "email": "priya@example.com",
  "avatarUrl": "https://cdn.example.com/customers/priya.jpg",
  "isLoggedIn": true,
  "bookingCount": 3,
  "membershipLabel": "Beauty Pass"
}
```

Database fields required:

- `id`, `phone`, `name`, `email`, `avatarUrl`, `createdAt`, `updatedAt`.
- Customer identity mapping to bookings and favorites.

Security and validation:

- Authenticated customer can read/update only their own profile.

### Booking

```json
{
  "id": "booking_123",
  "reference": "AUR-20260618-001",
  "businessId": "business_123",
  "businessName": "Aura Luxe Studio",
  "serviceId": "service_123",
  "serviceName": "Hair spa",
  "staffId": "staff_123",
  "staffName": "Maya Rao",
  "startAt": "2026-06-18T17:30:00+05:30",
  "displayStartAt": "Thu, 18 Jun, 5:30 PM",
  "address": "12 100 Feet Road, Indiranagar",
  "status": "confirmed",
  "paymentStatus": "not_required",
  "cancellationPolicy": "Cancel free up to 4 hours before appointment."
}
```

Database fields required:

- `id`, `tenantId`, `branchId`, `businessId`, `customerId`, `serviceId`, `staffId`, `startAt`, `endAt`, `status`, `paymentStatus`, `reference`, `notes`, `createdAt`, `updatedAt`.
- Service price snapshot in integer paise if backend needs historical booking pricing.

Security and validation:

- Customers can list/get/cancel/reschedule only their own bookings.
- Backend must validate business, branch, service, staff, customer, status transitions, and slot availability.
- No double booking.

## Authentication Endpoints

### POST /api/v1/customer/auth/request-otp

Auth required: No.

Request body:

```json
{
  "phone": "+919876543210"
}
```

Query params: None.

Response JSON example:

```json
{
  "success": true,
  "data": {
    "requestId": "otp_req_123",
    "expiresAt": "2026-06-18T10:10:00+05:30",
    "resendAfterSeconds": 30
  }
}
```

Error response example:

```json
{
  "success": false,
  "error": {
    "code": "RATE_LIMITED",
    "message": "Please wait before requesting another OTP",
    "details": {
      "resendAfterSeconds": 30
    }
  }
}
```

Required database fields:

- Customer identity by phone.
- OTP request table or equivalent: `id`, `phone`, `otpHash`, `expiresAt`, `attemptCount`, `consumedAt`, `createdAt`.

Security rules:

- Rate limit by phone, IP, and device fingerprint if available.
- Store OTP hashes only. Do not store plain OTP.
- Do not reveal whether a phone number already exists.

Tenant/business/branch validation:

- Customer identity is global or marketplace-scoped. Do not bind OTP request to a branch.

### POST /api/v1/customer/auth/verify-otp

Auth required: No.

Request body:

```json
{
  "phone": "+919876543210",
  "otp": "000000",
  "requestId": "otp_req_123"
}
```

Query params: None.

Response JSON example:

```json
{
  "success": true,
  "data": {
    "accessToken": "customer.jwt.token",
    "refreshToken": "optional.refresh.token",
    "customer": {
      "id": "customer_123",
      "name": "Priya Sharma",
      "phone": "+919876543210",
      "email": "priya@example.com",
      "isLoggedIn": true
    }
  }
}
```

Error response example:

```json
{
  "success": false,
  "error": {
    "code": "UNAUTHORIZED",
    "message": "Invalid or expired OTP"
  }
}
```

Required database fields:

- OTP request fields above.
- Customer record: `id`, `phone`, `name`, `email`, `createdAt`, `updatedAt`.
- Token/session revocation fields if refresh tokens are used.

Security rules:

- Validate OTP hash, expiry, request ID, phone, and attempt count.
- Mark OTP consumed after successful verification.
- Issue a customer-scoped token, not an internal staff/admin token.

Tenant/business/branch validation:

- No branch access is granted by the customer token. Customer endpoint authorization must be based on `customerId`.

### POST /api/v1/customer/auth/logout

Auth required: Yes.

Request body:

```json
{}
```

Query params: None.

Response JSON example:

```json
{
  "success": true,
  "data": null
}
```

Error response example:

```json
{
  "success": false,
  "error": {
    "code": "UNAUTHORIZED",
    "message": "Customer session is invalid"
  }
}
```

Required database fields:

- Customer session or refresh token records if token revocation is supported.

Security rules:

- Revoke current refresh token/session if applicable.
- Access token can expire naturally if stateless JWT is used.

Tenant/business/branch validation:

- Validate token belongs to a customer identity.

### GET /api/v1/customer/me

Auth required: Yes.

Request body: None.

Query params: None.

Response JSON example:

```json
{
  "success": true,
  "data": {
    "id": "customer_123",
    "name": "Priya Sharma",
    "phone": "+919876543210",
    "email": "priya@example.com",
    "avatarUrl": null,
    "isLoggedIn": true,
    "bookingCount": 3,
    "membershipLabel": "Beauty Pass"
  }
}
```

Error response example:

```json
{
  "success": false,
  "error": {
    "code": "UNAUTHORIZED",
    "message": "Login required"
  }
}
```

Required database fields:

- Customer profile fields and booking count aggregate.

Security rules:

- Return only the authenticated customer's profile.

Tenant/business/branch validation:

- Booking count must count only bookings owned by this customer.

### PATCH /api/v1/customer/me

Auth required: Yes.

Request body:

```json
{
  "name": "Priya Sharma",
  "email": "priya@example.com",
  "avatarUrl": "https://cdn.example.com/customers/priya.jpg"
}
```

Query params: None.

Response JSON example:

```json
{
  "success": true,
  "data": {
    "id": "customer_123",
    "name": "Priya Sharma",
    "phone": "+919876543210",
    "email": "priya@example.com",
    "avatarUrl": "https://cdn.example.com/customers/priya.jpg",
    "isLoggedIn": true
  }
}
```

Error response example:

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Email is invalid",
    "details": {
      "field": "email"
    }
  }
}
```

Required database fields:

- Customer profile fields with `updatedAt`.

Security rules:

- Only allow safe editable profile fields.
- Do not allow phone change here unless a separate OTP verification flow exists.

Tenant/business/branch validation:

- Update only authenticated customer record.

## Public Marketplace Endpoints

### GET /api/v1/public/businesses

Auth required: No.

Request body: None.

Query params:

- `category`: category slug.
- `area`: public area filter.
- `city`: public city filter.
- `lat`, `lng`: customer location for distance calculation.
- `openNow`: `true` or `false`.
- `topRated`: `true` or `false`.
- `offers`: `true` or `false`.
- `availableToday`: `true` or `false`.
- `minPricePaise`, `maxPricePaise`: integer paise.
- `staffGender`: optional public staff preference if backend supports it.
- `sort`: `recommended`, `rating`, `distance`, or `price`.
- `limit`: page size.
- `cursor`: pagination cursor.

Response JSON example:

```json
{
  "success": true,
  "data": {
    "rows": [
      {
        "id": "business_123",
        "slug": "aura-luxe-studio",
        "businessName": "Aura Luxe Studio",
        "category": "Hair salon",
        "description": "Premium salon and beauty studio.",
        "address": "12 100 Feet Road",
        "area": "Indiranagar",
        "city": "Bengaluru",
        "distanceKm": 1.2,
        "ratingAverage": 4.9,
        "ratingCount": 284,
        "isOpen": true,
        "nextAvailableSlot": "2026-06-18T17:30:00+05:30",
        "hasOffer": true,
        "offerText": "20% off first visit",
        "coverImage": "https://cdn.example.com/businesses/aura/cover.jpg",
        "galleryImages": [],
        "popularService": "Hair spa",
        "startingPricePaise": 120000,
        "categories": ["hair", "spa"],
        "services": [],
        "staff": [],
        "reviews": []
      }
    ],
    "nextCursor": null
  }
}
```

Error response example:

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid sort option",
    "details": {
      "field": "sort"
    }
  }
}
```

Required database fields:

- Business, branch, public profile, media, service pricing, ratings, offers, business hours.

Security rules:

- Return public summary fields only.
- Never expose tenant secrets, inactive businesses, private branches, or internal IDs that are not intended for public linking.

Tenant/business/branch validation:

- Each returned business must map to a valid tenant and public branch.
- Branch must be active and bookable.

### GET /api/v1/public/businesses/:slug

Auth required: No.

Request body: None.

Query params:

- `lat`, `lng`: optional for distance calculation.

Response JSON example:

```json
{
  "success": true,
  "data": {
    "id": "business_123",
    "slug": "aura-luxe-studio",
    "businessName": "Aura Luxe Studio",
    "category": "Hair salon",
    "description": "Premium salon and beauty studio.",
    "address": "12 100 Feet Road, Indiranagar",
    "area": "Indiranagar",
    "city": "Bengaluru",
    "latitude": 12.9716,
    "longitude": 77.5946,
    "ratingAverage": 4.9,
    "ratingCount": 284,
    "isOpen": true,
    "nextAvailableSlot": "2026-06-18T17:30:00+05:30",
    "hasOffer": true,
    "offerText": "20% off first visit",
    "coverImage": "https://cdn.example.com/businesses/aura/cover.jpg",
    "galleryImages": ["https://cdn.example.com/businesses/aura/1.jpg"],
    "popularService": "Hair spa",
    "startingPricePaise": 120000,
    "categories": ["hair", "spa"],
    "services": [],
    "staff": [],
    "reviews": [],
    "policies": ["Cancel free up to 4 hours before appointment."],
    "paymentModes": ["pay_at_venue", "online"]
  }
}
```

Error response example:

```json
{
  "success": false,
  "error": {
    "code": "NOT_FOUND",
    "message": "Business not found"
  }
}
```

Required database fields:

- Full public business profile, branch, location, media, hours, policies, payment settings.

Security rules:

- Return only approved public profile data.

Tenant/business/branch validation:

- Resolve slug to active public business/branch.
- Validate branch belongs to the resolved tenant/business.

### GET /api/v1/public/businesses/:slug/services

Auth required: No.

Request body: None.

Query params:

- `category`: optional service category.

Response JSON example:

```json
{
  "success": true,
  "data": {
    "rows": [
      {
        "id": "service_123",
        "businessId": "business_123",
        "name": "Hair spa",
        "description": "Deep nourishing hair spa treatment.",
        "durationMinutes": 60,
        "pricePaise": 120000,
        "category": "Hair",
        "popular": true,
        "active": true
      }
    ]
  }
}
```

Error response example:

```json
{
  "success": false,
  "error": {
    "code": "NOT_FOUND",
    "message": "Business not found"
  }
}
```

Required database fields:

- Service catalog linked to tenant and branch, including duration and integer paise price.

Security rules:

- Return only active public-bookable services.

Tenant/business/branch validation:

- Validate slug to tenant/branch, then list services for that branch only.

### GET /api/v1/public/businesses/:slug/staff

Auth required: No.

Request body: None.

Query params:

- `serviceId`: optional filter to staff who can perform a service.

Response JSON example:

```json
{
  "success": true,
  "data": {
    "rows": [
      {
        "id": "staff_123",
        "businessId": "business_123",
        "name": "Maya Rao",
        "title": "Senior stylist",
        "rating": 4.8,
        "specialty": "Hair spa and color",
        "image": "https://cdn.example.com/staff/maya.jpg",
        "nextAvailable": "2026-06-18T17:30:00+05:30",
        "bookableServiceIds": ["service_123"]
      }
    ]
  }
}
```

Error response example:

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Service does not belong to this business"
  }
}
```

Required database fields:

- Staff records, staff public profile fields, service capability mapping, schedules.

Security rules:

- Do not expose private staff data.

Tenant/business/branch validation:

- Validate staff and service belong to the same tenant/branch as the public business.

### GET /api/v1/public/businesses/:slug/availability

Auth required: No.

Request body: None.

Query params:

- `serviceId`: required.
- `staffId`: optional. If omitted, backend may return any available professional.
- `date`: required, `YYYY-MM-DD`.
- `timezone`: optional IANA timezone or offset.

Response JSON example:

```json
{
  "success": true,
  "data": {
    "rows": [
      {
        "date": "2026-06-18",
        "label": "Today",
        "dayLabel": "Thu",
        "periods": [
          {
            "label": "Evening",
            "slots": [
              {
                "startAt": "2026-06-18T17:30:00+05:30",
                "endAt": "2026-06-18T18:30:00+05:30",
                "displayTime": "5:30 PM",
                "available": true,
                "staffId": "staff_123"
              }
            ]
          }
        ]
      }
    ]
  }
}
```

Error response example:

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "serviceId is required",
    "details": {
      "field": "serviceId"
    }
  }
}
```

Required database fields:

- Business hours, branch timezone, service duration, staff schedules, staff-service mapping, existing bookings, blocked slots.

Security rules:

- Availability is calculated by backend only.
- Never trust client-generated slots.

Tenant/business/branch validation:

- Validate slug, branch, service, and optional staff all belong together.

### GET /api/v1/public/categories

Auth required: No.

Request body: None.

Query params: None.

Response JSON example:

```json
{
  "success": true,
  "data": {
    "rows": [
      {
        "id": "cat_hair",
        "label": "Hair",
        "slug": "hair"
      }
    ]
  }
}
```

Error response example:

```json
{
  "success": false,
  "error": {
    "code": "INTERNAL_ERROR",
    "message": "Could not load categories"
  }
}
```

Required database fields:

- Public marketplace category table or derived categories from active public services/businesses.

Security rules:

- Return only public categories.

Tenant/business/branch validation:

- If categories are tenant-derived, include only categories from public/bookable tenants and branches.

### GET /api/v1/public/search

Auth required: No.

Request body: None.

Query params:

- `q`: text query.
- `category`, `area`, `city`, `lat`, `lng`, `openNow`, `topRated`, `offers`, `availableToday`, `minPricePaise`, `maxPricePaise`, `staffGender`, `sort`, `limit`, `cursor`.

Response JSON example:

```json
{
  "success": true,
  "data": {
    "rows": [
      {
        "id": "business_123",
        "slug": "aura-luxe-studio",
        "businessName": "Aura Luxe Studio",
        "category": "Hair salon",
        "description": "Premium salon and beauty studio.",
        "address": "12 100 Feet Road",
        "area": "Indiranagar",
        "city": "Bengaluru",
        "distanceKm": 1.2,
        "ratingAverage": 4.9,
        "ratingCount": 284,
        "isOpen": true,
        "nextAvailableSlot": "2026-06-18T17:30:00+05:30",
        "hasOffer": true,
        "offerText": "20% off first visit",
        "coverImage": "https://cdn.example.com/businesses/aura/cover.jpg",
        "galleryImages": [],
        "popularService": "Hair spa",
        "startingPricePaise": 120000,
        "categories": ["hair", "spa"],
        "services": [],
        "staff": [],
        "reviews": []
      }
    ],
    "nextCursor": null
  }
}
```

Error response example:

```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid price range"
  }
}
```

Required database fields:

- Same as public business list plus searchable service/category/area indexes as needed.

Security rules:

- Search only public marketplace data.

Tenant/business/branch validation:

- Every returned result must be active, public, branch-valid, and bookable.

## Customer Booking Endpoints

### GET /api/v1/customer/bookings

Auth required: Yes.

Request body: None.

Query params:

- `status`: `upcoming`, `past`, or `cancelled`.
- `limit`: optional.
- `cursor`: optional.

Response JSON example:

```json
{
  "success": true,
  "data": {
    "rows": [
      {
        "id": "booking_123",
        "reference": "AUR-20260618-001",
        "businessId": "business_123",
        "businessName": "Aura Luxe Studio",
        "serviceId": "service_123",
        "serviceName": "Hair spa",
        "staffId": "staff_123",
        "staffName": "Maya Rao",
        "startAt": "2026-06-18T17:30:00+05:30",
        "displayStartAt": "Thu, 18 Jun, 5:30 PM",
        "address": "12 100 Feet Road, Indiranagar",
        "status": "confirmed",
        "paymentStatus": "not_required",
        "cancellationPolicy": "Cancel free up to 4 hours before appointment."
      }
    ],
    "nextCursor": null
  }
}
```

Error response example:

```json
{
  "success": false,
  "error": {
    "code": "UNAUTHORIZED",
    "message": "Login required"
  }
}
```

Required database fields:

- Booking table plus joins/snapshots for business, branch, service, staff, customer.

Security rules:

- Return only bookings owned by authenticated customer.

Tenant/business/branch validation:

- Booking rows must remain tenant and branch scoped internally.

### GET /api/v1/customer/bookings/:id

Auth required: Yes.

Request body: None.

Query params: None.

Response JSON example:

```json
{
  "success": true,
  "data": {
    "id": "booking_123",
    "reference": "AUR-20260618-001",
    "businessId": "business_123",
    "businessName": "Aura Luxe Studio",
    "serviceId": "service_123",
    "serviceName": "Hair spa",
    "staffId": "staff_123",
    "staffName": "Maya Rao",
    "startAt": "2026-06-18T17:30:00+05:30",
    "displayStartAt": "Thu, 18 Jun, 5:30 PM",
    "address": "12 100 Feet Road, Indiranagar",
    "status": "confirmed",
    "paymentStatus": "not_required",
    "cancellationPolicy": "Cancel free up to 4 hours before appointment."
  }
}
```

Error response example:

```json
{
  "success": false,
  "error": {
    "code": "NOT_FOUND",
    "message": "Booking not found"
  }
}
```

Required database fields:

- Booking table and related public business/service/staff display fields.

Security rules:

- Do not return a booking unless `booking.customerId` matches authenticated customer.

Tenant/business/branch validation:

- Validate booking tenant and branch before joining related records.

### POST /api/v1/customer/bookings

Auth required: Yes.

Request body:

```json
{
  "businessSlug": "aura-luxe-studio",
  "businessId": "business_123",
  "serviceId": "service_123",
  "staffId": "staff_123",
  "startAt": "2026-06-18T17:30:00+05:30",
  "timezone": "Asia/Kolkata",
  "offerId": "offer_123",
  "notes": "Please use mild products.",
  "paymentMode": "pay_at_venue"
}
```

Query params: None.

Response JSON example:

```json
{
  "success": true,
  "data": {
    "id": "booking_123",
    "reference": "AUR-20260618-001",
    "businessId": "business_123",
    "businessName": "Aura Luxe Studio",
    "serviceId": "service_123",
    "serviceName": "Hair spa",
    "staffId": "staff_123",
    "staffName": "Maya Rao",
    "startAt": "2026-06-18T17:30:00+05:30",
    "displayStartAt": "Thu, 18 Jun, 5:30 PM",
    "address": "12 100 Feet Road, Indiranagar",
    "status": "confirmed",
    "paymentStatus": "not_required",
    "cancellationPolicy": "Cancel free up to 4 hours before appointment."
  }
}
```

Error response example:

```json
{
  "success": false,
  "error": {
    "code": "SLOT_UNAVAILABLE",
    "message": "This time is no longer available"
  }
}
```

Required database fields:

- Booking fields listed in the shared Booking model.
- Business/branch/service/staff relationship fields.
- Slot lock or transaction-safe booking conflict check.

Security rules:

- Require valid customer token.
- Backend must recheck service, staff, branch, and slot availability in a transaction.
- Do not trust client price, duration, staff capability, or slot availability.
- No double booking.

Tenant/business/branch validation:

- Resolve `businessSlug` to tenant and branch.
- Validate `businessId`, `serviceId`, `staffId`, and `offerId` belong to the resolved tenant/branch.
- If `staffId` is omitted, backend may assign an available staff member.

### POST /api/v1/customer/bookings/:id/cancel

Auth required: Yes.

Request body:

```json
{
  "reason": "Plans changed"
}
```

Query params: None.

Response JSON example:

```json
{
  "success": true,
  "data": {
    "id": "booking_123",
    "reference": "AUR-20260618-001",
    "businessName": "Aura Luxe Studio",
    "serviceName": "Hair spa",
    "staffName": "Maya Rao",
    "startAt": "2026-06-18T17:30:00+05:30",
    "displayStartAt": "Thu, 18 Jun, 5:30 PM",
    "address": "12 100 Feet Road, Indiranagar",
    "status": "cancelled",
    "paymentStatus": "not_required"
  }
}
```

Error response example:

```json
{
  "success": false,
  "error": {
    "code": "CONFLICT",
    "message": "This booking can no longer be cancelled online"
  }
}
```

Required database fields:

- Booking status, cancellation reason, cancellation timestamp, cancellation policy fields.

Security rules:

- Customer can cancel only own booking.
- Validate booking is in a cancellable state.
- Apply branch cancellation policy.

Tenant/business/branch validation:

- Validate booking tenant/branch before status update.

### POST /api/v1/customer/bookings/:id/reschedule

Auth required: Yes.

Request body:

```json
{
  "startAt": "2026-06-19T11:00:00+05:30",
  "staffId": "staff_123"
}
```

Query params: None.

Response JSON example:

```json
{
  "success": true,
  "data": {
    "id": "booking_123",
    "reference": "AUR-20260618-001",
    "businessName": "Aura Luxe Studio",
    "serviceName": "Hair spa",
    "staffName": "Maya Rao",
    "startAt": "2026-06-19T11:00:00+05:30",
    "displayStartAt": "Fri, 19 Jun, 11:00 AM",
    "address": "12 100 Feet Road, Indiranagar",
    "status": "confirmed",
    "paymentStatus": "not_required"
  }
}
```

Error response example:

```json
{
  "success": false,
  "error": {
    "code": "SLOT_UNAVAILABLE",
    "message": "This time is no longer available"
  }
}
```

Required database fields:

- Booking fields, service duration, staff schedule, existing bookings, reschedule audit fields.

Security rules:

- Customer can reschedule only own booking.
- Backend must recheck new slot in a transaction.
- No double booking.

Tenant/business/branch validation:

- New staff and slot must belong to the booking's original tenant/branch/business unless backend explicitly supports branch transfer.

## Reviews And Favorites Endpoints

### GET /api/v1/public/businesses/:slug/reviews

Auth required: No.

Request body: None.

Query params:

- `limit`: optional.
- `cursor`: optional.

Response JSON example:

```json
{
  "success": true,
  "data": {
    "rows": [
      {
        "id": "review_123",
        "businessId": "business_123",
        "author": "Priya S.",
        "rating": 5,
        "text": "Beautiful space and excellent service.",
        "createdAt": "2026-06-12T10:30:00+05:30"
      }
    ],
    "nextCursor": null
  }
}
```

Error response example:

```json
{
  "success": false,
  "error": {
    "code": "NOT_FOUND",
    "message": "Business not found"
  }
}
```

Required database fields:

- Approved public review fields linked to booking, customer, tenant, branch, business.

Security rules:

- Return only approved public reviews.
- Mask customer identity.

Tenant/business/branch validation:

- Reviews must belong to the requested public business tenant/branch.

### POST /api/v1/customer/bookings/:bookingId/review

Auth required: Yes.

Request body:

```json
{
  "rating": 5,
  "text": "Beautiful space and excellent service."
}
```

Query params: None.

Response JSON example:

```json
{
  "success": true,
  "data": {
    "id": "review_123",
    "businessId": "business_123",
    "author": "Priya S.",
    "rating": 5,
    "text": "Beautiful space and excellent service.",
    "createdAt": "2026-06-18T12:00:00+05:30"
  }
}
```

Error response example:

```json
{
  "success": false,
  "error": {
    "code": "CONFLICT",
    "message": "This booking has already been reviewed"
  }
}
```

Required database fields:

- Review table with `bookingId`, `customerId`, `tenantId`, `branchId`, `businessId`, `rating`, `text`, `status`, `createdAt`.

Security rules:

- Customer can review only their own completed booking.
- One review per booking unless backend explicitly supports edits.
- New reviews may default to pending moderation.

Tenant/business/branch validation:

- Review inherits tenant, branch, business from the booking.

### GET /api/v1/customer/favorites

Auth required: Yes.

Request body: None.

Query params:

- `limit`: optional.
- `cursor`: optional.

Response JSON example:

```json
{
  "success": true,
  "data": {
    "rows": [
      {
        "businessId": "business_123",
        "createdAt": "2026-06-18T12:00:00+05:30",
        "business": {
          "id": "business_123",
          "slug": "aura-luxe-studio",
          "businessName": "Aura Luxe Studio",
          "category": "Hair salon",
          "description": "Premium salon and beauty studio.",
          "address": "12 100 Feet Road",
          "area": "Indiranagar",
          "city": "Bengaluru",
          "ratingAverage": 4.9,
          "ratingCount": 284,
          "isOpen": true,
          "hasOffer": true,
          "galleryImages": [],
          "startingPricePaise": 120000,
          "categories": ["hair"],
          "services": [],
          "staff": [],
          "reviews": []
        }
      }
    ],
    "nextCursor": null
  }
}
```

Error response example:

```json
{
  "success": false,
  "error": {
    "code": "UNAUTHORIZED",
    "message": "Login required"
  }
}
```

Required database fields:

- Favorites table: `customerId`, `businessId`, `tenantId`, `branchId`, `createdAt`.

Security rules:

- Return only authenticated customer's favorites.

Tenant/business/branch validation:

- Favorite business must still be public/bookable before including full business details.

### POST /api/v1/customer/favorites/:businessId

Auth required: Yes.

Request body:

```json
{}
```

Query params: None.

Response JSON example:

```json
{
  "success": true,
  "data": {
    "businessId": "business_123",
    "createdAt": "2026-06-18T12:00:00+05:30"
  }
}
```

Error response example:

```json
{
  "success": false,
  "error": {
    "code": "NOT_FOUND",
    "message": "Business not found"
  }
}
```

Required database fields:

- Favorites table with unique key on customer and business.

Security rules:

- Customer can favorite only public businesses.
- Operation should be idempotent or return existing favorite.

Tenant/business/branch validation:

- Validate `businessId` resolves to an active public tenant/branch.

### DELETE /api/v1/customer/favorites/:businessId

Auth required: Yes.

Request body: None.

Query params: None.

Response JSON example:

```json
{
  "success": true,
  "data": null
}
```

Error response example:

```json
{
  "success": false,
  "error": {
    "code": "UNAUTHORIZED",
    "message": "Login required"
  }
}
```

Required database fields:

- Favorites table with `customerId` and `businessId`.

Security rules:

- Customer can remove only their own favorite record.
- Deleting a non-existing favorite may return success for idempotency.

Tenant/business/branch validation:

- Validate favorite belongs to authenticated customer before delete.

## Backend Implementation Checklist

- Add customer-auth middleware separate from staff/admin SaaS auth if needed.
- Keep SaaS database as the single source of truth.
- Add public marketplace read endpoints that project safe public DTOs.
- Add customer booking endpoints that write to the existing bookings/appointments tables.
- Calculate availability on the backend.
- Recheck slot availability in the same transaction that creates or reschedules booking.
- Enforce no double booking at service level and, where possible, database constraint/lock level.
- Enforce `customerId` ownership checks on every customer endpoint.
- Use integer paise for all prices.
- Keep public APIs scoped to approved business, tenant, and branch data only.
