# Azure Architecture Plan

## Scope
This document defines a production Azure deployment plan for the current Aura Salon CRM/POS stack.

Current application stack:
- Frontend: Angular
- Backend: Express JS
- Current database engine: SQLite
- Target database option: MongoDB Atlas on Azure, only after explicit migration approval

No application code migration is included in this document set.

## Target Architecture
| Layer | Recommended Azure Service | Alternative | Notes |
| --- | --- | --- | --- |
| Frontend | Azure Static Web Apps | Azure Storage Static Website + Azure CDN | Static Angular build hosting with HTTPS and CDN edge caching. |
| Backend | Azure App Service | Azure Container Apps | App Service is simpler; Container Apps is better for containerized autoscale and event-driven workloads. |
| Database | MongoDB Atlas on Azure | Current SQLite until migration approval | Atlas requires schema, repository, migration, and rollback plan before production use. |
| File storage | Azure Blob Storage | - | Store uploads, exports, invoices, backups, and generated reports. |
| Secrets | Azure Key Vault | App Service settings for non-secret config only | Secrets must never be committed. |
| Edge security | Application Gateway WAF | Front Door WAF | WAF in prevention mode after allowlist tuning. |
| Identity | Microsoft Entra ID | Existing app auth during transition | SSO requires app registration and backend token validation changes. |
| Monitoring | Azure Monitor + Application Insights | Log Analytics workspace | Centralize logs, metrics, exceptions, traces, and alerts. |
| Backup | Azure Backup + Blob lifecycle archive tier | Atlas backups for MongoDB | Backup policy must cover app config, Blob data, database, and restore drills. |

## Network Flow
1. User opens the Angular frontend over HTTPS.
2. Frontend calls the backend API over HTTPS using the configured API base URL.
3. Application Gateway WAF or Front Door filters public traffic.
4. Backend reads secrets from Key Vault through managed identity.
5. Backend connects to the approved database layer.
6. Backend writes files to Azure Blob Storage.
7. Logs and traces go to Application Insights and Log Analytics.

## Database Position
MongoDB Atlas on Azure is documented as the requested target database service, but it is not a drop-in change for the current codebase. Production migration requires separate approval for:
- Data model mapping from SQLite tables to MongoDB collections
- Tenant and branch isolation rules
- Repository/service changes
- Backfill migration scripts
- Dual-write or cutover strategy
- Rollback plan

Until that approval, the production deployment should keep the current database engine and treat Atlas variables as reserved placeholders.

## Recommended First Production Shape
Use the lowest-risk Azure layout first:
- Azure Static Web Apps for Angular
- Azure App Service for Express API
- Azure Blob Storage for files
- Key Vault for secrets
- Application Insights for telemetry
- Log Analytics for centralized logs
- Defender for Cloud for posture management

Move to Container Apps after container packaging and health probes are stable.

## Cost Controls
- Start with one production App Service plan and autoscale rules.
- Keep non-production environments on smaller SKUs.
- Use Blob lifecycle rules to move older backups to cool/archive tier.
- Set Azure budgets and alerts per resource group.
- Enable Application Insights sampling for high-volume traces.
- Review Atlas cluster sizing separately before migration approval.

## Production Readiness Checklist
- Custom domains and HTTPS configured.
- WAF policy tested in detection mode, then prevention mode.
- Key Vault references configured for all secrets.
- Managed identity enabled for backend.
- CORS restricted to the production frontend domain.
- Backup restore drill completed.
- Monitoring alerts routed to owner channel.
- Rollback path documented for frontend and backend.
- MongoDB migration explicitly approved before any database switch.
