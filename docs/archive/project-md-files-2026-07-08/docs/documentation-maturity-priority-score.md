# Documentation Maturity Priority Score (Top 30)

Date: 2026-07-07  
Scope: `docs/` only (current workspace snapshot).

**Scoring method (0-100):**  
- `Purpose` heading (+20), `Action Status` heading (+20), major section heading (+15), any status tag (+10), links/code examples (+20), penalty for TODO/placeholders (-5).

**Priority bands:**  
- **0-35 (critical):** likely needs ~**60 min** each  
- **36-60 (needs uplift):** likely needs ~**30 min** each  
- **61-80 (cleanup):** likely needs ~**10 min** each

## Top 10 (highest gap risk)
1. `waf-cdn-hardening.md` — score **0** (60 min): add baseline sections (`Purpose`, `Scope`, `Action Status`) and explicit readiness status.
2. `ZENOTI_16_IMAGE_REFERENCE_MAP.md` — score **0** (60 min): normalize doc header and maturity tags.
3. `DATA_MIGRATION_CENTER.md` — score **0** (60 min): add objective sections + action-status block.
4. `data-migration-production-deployment-checklist.md` — score **0** (60 min): align with runbook format and status taxonomy.
5. `data-migration-final-qa-report.md` — score **0** (60 min): add standard section map (`Purpose`, `Current Status`, `Action Status`).
6. `data-migration-launch-signoff.md` — score **0** (60 min): add blocker/in-progress/done tags and closure checklist.
7. `data-migration-monitoring-alerts.md` — score **0** (60 min): structure as operational doc with explicit action tags.
8. `DESIGN_SYSTEM.md` — score **0** (60 min): normalize with baseline section structure.
9. `data-migration-real-client-pilot-runbook.md` — score **0** (60 min): replace minimal runbook shell with acceptance gates + status.
10. `industry-grade-doc-buckets.md` — score **0** (60 min): map buckets to baseline readiness and status columns.

## Top 20
11. `data-migration-export-templates.md` — score **0** (60 min): add maturity sections + explicit action status.
12. `data-migration-launch-checklist.md` — score **5** (60 min): add `Action Status` and close remaining blockers.
13. `SYSTEM_BLUEPRINT.md` — score **5** (60 min): add explicit status and sectioning.
14. `2026-07-02-to-2026-07-06-changes.md` — score **5** (60 min): normalize to baseline change-log format.
15. `DEPLOYMENT_GUIDE.md` — score **10** (30 min): add `Action Status` section, keep links and rollback path explicit.
16. `aws-advanced-hardening.md` — score **10** (30 min): add purpose/action status and operational next-step ownership.
17. `PRD_LEVEL_17_22.md` — score **10** (30 min): convert to current action-status template.
18. `ZENOTI_FRESHA_ROADMAP.md` — score **10** (30 min): normalize headings and progress labels.
19. `PROJECT_AUDIT_REPORT.md` — score **10** (30 min): add clear done/in-progress/blocker buckets.
20. `ENTERPRISE_100X_BLUEPRINT.md` — score **10** (30 min): add baseline action-status format and owners.

## Top 30
21. `0001-recording-decisions.md` — score **15** (30 min): add explicit `Action Status` and purpose-level context.
22. `data-migration-go-live-rehearsal.md` — score **15** (30 min): align format + ownership table.
23. `dependency-security-review.md` — score **15** (30 min): add clear blockers and next-sprint actions.
24. `data-migration-audit.md` — score **15** (30 min): section-structuring and status clarity.
25. `data-migration-client-intake-pack.md` — score **20** (30 min): add `Action Status` and scope tags.
26. `profit-intelligence.md` — score **20** (30 min): add baseline action status + completion criteria.
27. `data-migration-security-closure-plan.md` — score **25** (10-30 min): add explicit blockers and closure checklist status.
28. `ENTERPRISE-SECURITY-SHIELD.md` — score **25** (10-30 min): add living-status with clear blockers.
29. `packages.md` — score **25** (10-30 min): add `Purpose` and `Action Status`.
30. `docs/adr/README.md` — score **30** (10 min): add `Purpose` + `Action Status` with owner line.

## Notes

- This is a **gap/normalization list**, not a quality scorecard of product correctness.
- Files in Goldens (`AGENTS.md`, `release-process.md`, `quality-gates.md`, `industry-grade-doc-buckets-gap-report.md`, `docs/runbook/README.md`) are already status-tagged and currently not in top 30.
