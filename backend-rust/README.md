# AuraShine CRM Rust Backend

## Current scope
- Rust + Axum HTTP skeleton
- PostgreSQL + Redis wiring
- Health endpoints with PostgreSQL and Redis dependency checks
- Database foundation for tenants, branches, roles, users, refresh tokens, clients, staff, services and appointments
- DB-backed JWT login, refresh rotation, logout revoke and `/auth/me`
- Modular routes folder for modules:
  - auth, clients, staff, services, availability, pos, inventory, memberships, packages, reports, notifications
- Central JWT, refresh-token, MFA, passkey, OAuth/SSO and permission boundaries
- Docker + docker-compose infra

## Run locally
- `cp .env.example .env`
- Fill required values (`DATABASE_URL`, `REDIS_URL`, JWT secrets)
- `docker compose up -d` (from `backend-rust/`)
- From the repository root run `.\backend-rust\scripts\restart-backend-dev.ps1 -Port 8082`.
- API:
  - `GET http://localhost:8082/api/v1/health`
  - `GET http://localhost:8082/api/health`
  - `GET http://localhost:8082/health`

The restart script builds into `target/debug`, copies the executable to the managed runtime directory, starts it without locking Cargo output, and waits for dependency-backed health.

