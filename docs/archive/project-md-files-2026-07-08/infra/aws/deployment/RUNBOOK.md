# AWS Deployment Automation Runbook

## Status

These scripts are safe templates. They do not contain secrets and they do not run automatically. Run them only from a machine with reviewed AWS access, Terraform installed, and AWS CLI installed.

## Required Local Tools

- Terraform `>= 1.6.0`
- AWS CLI v2
- Node.js compatible with the app
- PowerShell 5.1+ or PowerShell 7+

## 1. Configure AWS Access

Use AWS SSO, an assumed role, or CI OIDC. Do not create long-lived access keys for this project.

```powershell
aws sts get-caller-identity
```

## 2. Generate Secret JSON Locally

This prints a JSON payload. Review it, then write it directly to Secrets Manager. Do not commit the output.

```powershell
node infra/aws/scripts/generate-prod-secret-json.mjs --cors https://app.example.com
```

## 3. Apply Terraform

Copy `infra/aws/terraform/terraform.tfvars.example` to a local, untracked tfvars file and fill real values.

```powershell
Set-Location infra/aws/terraform
terraform init
terraform validate
terraform plan -var-file="prod.local.tfvars"
terraform apply -var-file="prod.local.tfvars"
```

## 4. Put Secrets In AWS Secrets Manager

Use the `secret_id` Terraform output and pipe reviewed JSON into AWS CLI.

```powershell
aws secretsmanager put-secret-value --secret-id "<secret_id>" --secret-string file://prod-secrets.local.json
```

Delete local `prod-secrets.local.json` after verification.

## 5. Deploy Frontend

```powershell
npm run build
./infra/aws/scripts/deploy-frontend.ps1 -BucketName "<frontend_bucket>" -DistributionId "<cloudfront_distribution_id>"
```

## 6. Package And Publish Backend Artifact

```powershell
./infra/aws/scripts/package-backend.ps1 -Version "<git-sha-or-release>"
./infra/aws/scripts/publish-backend-artifact.ps1 -BucketName "<artifact_bucket>" -ArtifactPath "artifacts/aura-backend-<version>.zip"
```

## 7. Backend Release

The current EC2 user-data template only prepares the host. Real artifact download/start automation must be reviewed before production use because the app currently uses SQLite and needs a controlled single-writer deployment.

## Blocked Items

- Live Terraform apply is blocked until Terraform and AWS CLI are installed/configured.
- Real secrets setup is blocked until production values are supplied.
- MongoDB Atlas migration is blocked by the project stack invariant: current backend is SQLite via `better-sqlite3`.
