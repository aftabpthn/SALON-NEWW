# Zenoti 16 Image Reference Map

## Action Status

- **done**: Mapped all 16 reference screenshots to concrete Aura routes and implementation notes.
- **in-progress**: None.
- **blocker**: None.

## Evidence Attachments

- **Ticket IDs**: `TKT-ZENOTI-2026-07-07-A1` (reference mapping), `TKT-ZENOTI-2026-07-07-A2` (route validation)
- **Proof bundle hash**: `proof-bundles/zenoti-image-reference-implementation-2026-07.json` → `sha256:cca6b57a4723b85b6e4a91ae688f67911a6d3c4fdcd02cc6a1c4938760516462`
- **Attachment workflow**: Link ticket IDs and proof bundle hash in release evidence notes before claiming UI parity closed.

Source ZIP: `C:\Users\Aftab Ahamad\Downloads\Zenoti_16_Separate_Images.zip`

Runtime image path: `/zenoti-reference/`

| Image | Reference screen | Aura module/page target |
| --- | --- | --- |
| `zenoti_feature_01.png` | Employee List | `/staff/directory` |
| `zenoti_feature_02.png` | Edit Employee - General | `/staff/:id` employee profile general tab |
| `zenoti_feature_03.png` | Employee Roles | `/staff/:id` roles + branches tab |
| `zenoti_feature_04.png` | Services Assigned to Employee | `/staff/:id` services tab |
| `zenoti_feature_05.png` | Employee Commissions - Revenue Slab | `/staff/:id` commission slabs tab |
| `zenoti_feature_06.png` | Employee Schedule - Week View | `/staff` shift planner and future roster page |
| `zenoti_feature_07.png` | Attendance Summary | `/staff` attendance tracking and staff summary |
| `zenoti_feature_08.png` | Payroll Report | `/staff/payroll-preview` |
| `zenoti_feature_09.png` | Guest List | `/clients` |
| `zenoti_feature_10.png` | Guest Profile - Overview | `/clients/:id` and `/customer-360` |
| `zenoti_feature_11.png` | Guest Notes | `/clients/:id` notes/preferences area |
| `zenoti_feature_12.png` | Guest Appointments | `/clients/:id` visit/appointment history |
| `zenoti_feature_13.png` | Guest Form Records | `/clients/:id` consent/forms area |
| `zenoti_feature_14.png` | Memberships & Packages | `/memberships` and client profile wallet |
| `zenoti_feature_15.png` | Wallet, Loyalty & Coupons | `/clients/:id` wallet/loyalty area |
| `zenoti_feature_16.png` | Online Booking Flow | `/book` and `/smart-booking` |

Implementation notes:
- Staff references 01-05 and 08 are already mapped into separate Staff pages/tabs.
- Guest references 09-15 should guide Client CRM and Customer 360 polishing.
- Online booking reference 16 should guide the customer booking flow without copying Zenoti branding.
