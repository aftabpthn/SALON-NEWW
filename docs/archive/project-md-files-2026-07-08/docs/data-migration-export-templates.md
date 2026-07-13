# Data Migration Export Templates

Date: 2026-06-24

## Goal

Give onboarding and clients a consistent export request format for old salon software.

## Universal Export Request

Ask the client to export these files:

- `clients`
- `services`
- `staff`
- `products`
- `inventory`
- `appointments`
- `invoices`
- `payments`
- `memberships`
- `packages`
- `gift_cards`
- `coupons`
- `branches`

## Required Columns

Clients:

- Original client ID
- Full name
- Phone
- Email
- Gender
- Date of birth
- Created date
- Branch
- Tags

Invoices:

- Original invoice ID
- Invoice number
- Client ID
- Invoice date
- Branch
- Subtotal
- Discount
- Tax
- Total
- Paid amount
- Balance

Payments:

- Original payment ID
- Invoice number
- Client ID
- Payment date
- Payment mode
- Amount
- Branch
- Reference number

Products and inventory:

- Product ID
- SKU
- Barcode
- Product name
- Category
- Brand
- Branch
- Quantity
- Purchase price
- Selling price
- Tax rate

## Export Instructions For Clients

- Export data after business close.
- Do not manually edit files.
- Keep one file per module where possible.
- Include all branches in the export.
- Send the matching old software summary reports for reconciliation.

## File Naming

Use this pattern:

`clientname_source_module_branch_exportdate.xlsx`

Example:

`aura_dingg_clients_allbranches_2026-06-24.xlsx`
