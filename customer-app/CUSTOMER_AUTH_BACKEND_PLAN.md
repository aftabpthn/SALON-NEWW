# Customer Auth Backend Implementation Plan

This customer app currently has one supported live customer auth method:

- Phone OTP via `POST /api/v1/customer/auth/request-otp`
- Phone OTP verification via `POST /api/v1/customer/auth/verify-otp`

Backend inspection found no customer routes for Google, Apple, email/password login, email signup, or forgot password. The customer app therefore shows those options as unavailable instead of creating fake login success.

## Required Backend APIs

### Email + Password

- `POST /api/v1/customer/auth/email/signup`
- `POST /api/v1/customer/auth/email/login`
- `POST /api/v1/customer/auth/password/forgot`
- `POST /api/v1/customer/auth/password/reset`

The backend should return the same session shape as OTP verification:

```json
{
  "accessToken": "customer.jwt",
  "refreshToken": "optional-refresh-token",
  "customer": {
    "id": "customer_123",
    "name": "Customer",
    "phone": "",
    "email": "customer@gmail.com",
    "isLoggedIn": true
  }
}
```

### OAuth

- `GET /api/v1/customer/auth/google/start`
- `GET /api/v1/customer/auth/google/callback`
- `GET /api/v1/customer/auth/apple/start`
- `POST /api/v1/customer/auth/apple/callback`

OAuth callbacks should create or link the existing SaaS customer/client identity and return or set a customer app session.

## Data Requirements

The existing SaaS remains the source of truth. Do not create a separate booking database.

If customer credentials require new storage, add a tenant-scoped customer auth table through the normal SaaS migration process. The table must include:

- `tenantId`
- `customerId` or `clientId`
- `email`
- `passwordHash`
- `provider`
- `providerSubject`
- `createdAt`
- `updatedAt`

Password hashes must never be stored in the customer app.

## Security Rules

- Customer tokens must use the existing customer auth middleware contract.
- Customer APIs must only return the authenticated customer profile and bookings.
- Password reset tokens must be single-use and expire quickly.
- OAuth identities must be linked by verified provider subject, not by unverified display email alone.
- The backend must keep booking creation in the existing SaaS calendar and appointments tables.
