# Azure Security Checklist

## Identity And Access
- Use Microsoft Entra ID for Azure administrator access.
- Enable MFA for all privileged users.
- Use least-privilege RBAC on resource groups.
- Use managed identity for backend access to Key Vault and Blob Storage.
- Do not store client secrets, tenant IDs, or production keys in repository files.

## Application Secrets
- Store production secrets in Azure Key Vault.
- Use Key Vault references in App Service settings where possible.
- Rotate JWT, Graph, storage, and database credentials on a defined schedule.
- Keep `.env.azure.example` placeholder-only.

## Network Security
- Put public traffic behind Application Gateway WAF or Front Door WAF.
- Restrict backend CORS to approved frontend domains.
- Restrict storage account public access.
- Use private endpoints where budget and complexity allow:
  - Key Vault
  - Storage
  - MongoDB Atlas private endpoint
- Allow App Service outbound access to approved services only where feasible.

## WAF Rules
Start with managed rules in detection mode:
- OWASP core rule set
- SQL injection rules
- XSS rules
- protocol enforcement rules
- bot protection if available

Move to prevention mode after reviewing false positives for:
- POS billing payloads
- appointment notes
- customer search
- inventory descriptions
- report filters

## Entra ID SSO Security Plan
Before implementation:
- Register separate apps for dev, staging, and production.
- Use Authorization Code Flow with PKCE for frontend.
- Backend must validate issuer, audience, signature, expiry, and tenant.
- Map Entra user/group claims to existing app roles.
- Keep existing auth backward compatible during transition.

## Microsoft Graph Permissions
Use least-privilege delegated permissions first:
- `User.Read`
- `Calendars.ReadWrite`
- `offline_access`
- Teams notification permissions only after workflow approval

Admin consent must be documented before production use.

## Data Protection
- Encrypt data at rest using Azure-managed keys by default.
- Consider customer-managed keys only after operational readiness.
- Enable storage versioning for critical containers.
- Enable soft delete for Blob Storage.
- Classify exports, invoices, and customer documents as sensitive.

## Monitoring And Alerting
Create alerts for:
- failed login spikes
- repeated 401/403 spikes
- WAF block spikes
- Key Vault denied access
- storage access failures
- backend exception rate
- unusual Graph API failure rate

## Production Security Gate
- No secrets in git.
- Key Vault access tested.
- WAF policy reviewed.
- CORS locked.
- HTTPS enforced.
- App Insights enabled.
- Backup and restore tested.
- Entra app registration reviewed.
- MongoDB migration separately approved before database switch.
