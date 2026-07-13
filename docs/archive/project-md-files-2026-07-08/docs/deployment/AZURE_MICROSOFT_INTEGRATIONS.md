# Azure Microsoft Integrations Plan

## Goals
Prepare the project for enterprise Microsoft integration without adding secrets or changing application code in this documentation step.

Target integrations:
- Microsoft Entra ID SSO
- Office 365 / Outlook calendar integration
- Teams notifications
- Microsoft Graph API readiness

## Microsoft Entra ID SSO
Recommended approach:
1. Create separate Entra app registrations for dev, staging, and production.
2. Use Authorization Code Flow with PKCE.
3. Configure redirect URIs for the production frontend domain.
4. Configure backend API audience.
5. Store client IDs and tenant IDs as config; store secrets only in Key Vault.
6. Map Entra groups or app roles to existing app roles.
7. Keep existing login backward compatible during rollout.

Required approval before implementation:
- approved tenant
- app registration owner
- redirect URI list
- role/group mapping
- admin consent plan

## Microsoft Graph API Readiness
Start with delegated permissions:
- `openid`
- `profile`
- `email`
- `offline_access`
- `User.Read`
- `Calendars.ReadWrite`

Add broader permissions only after a specific workflow requires them.

Backend should be prepared to:
- validate access tokens
- refresh tokens safely
- call Graph with least privilege
- audit Graph actions
- handle Graph throttling and retries

## Outlook Calendar Integration
Target workflows:
- create or update appointment calendar events
- sync salon booking date/time changes
- write cancellation updates
- optionally add online meeting links later

Implementation readiness checklist:
- one calendar ownership model selected
- branch calendar mapping approved
- staff calendar consent model approved
- timezone fixed to IST business dates where applicable
- retry and duplicate-prevention strategy documented

## Teams Notifications
Target workflows:
- appointment created or changed
- payment settlement mismatch
- daily closing completed
- inventory low-stock alert
- backup failure alert

Options:
- Incoming webhook for simple channel notifications
- Microsoft Graph Teams APIs for richer controlled notifications
- Power Automate connector for low-code business routing

Use webhooks first only if governance accepts the tradeoff. Use Graph where audit and identity control matter.

## Security Rules
- No Graph client secret in repository.
- Store Graph secrets in Key Vault.
- Use separate app registrations per environment.
- Use least-privilege scopes.
- Require admin consent for production scopes.
- Log Graph API failures without exposing tokens.
- Rotate secrets on schedule or use certificate-based credentials later.

## Monitoring Flow
1. Backend records integration action and correlation ID.
2. Graph API call result is logged to Application Insights.
3. Failures emit alert when repeated.
4. Teams notification failures are visible in monitoring.
5. Admin can review integration health before customer impact.

## Production Checklist
- Entra app registration approved.
- Redirect URIs finalized.
- Graph scopes approved.
- Admin consent completed.
- Key Vault secrets configured.
- Token validation implemented in backend before enabling SSO.
- Teams channel ownership approved.
- Outlook calendar ownership model approved.
