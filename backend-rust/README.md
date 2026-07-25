# AuraShine CRM Rust Backend (Phase-1 Skeleton)

## Scope in this phase
- Rust + Axum HTTP skeleton
- PostgreSQL + Redis wiring
- Health endpoints with PostgreSQL and Redis dependency checks
- Database foundation for tenants, branches, roles, users, refresh tokens, clients, staff, services and appointments
- DB-backed JWT login, refresh rotation, logout revoke and `/auth/me`
- Modular routes folder for modules:
  - auth, clients, staff, services, availability, pos, inventory, memberships, packages, reports, notifications
- JWT/OAuth config placeholders
- Docker + docker-compose infra

## Run locally (manual)
- `cp .env.example .env`
- Fill required values (`DATABASE_URL`, `REDIS_URL`, JWT secrets)
- `docker compose up -d` (from `backend-rust/`)
- API:
  - `GET http://localhost:8082/api/v1/health`
  - `GET http://localhost:8082/api/health`
  - `GET http://localhost:8082/health`

## Next phase
- Attach auth/tenant/role middleware to protected CRM module routes
- Add OAuth provider callback routes
- Add appointments, billing and inventory service/repository logic

