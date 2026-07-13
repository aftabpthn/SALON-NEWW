# Aura Salon CRM/POS Deployment Guide

## Production Checklist

- Copy `.env.example` to `.env` and set strong `JWT_SECRET` and `ENCRYPTION_SECRET`.
- Run `npm run quality` before release.
- Run `npm run backup:db` before deploying over an existing SQLite database.
- Build with `npm run build`.
- Start the API and static admin app with `npm run start:prod`.

## Docker

```bash
cp .env.example .env
docker compose up --build
```

The container serves the Express API and the built Angular admin app on port `4000`.

## Manual Server

```bash
npm ci
npm run quality
npm run seed:demo
npm run start:prod
```

## Backups

SQLite lives in `data/salon-crm.sqlite`. Backups are written to `data/backups`.

```bash
npm run backup:db
```

The admin Deployment page can also create a persisted backup event through `/api/deployment/backup`.

## Health Checks

- API: `/api/health`
- Versioned API: `/api/v1/health`
- Deployment summary: `/api/deployment/summary`
