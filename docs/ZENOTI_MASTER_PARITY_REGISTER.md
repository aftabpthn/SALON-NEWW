# Zenoti Master Parity Register

Baseline locked: **2026-08-02**
Machine-readable register: [JSON](./evidence/zenoti-master-parity-register.json) · [CSV](./evidence/zenoti-master-parity-register.csv)
Route truth: [README vs mounted routes](./evidence/aura-route-truth.json)

## Phase 0 result

- Atomic canonical rows: **2616**
- Duplicate IDs, capability keys, and exact atomic signatures: **0**
- Literal `UNKNOWN` values: **0**; absent evidence uses explicit `NOT_EVIDENCED_IN_PHASE_0:*` markers.
- Help Center navigation URLs locked: **2517**
- API changelog entries locked: **10**
- Inventory source drift: requested 40/15/8, current register is **63/0/0** across 64 source rows. Nine duplicate source pairs are consolidated into 55 canonical rows and retained in `sourceRowIds`.
- Staff App register is linked by SHA-256 with **149** rows; it is not copied into a competing second register.
- README endpoint claims: **178**; mounted **56**, future **118**, external **3**, retired **1**. Unknown classifications: **0**.

### Status counts

- Complete: 55
- Unmapped: 2561

### Source counts

- api_changelog_index: 10
- help_center+inventory_subregister: 31
- help_center_navigation: 2486
- inventory_subregister: 24
- pricing_catalog: 28
- release_2026_atomic_delta: 37

## Locked official sources

- [Zenoti 2026 pricing](https://www.zenoti.com/pricing-zenoti-26)
- [Zenoti Help Center navigation](https://help.zenoti.com/en/release-notes.html)
- [Zenoti release notes](https://help.zenoti.com/en/release-notes.html)
- [Zenoti API changelog](https://docs.zenoti.com/changelog)

Source content hashes and access timestamps are stored in the JSON register. Salon, spa, medspa, fitness and barbershop are separate booleans on every row. Public, representative-enabled, commercially gated and region-gated availability is explicit.

## Linked sub-registers

- [Inventory parity register](./INVENTORY_ZENOTI_PARITY_REGISTER.md)
- [Staff App parity register](./STAFF_APP_ZENOTI_PARITY_REGISTER.md)

## Product-owner gate

Phase 0 technical register gate: **PASS**.
Phase 1 authorization: **APPROVED**.

Product owner: ____________________
Decision: **APPROVED_BY_USER_INSTRUCTION_2026-08-02**
Date: ____________________
Baseline hash: `a9da9638d57b5b3df01dbbc942478279463ed252c34a54e552f750c4b733c5d7`
