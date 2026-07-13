# Azure Backup Strategy

## Backup Objectives
The backup strategy must protect:
- Application configuration
- Database data
- Uploaded files
- Invoices and exports
- Deployment artifacts
- Monitoring and audit evidence needed for incident review

## Current Database Backup
The current application uses SQLite. Until a database migration is approved:
1. Keep the database file outside ephemeral deployment directories.
2. Schedule database snapshots to Azure Blob Storage.
3. Copy snapshots to a `backups` container.
4. Apply lifecycle rules:
   - hot tier for recent backups
   - cool tier for monthly backups
   - archive tier for long-term retention
5. Run periodic restore drills.

## MongoDB Atlas Backup Target
If MongoDB Atlas migration is approved:
1. Enable Atlas continuous backup or scheduled snapshots.
2. Configure retention by environment.
3. Restrict restore permissions.
4. Document restore to staging before production restore.
5. Keep Azure Blob export backups for critical reporting snapshots where required.

## Blob Storage Backup
For containers such as `uploads`, `exports`, `invoices`, and `backups`:
- Enable soft delete.
- Enable versioning for critical containers.
- Use lifecycle management to move old files to cool/archive.
- Deny public access by default.
- Store restore runbook in repository docs, not secrets.

## Azure Backup Usage
Use Azure Backup where supported for:
- App Service configuration snapshots
- Storage backup capabilities where enabled
- VM-based dependencies if any are introduced later

Do not rely on Azure Backup alone for application-level restore. Keep explicit database and Blob restore steps.

## Backup Flow
1. Application writes data and files.
2. Scheduled job creates database snapshot or export.
3. Snapshot is uploaded to Blob `backups`.
4. Blob lifecycle policy moves old snapshots to cool/archive.
5. Backup alert checks latest successful backup time.
6. Monthly restore drill validates recovery.

## Retention Plan
Suggested starting policy:
- Daily backups: 14 days
- Weekly backups: 8 weeks
- Monthly backups: 12 months
- Year-end backups: 7 years if compliance requires

Adjust retention after legal and business approval.

## Restore Drill Checklist
- Restore database to staging.
- Restore sample invoice/export files.
- Verify tenant and branch data boundaries.
- Verify login and POS smoke flow.
- Verify reports open with restored data.
- Record restore time and data loss window.

## Cost Controls
- Use archive tier for long-retention backups.
- Do not keep every export in hot storage forever.
- Enable budget alerts for storage growth.
- Review backup container size monthly.
- Prune non-production backups aggressively.
