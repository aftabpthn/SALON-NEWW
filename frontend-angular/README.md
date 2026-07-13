# AuraShine Frontend (Angular)

## What is ready
- Standalone Angular app bootstrap (`frontend-angular/src/main.ts`)
- Route-driven CRM module skeleton:
  - dashboard, clients, staff, services, appointments, availability, pos, inventory, memberships, packages, reports, notifications
- Shared API service + auth interceptor
- Environments (`environment.ts`, `environment.prod.ts`)
- Base layout + sidebar shell

## Start manually
- `cd frontend-angular`
- `npm install`
- `npm start`

## Build manually
- `npm run build`

## Notes
- Backend health API expected at `http://localhost:8080/api/v1/health`.
- Placeholder pages are intentionally minimal in this phase; business logic can be added module by module.

