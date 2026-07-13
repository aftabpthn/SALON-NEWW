# Azure Scaling Plan

## Scaling Goals
- Keep POS, appointments, inventory, finance, and reports responsive during branch peak hours.
- Scale backend capacity without changing application code first.
- Avoid uncontrolled cloud spend.

## Frontend Scaling
Azure Static Web Apps:
- Static content is served from the platform edge.
- Scale is mostly automatic.
- Use caching headers for hashed Angular assets.

Azure Storage Static Website + CDN:
- Use CDN for global edge caching.
- Configure cache invalidation during releases.
- Keep `index.html` short cache and hashed assets long cache.

## Backend Scaling With App Service
Recommended initial autoscale:
- Minimum instances: 1 production instance
- Scale out when CPU is above 70 percent for 10 minutes
- Scale out when memory pressure is sustained
- Scale in slowly to avoid request churn

Required before autoscale:
- `/health` endpoint enabled and checked by platform health probes
- stateless request handling where possible
- file writes moved to Blob Storage
- secrets moved to Key Vault
- database connection and file path behavior verified

## Backend Scaling With Container Apps
Use Container Apps when container packaging is approved.

Suggested rules:
- Minimum replicas: 1 for production
- Maximum replicas: based on cost budget
- HTTP concurrency rule for request volume
- CPU and memory rules for heavy reports

Required before Container Apps:
- Dockerfile approved
- health probes configured
- image scan enabled
- secrets injected from Key Vault
- log output to stdout/stderr

## Database Scaling
Current SQLite path:
- Suitable only for limited single-writer patterns.
- Must be backed up carefully.
- App Service scale-out may require design review if SQLite remains active.

MongoDB Atlas target path:
- Use Atlas tier sized by real workload.
- Enable indexes before production migration.
- Test tenant and branch scoped queries.
- Use connection pooling.
- Monitor slow queries.

Database migration is a separate approval gate.

## Storage Scaling
- Store uploads and generated files in Blob Storage.
- Use separate containers by purpose.
- Use lifecycle policies for old data.
- Use CDN only for approved public/static assets.

## Monitoring-Driven Scaling
Track:
- request duration
- request count
- error rate
- CPU and memory
- database latency
- Blob operation failures
- queue length if async jobs are introduced

Alerts should trigger before user-facing degradation.

## Cost Controls
- Use autoscale maximum instance limits.
- Keep staging smaller than production.
- Use schedule-based scale rules only after traffic pattern is known.
- Enable monthly Azure budget alerts.
- Review Application Insights ingestion volume.

## Production Scaling Checklist
- Health probe works.
- App settings are environment-specific.
- No local uploaded files required.
- Backup flow tested.
- Monitoring dashboard created.
- Autoscale maximum reviewed with owner.
- Database migration approved before multi-instance write scaling if needed.
