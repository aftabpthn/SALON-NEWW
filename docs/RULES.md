# RULES.md - Compact Build Rules

## Rust Backend

- Keep Axum handlers thin.
- Validate and authorize at the route boundary.
- Put business rules in `backend-rust/src/services/`.
- Put SQL only in `backend-rust/src/repositories/`.
- Use SQLx with tenant/branch scoped queries.
- Store money as integer paise.
- Add new migrations; never edit applied migrations.

## Angular Frontend

- Use standalone components and existing page/domain folders.
- Use shared components before creating new UI.
- Date display is `DD/MM/YYYY`; payloads remain ISO-safe.
- Do not show fake CRM records; use empty/loading/error states.
- Reload affected API data after save/update/delete/action.
- Do not run `npm run ...` commands as an agent; use TypeScript checks when needed.

## Data And Security

- PostgreSQL is durable truth.
- Redis is temporary infrastructure, not CRM truth.
- JWT/OAuth, tenant, branch, RBAC, and audit stay centralized.
- Never hardcode secrets or bypass permissions in UI or backend.

## Verification

- Run the smallest check that can catch the change.
- Backend compile: `cargo check --bin aura-shine-backend`.
- Angular template/type changes: `npx tsc --noEmit -p tsconfig.app.json`.
- Do not run broad builds unless required or requested.
