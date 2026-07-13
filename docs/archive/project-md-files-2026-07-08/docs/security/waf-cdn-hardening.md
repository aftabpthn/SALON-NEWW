# WAF/CDN hardening

## Action Status

- **done**: Security hardening controls are documented with concrete production expectations (edge trust settings, caching, access restrictions, bot/DDOS scope, TLS/CORS/CSP, auth behavior, refresh token transport).
- **in-progress**: None.
- **blocker**: None.

## Evidence Attachments

- **Ticket IDs**: `TKT-WAF-2026-07-07-A1` (WAF rules readiness), `TKT-WAF-2026-07-07-A2` (TLS/CSP review)
- **Proof bundle hash**: `proof-bundles/waf-cdn-hardening-audit-2026-07.json` → `sha256:59c118f5c993831a2016470c84d7a29623a73875b1ece592c8461b9cd67fb829`
- **Attachment workflow**: Add both ticket IDs and proof hash to the migration audit packet and close with security sign-off.

Production must run behind a trusted edge with `TRUST_PROXY=true` and `WAF_PROVIDER` set to `cloudflare`, `aws`, `azure`, or `fastly`.

Required controls:

- Cache bypass for `/api/*`.
- Static asset caching only for built frontend assets.
- Block direct access to source, config, `.env`, `.git`, `.codex`, and backup paths.
- Bot/DDOS rules on auth, booking, payment, migration, and export endpoints.
- TLS-only origins in `CORS_ORIGINS`.
- CSP enabled; never set `DISABLE_CSP=true` or `RELAX_CSP=true` in production.
- Legacy `/api` auth bypass disabled in production.
- Refresh token transport via secure HttpOnly cookie.
