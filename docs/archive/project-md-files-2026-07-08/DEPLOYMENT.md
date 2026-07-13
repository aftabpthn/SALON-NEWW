# DEPLOYMENT.md — Deployment Standards

> **Primary AI Role:** DevOps Architect
> **Status:** Living document. Step-by-step runbook: `docs/deployment.md`; guide: `docs/DEPLOYMENT_GUIDE.md`.

## 1. Purpose

Standards for building, configuring and running AuraShine in production, and the
rules every deploy must satisfy.

## 2. Build & Artifacts

- Frontend: `npm run build` (Angular production build) — served statically by the Express server in production.
- Backend: no build step (ESM JavaScript); start with `npm run start:prod` / `node server/index.js`.
- Containers: `Dockerfile` + `docker-compose.yml`; `docker compose up --build` is the reference deployment.
- The image never contains secrets or a database file.

## 3. Configuration Contract

- **`.env.example` is the contract**: every required variable appears there with a safe placeholder. A deploy is misconfigured if it needs a variable not listed there — fix the contract in the same change.
- Secrets only via environment (JWT secrets, provider keys, encryption keys). Never bake into images or commit.
- Ports: API `4000` (health at `/api/health`), dev SPA `4300` (dev only).

## 4. Persistence

- SQLite database (`data/salon-crm.sqlite`) and uploaded files live on **persistent volumes** mounted into the container.
- Backups run on schedule from the host/volume (`BACKUP_RECOVERY.md`); a pre-deploy backup is mandatory before any release containing migrations.

## 5. Deploy Procedure (summary — full runbook in docs/deployment.md)

1. Green quality gate on the release commit: `npm run quality`.
2. Pre-deploy database backup (`npm run backup:db`) verified.
3. Build + start new container; migrations apply automatically on boot (additive-first, idempotent).
4. Health checks pass: `GET /api/health`, WebSocket connect, one authenticated smoke call.
5. Watch monitoring for 30 minutes (OBSERVABILITY.md); rollback criteria pre-agreed.

## 6. Rollback

- App-only issue → redeploy previous image (migrations are additive, old code runs on new schema).
- Destructive migration involved (rare, approval-gated) → restore pre-deploy backup per `docs/restore.md`, accept documented RPO.
- Every rollback produces a post-mortem entry (docs/release-process.md).

## 7. Environments

- **dev:** `npm run dev` (concurrent API + SPA, proxy config).
- **production:** single container (or API container + volume) behind HTTPS termination; HTTPS mandatory (SECURITY.md §7).
- Feature toggles (`feature_toggles`) gate risky features per tenant without redeploys.

## 8. AI Instructions

- Never add a required env var without updating `.env.example` in the same change.
- Never make a migration destructive to “simplify” deployment — additive-first is the rule.
- Deployment changes are verified by a clean `docker compose up --build` from scratch.

## 9. Acceptance Criteria

- Fresh machine + this doc + docs/deployment.md = successful deploy, no tribal knowledge.
- Every release deploy has a verified pre-deploy backup.
- Health checks gate traffic; failed checks mean automatic no-go.

## 10. Future Roadmap

- CI pipeline running the quality gate on every PR.
- Blue/green cutover once instance count grows.
