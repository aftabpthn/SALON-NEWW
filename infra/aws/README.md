# AuraShine AWS deployment

This directory contains the repeatable AWS deployment for isolated `dev`, `staging`, and `prod` environments.

## Provisioned architecture

- CloudFront HTTPS distribution with a private, versioned S3 frontend bucket.
- AWS WAF managed rules and an API per-IP rate limit.
- A public ALB origin restricted to CloudFront origin addresses and a generated origin header.
- ECS/Fargate rolling service with the Rust API and a private AI sidecar.
- Private ClamAV sidecar plus encrypted EFS storage for durable migration evidence across task replacement and replicas.
- Generated Secrets Manager HMAC key for tamper-detectable migration proof packs.
- A separate ECS migration task that must succeed before each service update.
- Private RDS PostgreSQL and encrypted Redis OSS replication group.
- Secrets Manager runtime configuration and least-privilege ECS task roles.
- ECS autoscaling, deployment circuit breaker, alarm-based rollback, CloudWatch logs/alarms, and SNS notifications.
- AWS Backup continuous recovery, daily/weekly/monthly recovery points, KMS encryption, and a private application file bucket through `data-protection.yaml`.

Production uses two application tasks, two NAT gateways, Multi-AZ PostgreSQL, a Redis replica, deletion protection, and 35-day database retention. Lower environments use smaller defaults in `terraform/environments/`.

## 1. One-time account bootstrap

Run with an AWS administrator identity. Use a globally unique state bucket name:

```powershell
aws cloudformation deploy `
  --region ap-south-1 `
  --stack-name aurashine-bootstrap `
  --template-file infra/aws/bootstrap.yaml `
  --capabilities CAPABILITY_NAMED_IAM `
  --parameter-overrides `
    GitHubOrg=<github-owner> `
    GitHubRepo=<github-repository> `
    StateBucketName=<globally-unique-state-bucket>
```

If the AWS account already has the GitHub Actions OIDC provider, also pass `GitHubOidcProviderArn=<provider-arn>`. The stack outputs the state bucket, immutable ECR repositories, and `GitHubDeployRoleArn`.

The GitHub role has `PowerUserAccess` for infrastructure and a separate policy that limits IAM role management/pass-role to `aurashine-*` service roles. Review it against the AWS organization's permission boundary and SCPs before production use.

## 2. Configure GitHub approval gates

Create GitHub Environments named `dev`, `staging`, and `prod`. Configure required reviewers for at least `staging` and `prod`, then add these environment-scoped values:

| Type | Name | Value |
| --- | --- | --- |
| Variable | `AWS_ROLE_ARN` | `GitHubDeployRoleArn` bootstrap output |
| Variable | `AWS_REGION` | for example `ap-south-1` |
| Variable | `TF_STATE_BUCKET` | bootstrap state bucket output |
| Variable | `ALERT_EMAIL` | optional CloudWatch alarm recipient |
| Secret | `OPENAI_API_KEY` | optional AI provider key |

The OIDC trust policy accepts only jobs from this repository that use a GitHub Environment. No long-lived AWS access key is required.

## 3. Deploy

Run **Deploy AWS** from GitHub Actions and select the environment. The workflow:

1. Builds or reuses immutable Rust and AI images in ECR.
2. Builds the Angular production bundle.
3. Plans and applies the selected Terraform environment with locked, versioned S3 state.
4. Runs `aura-shine-backend --migrate-only` in the private network and verifies exit code `0`.
5. Updates ECS only after migration success and waits for a healthy stable deployment.
6. Publishes a versioned frontend release, invalidates CloudFront, and verifies `/health`.

The workflow summary records the public URL and previous ECS task definition. Migrations must remain backward-compatible/additive because old and new tasks overlap during a rolling deployment.

## 4. Roll back

Run **Roll back AWS**. Leave `task_definition` blank to select the previous active revision, or provide a known-good ARN. Optionally provide a prior Git SHA from `releases/<sha>/` to restore its frontend. The same environment approval and health verification apply.

ECS deployment circuit breaker and the two ALB health alarms are also configured to restore the last completed deployment automatically when a rollout fails.

## 5. Prove backups can restore

Run **AWS backup restore drill**. It restores the newest available RDS snapshot as a private temporary instance, creates a temporary Secrets Manager value, and runs the current migration task against the restored database. The drill passes only when the container connects and exits successfully. The workflow then deletes only its temporary task definition, secret, and restored database.

Run the drill after the first automated snapshot, after major database changes, and at least monthly for production. Keep GitHub Action logs as the drill evidence.

## 6. Live-readiness proof (Phase 4)

- Run `Phase 4 live-readiness gate` from GitHub Actions.
- Keep the following evidence together:
  - device/browser readiness artifact(s)
  - capacity artifact(s) including k6 summary and AWS evidence
  - migration evidence from `backend-rust/migrations/0247_auth_tenant_branch_integrity.sql` and `tenant-isolation-readiness.ps1` proof run
- Use this combined artifact set as the pre-go-live trust proof before promoting `staging` to `prod`.

## Operations

- Confirm the SNS email subscription after first apply.
- Use CloudWatch alarms and ECS deployment events for incident notification.
- Do not edit generated runtime secrets directly; update protected Terraform inputs and redeploy.
- Never destroy the production state or data-protection stacks as a rollback method.
- A custom domain can be added with an ACM certificate and CloudFront alias after DNS ownership is available; the generated CloudFront HTTPS URL is deployable immediately.
