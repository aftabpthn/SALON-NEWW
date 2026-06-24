# Data Migration Security Closure Plan

Date: 2026-06-24

## Goal

Close the remaining launch security risks around migration uploads, spreadsheet parsing, and dependency audit findings without forcing breaking Angular downgrades.

## Current Status

- GitHub reports 9 remaining vulnerabilities on the default branch.
- Safe dependency updates have already been applied.
- `npm audit fix --force` is not approved because it proposes breaking Angular toolchain changes.
- `xlsx` remains the highest migration-specific risk because npm audit reports no safe patched release.

## Required Controls Before Public Launch

- Keep migration upload APIs restricted to authenticated tenant admins.
- Enforce tenant and branch headers on every upload, analyze, dry-run, import, proof export, and rollback action.
- Reject files above the configured upload size limit.
- Accept only `.xlsx`, `.xls`, and `.csv`.
- Store original uploads as read-only evidence.
- Never execute spreadsheet formulas or macros.
- Validate every row server-side before import.
- Keep final import blocked when critical errors are present.
- Require explicit approval for partial imports.

## `xlsx` Risk Strategy

Short term:

- Keep uploads admin-only.
- Use analyzer validation before any database write.
- Keep rollback proof required for final imports.
- Treat untrusted exports as hostile input.

Medium term:

- Evaluate replacing `xlsx` with a maintained parser or isolated conversion worker.
- Add parser isolation with timeout, memory limit, and file type sniffing.
- Add malicious spreadsheet samples to the migration test pack.

## Launch Decision

Public launch can proceed only if:

- Migration imports remain admin-only.
- Upload validation and dry-run gates are mandatory.
- Remaining audit issues are accepted as dev-tooling or isolated upload risks with documented controls.
- A parser replacement ticket is created for the first post-launch hardening sprint.
