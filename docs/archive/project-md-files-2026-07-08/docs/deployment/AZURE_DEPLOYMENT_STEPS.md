# Azure Deployment Steps

## Prerequisites
- Azure subscription with owner or contributor access.
- Resource group for production, for example `rg-aura-prod`.
- Custom domain access.
- CI/CD access to the repository.
- No real secrets stored in repository files.

## Step 1: Create Resource Group
1. Create a production resource group in the selected Azure region.
2. Apply tags:
   - `app=aura-salon`
   - `env=prod`
   - `owner=<owner-name>`
   - `cost-center=<cost-center>`

## Step 2: Create Key Vault
1. Create Azure Key Vault in the production resource group.
2. Enable purge protection and soft delete.
3. Add secrets for JWT, storage, monitoring, Entra, Graph, and database credentials.
4. Give backend managed identity read access to required secrets only.

## Step 3: Frontend Hosting
Recommended: Azure Static Web Apps.

1. Create Azure Static Web App.
2. Configure build output path for Angular production build.
3. Configure environment-specific API base URL.
4. Add custom domain and HTTPS.
5. Add redirect/rewrite rules if Angular client-side routes require fallback to `index.html`.

Alternative: Azure Storage Static Website + Azure CDN.

1. Create storage account.
2. Enable static website hosting.
3. Upload Angular build output to `$web`.
4. Add Azure CDN endpoint.
5. Configure SPA fallback behavior at CDN/routing layer.

## Step 4: Backend Hosting
Recommended first path: Azure App Service.

1. Create App Service plan.
2. Create Linux Node.js App Service.
3. Configure app settings using placeholders from `.env.azure.example`.
4. Enable managed identity.
5. Connect Key Vault references for secrets.
6. Configure health check path as `/health`.
7. Enable Application Insights.
8. Restrict CORS to the frontend domain.

Alternative: Azure Container Apps.

1. Build backend container image in a controlled CI pipeline.
2. Push image to Azure Container Registry.
3. Create Container Apps environment.
4. Configure ingress, environment variables, Key Vault secrets, and health probes.
5. Configure autoscale rules.

## Step 5: File Storage
1. Create Azure Storage account.
2. Create containers:
   - `uploads`
   - `exports`
   - `invoices`
   - `backups`
3. Disable public blob access unless a specific public delivery need is approved.
4. Use managed identity or SAS tokens generated server-side.
5. Apply lifecycle rules for backup/archive containers.

## Step 6: Database
Current safe path:
1. Keep the current database engine until migration is approved.
2. Store database path or connection configuration in App Service settings.
3. Back up the database through the documented backup flow.

MongoDB Atlas target path:
1. Create Atlas project on Azure.
2. Create private endpoint or restricted IP access.
3. Store connection string in Key Vault.
4. Run an approved migration rehearsal.
5. Cut over only after application repository changes and rollback plan are approved.

## Step 7: Security Edge
1. Create Application Gateway WAF or Front Door WAF.
2. Route frontend and API traffic through WAF.
3. Start WAF in detection mode.
4. Review false positives.
5. Move to prevention mode after validation.

## Step 8: Monitoring
1. Create Application Insights.
2. Create Log Analytics workspace.
3. Connect App Service or Container Apps diagnostics.
4. Add alerts for:
   - API 5xx spike
   - high response time
   - backend restart loop
   - storage failures
   - WAF blocked request spike
   - budget threshold

## Step 9: Deployment Flow
1. Build frontend.
2. Deploy frontend artifact to Static Web Apps or Storage/CDN.
3. Deploy backend artifact to App Service or Container Apps.
4. Verify `/health`.
5. Run smoke checks on login, POS, appointments, inventory, finance, and reports.
6. Keep previous deployment slot or artifact for rollback.

## Step 10: Production Checklist
- Environment variables reviewed.
- Secrets resolved from Key Vault.
- WAF enabled.
- Application Insights receiving traces.
- Backup policy enabled.
- Restore process tested.
- Custom domains active.
- CORS locked down.
- Entra/Graph app permissions reviewed before SSO rollout.
