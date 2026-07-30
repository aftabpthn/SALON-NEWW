# Data Migration Phase 6: Wrong-Column Protection

## Runtime contract

Manual, saved, provider and automatic mappings use the same deterministic mapping and row-transformation pipeline. A mapping approval never bypasses row validation. Any hard issue makes the row non-ready; existing job commit paths only receive ready rows.

Every row issue can include `rowNumber`, `sourceField`, `valuePattern` and `suggestedTarget`. Source values remain in immutable migration evidence and are not copied into logs or error metadata.

The evidence records safety rule version `2026-07-phase6-v1` independently from the Phase 5 transformer version.

## Protected checks

| Check | Blocking code |
| --- | --- |
| Phone value mapped to email | `PHONE_VALUE_IN_EMAIL_FIELD` |
| Email value mapped to phone | `EMAIL_VALUE_IN_PHONE_FIELD` |
| Date source mapped to free text | `DATE_VALUE_IN_TEXT_FIELD` |
| Money source mapped to quantity | `MONEY_VALUE_IN_QUANTITY_FIELD` |
| Boolean source mapped to status | `BOOLEAN_VALUE_IN_STATUS_FIELD` |
| Staff/client or other reference type crossed | `REFERENCE_ENTITY_MISMATCH` |
| Invoice number mapped to payment reference | `INVOICE_NUMBER_IN_PAYMENT_REFERENCE_FIELD` |
| Product SKU/barcode crossed | `PRODUCT_SKU_IN_BARCODE_FIELD` / `PRODUCT_BARCODE_IN_SKU_FIELD` |
| Contract maximum length exceeded | `MAX_LENGTH_EXCEEDED` |

Duplicate targets and missing required targets remain hard mapping blockers in the central confidence engine. Mixed-pattern columns remain Yellow and require approval; after approval, each incompatible row is still quarantined instead of being blindly imported.

## Acceptance

- Manual mappings cannot bypass protected datatype or semantic-reference checks.
- Error rows show their source row, code, detected pattern and safe target suggestion when one exists.
- Missing required mappings block preparation; required empty values block the row.
- Hard-error rows never enter the ready-row commit payload, including partial-import jobs.
