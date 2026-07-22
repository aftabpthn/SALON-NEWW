const basePermissionResources = [
  "dashboard",
  "appointments",
  "clients",
  "services",
  "packages",
  "memberships",
  "gift-cards",
  "staff",
  "payroll",
  "products",
  "inventory",
  "inventory-intelligence",
  "pos",
  "sales",
  "invoices",
  "payments",
  "appointment_deposits",
  "finance",
  "cash-drawer",
  "outgoing-funds",
  "refunds",
  "suppliers",
  "reports",
  "analytics",
  "marketing",
  "whatsapp",
  "reviews",
  "loyalty",
  "branches",
  "booking-portal",
  "online-booking",
  "coupons",
  "notifications",
  "settings",
  "security",
  "workflows",
  "customer-360",
  "smart-booking",
  "ai",
  "quality",
  "deployment",
  "migration",
  "marketplace-integrations",
  "plugins",
  "developer-api",
  "webhooks",
  "localization",
  "franchise",
  "leads",
  "purchases",
  "warehouse-products",
  "tax-settings"
];

function item(groupKey, groupLabel, resource, action, label, category, uiTargets = [], apiTargets = []) {
  return { groupKey, groupLabel, resource, action, label, category, uiTargets, apiTargets };
}

export const staffPermissionCatalog = [
  item("dashboard", "Dashboard", "pos", "read", "Quicksale", "dashboard", ["/pos"], ["GET /pos-settings"]),
  item("dashboard", "Dashboard", "staff-calendar", "read", "Staff Calendar", "dashboard", ["/appointments"], ["GET /staff-schedule"]),
  item("dashboard", "Dashboard", "room-calendar", "read", "Room Calendar", "dashboard", ["/appointments"], ["GET /resources"]),
  item("dashboard", "Dashboard", "cashbook", "read", "Cashbook", "dashboard", ["/finance"], ["GET /transactions"]),
  item("dashboard", "Dashboard", "clients", "read", "Clients", "dashboard", ["/clients"], ["GET /resources/clients"]),
  item("dashboard", "Dashboard", "appointments", "read", "Appointment", "dashboard", ["/appointments"], ["GET /appointments"]),
  item("dashboard", "Dashboard", "marketplace-integrations", "read", "Integration", "dashboard", ["/marketplace-integrations"], ["GET /marketplace"]),
  item("dashboard", "Dashboard", "outgoing-funds", "read", "Expenditure", "dashboard", ["/transactions/outgoing-funds-report"], ["GET /transactions/outgoing-funds"]),
  item("dashboard", "Dashboard", "inventory", "read", "Warehouse", "dashboard", ["/inventory"], ["GET /inventory"]),
  item("dashboard", "Dashboard", "products", "read", "Products", "dashboard", ["/inventory/products"], ["GET /resources/products"]),
  item("dashboard", "Dashboard", "dashboard", "read", "Home", "dashboard", ["/home"], ["GET /dashboard"]),
  item("dashboard", "Dashboard", "consent-forms", "read", "Consent Form", "dashboard", ["/smart-forms"], ["GET /forms"]),
  item("dashboard", "Dashboard", "custom-fields", "read", "Custom Fields", "dashboard", ["/settings"], ["GET /settings"]),
  item("dashboard", "Dashboard", "booking-settings", "read", "Booking Setting", "dashboard", ["/calendar-settings"], ["GET /calendar-settings"]),
  item("dashboard", "Dashboard", "notifications", "read", "Notifications", "dashboard", ["/notification-center"], ["GET /notifications"]),
  item("dashboard", "Dashboard", "pos", "read", "Point of Sale", "dashboard", ["/pos"], ["GET /billing/invoices"]),
  item("dashboard", "Dashboard", "register-close", "allow", "Register Close", "dashboard", ["/pos/cash-drawer-eod"], ["POST /day-close"]),
  item("dashboard", "Dashboard", "reports", "read", "Reports", "dashboard", ["/reports"], ["GET /reports"]),

  item("quicksale", "Quicksale Permission", "book-services", "allow", "Book Services", "quicksale", ["/pos"], ["POST /billing/invoices/draft"]),
  item("quicksale", "Quicksale Permission", "book-products", "allow", "Book Products", "quicksale", ["/pos"], ["POST /billing/invoices/draft"]),
  item("quicksale", "Quicksale Permission", "book-memberships", "allow", "Book Memberships", "quicksale", ["/pos"], ["POST /billing/invoices/draft"]),
  item("quicksale", "Quicksale Permission", "book-packages", "allow", "Book Packages", "quicksale", ["/pos"], ["POST /billing/invoices/draft"]),
  item("quicksale", "Quicksale Permission", "book-giftcards", "allow", "Book Giftcards", "quicksale", ["/pos"], ["POST /billing/invoices/draft"]),

  item("reports", "Reports Permission", "reports", "export", "Export Option on reports", "reports", ["/reports"], ["GET /reports/*/export"]),
  item("reports", "Reports Permission", "report-other-staff", "allow", "Can check other staff report?", "reports", ["/reports"], ["GET /staff-sales-report"]),
  item("reports", "Reports Permission", "report-cancelled-void-bill", "read", "Cancelled/Void-ed Bill", "reports", ["/pos/invoice-activity"], ["GET /audit/invoices"]),
  item("reports", "Reports Permission", "report-sale-summary", "read", "Sale Summary", "reports", ["/reports"], ["GET /reports/sales-summary"]),
  item("reports", "Reports Permission", "report-financial-summary", "read", "Financial Summary", "reports", ["/finance"], ["GET /finance"]),
  item("reports", "Reports Permission", "report-payment-distributions", "read", "Payment Distributions", "reports", ["/reports"], ["GET /payments"]),
  item("reports", "Reports Permission", "report-product-sales", "read", "Product Sales", "reports", ["/reports"], ["GET /reports/product-sales"]),
  item("reports", "Reports Permission", "report-product-inventory", "read", "Product Inventory", "reports", ["/inventory/reports"], ["GET /inventory"]),
  item("reports", "Reports Permission", "report-product-inout-retail", "read", "Product IN/OUT Report (Retail)", "reports", ["/inventory/reports"], ["GET /inventory"]),
  item("reports", "Reports Permission", "report-product-inout-inhouse", "read", "Product IN/OUT Report (IN House)", "reports", ["/inventory/reports"], ["GET /inventory"]),
  item("reports", "Reports Permission", "report-product-audits", "read", "Product Audits", "reports", ["/inventory/stock-audit"], ["GET /inventory"]),
  item("reports", "Reports Permission", "report-sales-discount", "read", "Sales Discount", "reports", ["/reports"], ["GET /reports/discounts"]),
  item("reports", "Reports Permission", "report-deleted-invoice", "read", "Deleted Invoice", "reports", ["/pos/invoice-activity"], ["GET /audit/invoices"]),
  item("reports", "Reports Permission", "report-daily-sheet", "read", "Daily Sheet", "reports", ["/reports"], ["GET /reports/daily-sheet"]),
  item("reports", "Reports Permission", "report-today-daily-sheet", "read", "Today Daily Sheet", "reports", ["/reports"], ["GET /reports/daily-sheet"]),
  item("reports", "Reports Permission", "report-daily-revenue", "read", "Daily Revenue", "reports", ["/reports"], ["GET /reports/daily-revenue"]),
  item("reports", "Reports Permission", "report-taxes", "read", "Taxes", "reports", ["/reports"], ["GET /tax-settings"]),
  item("reports", "Reports Permission", "report-member-nonmember-sales", "read", "Members & Non Members Sales", "reports", ["/reports"], ["GET /reports/member-sales"]),
  item("reports", "Reports Permission", "report-package-sales", "read", "Package Sales", "reports", ["/reports"], ["GET /reports/package-sales"]),
  item("reports", "Reports Permission", "report-rewards-history", "read", "Rewards History", "reports", ["/reports"], ["GET /loyalty"]),
  item("reports", "Reports Permission", "report-customers-sales", "read", "Customers Sales", "reports", ["/reports"], ["GET /reports/client-sales"]),
  item("reports", "Reports Permission", "report-customer-feedback", "read", "Customer Feedback", "reports", ["/reputation"], ["GET /reputation"]),
  item("reports", "Reports Permission", "report-customer-history", "read", "Customer History", "reports", ["/customer-360"], ["GET /customer-360"]),
  item("reports", "Reports Permission", "report-sales-prepaid-method", "read", "Sales By Prepaid Method", "reports", ["/reports"], ["GET /reports/prepaid"]),
  item("reports", "Reports Permission", "report-client-revenue", "read", "Client Revenue", "reports", ["/reports"], ["GET /reports/client-revenue"]),
  item("reports", "Reports Permission", "report-service-trends", "read", "Service Trends", "reports", ["/reports"], ["GET /reports/invoices/service-trends"]),
  item("reports", "Reports Permission", "report-service-sales", "read", "Service Sales", "reports", ["/reports"], ["GET /reports/service-sales"]),
  item("reports", "Reports Permission", "report-membership-redeem", "read", "Membership Redeem", "reports", ["/reports"], ["GET /membership-enterprise"]),
  item("reports", "Reports Permission", "report-clients-subscription", "read", "Clients Subscription", "reports", ["/reports"], ["GET /memberships"]),
  item("reports", "Reports Permission", "report-pending-packages", "read", "Pending Packages", "reports", ["/pending-packages-report"], ["GET /reports/pending-packages"]),
  item("reports", "Reports Permission", "report-expired-packages", "read", "Expired Packages", "reports", ["/pending-packages-report"], ["GET /reports/pending-packages"]),
  item("reports", "Reports Permission", "report-expiring-packages", "read", "To be Expired Packages", "reports", ["/pending-packages-report"], ["GET /reports/pending-packages"]),
  item("reports", "Reports Permission", "report-completed-packages", "read", "Completed Packages", "reports", ["/completed-packages-report"], ["GET /reports/completed-packages"]),
  item("reports", "Reports Permission", "report-services-untaken", "read", "Services Untaken", "reports", ["/reports"], ["GET /reports/services"]),
  item("reports", "Reports Permission", "report-service-clients", "read", "Service Clients", "reports", ["/reports"], ["GET /reports/invoices/service-clients"]),
  item("reports", "Reports Permission", "report-membership-sales-customer", "read", "Memberships Sale By Customer", "reports", ["/reports"], ["GET /membership-enterprise"]),
  item("reports", "Reports Permission", "report-pending-payments", "read", "Pending Payments", "reports", ["/payments"], ["GET /payments"]),
  item("reports", "Reports Permission", "report-giftcard-history", "read", "Giftcard History", "reports", ["/reports"], ["GET /gift-cards"]),
  item("reports", "Reports Permission", "report-staff-sales", "read", "Staff Sales", "reports", ["/staff-sales-report"], ["GET /staff-sales-report"]),
  item("reports", "Reports Permission", "report-staff-service-sales", "read", "Staff Service Sales", "reports", ["/staff-sales-report"], ["GET /staff-sales-report"]),
  item("reports", "Reports Permission", "report-staff-service-sales-discount", "read", "Staff Service Sales With Discount", "reports", ["/staff-sales-report"], ["GET /staff-sales-report"]),
  item("reports", "Reports Permission", "report-payroll-history", "read", "Payroll History", "reports", ["/staff-os/payroll-history"], ["GET /staff-payroll"]),
  item("reports", "Reports Permission", "report-leads", "read", "Leads Report", "reports", ["/reports"], ["GET /leads"]),
  item("reports", "Reports Permission", "report-employees-attendance", "read", "Employees Attendance", "reports", ["/staff-os/attendance"], ["GET /staff-attendance"]),
  item("reports", "Reports Permission", "report-staff-revenue", "read", "Staff Revenue", "reports", ["/staff-sales-report"], ["GET /staff-sales-report"]),
  item("reports", "Reports Permission", "report-staff-collections", "read", "Staff collections", "reports", ["/staff-sales-report"], ["GET /staff-sales-report"]),
  item("reports", "Reports Permission", "report-staff-tips", "read", "Staff Tips", "reports", ["/pos/tips"], ["GET /staff-tips"]),
  item("reports", "Reports Permission", "report-detail-appointment-list", "read", "Detail Appointment List", "reports", ["/appointment-activity"], ["GET /appointment-activity"]),
  item("reports", "Reports Permission", "report-appointment-booked-by-staff", "read", "Appointment booked by staff", "reports", ["/appointment-activity"], ["GET /appointment-activity"]),
  item("reports", "Reports Permission", "report-vendor-list", "read", "Vendor List", "reports", ["/suppliers"], ["GET /suppliers"]),
  item("reports", "Reports Permission", "report-sales-performance", "read", "Sales Performance", "reports", ["/reports"], ["GET /reports/sales-performance"]),
  item("reports", "Reports Permission", "report-staff-performance", "read", "Staff Performance", "reports", ["/staff-os/performance"], ["GET /staff-performance"]),
  item("reports", "Reports Permission", "report-stocks", "read", "Stocks Report", "reports", ["/inventory/reports"], ["GET /inventory"]),
  item("reports", "Reports Permission", "report-others", "read", "Others Report", "reports", ["/reports"], ["GET /reports"]),
  item("reports", "Reports Permission", "send-notifications", "write", "Send Notifications", "reports", ["/notification-center"], ["POST /notifications"]),

  item("add-delete", "Add & Delete", "staff", "create", "Staff", "addDelete", ["/staff-os"], ["POST /staff"]),
  item("add-delete", "Add & Delete", "services", "create", "Services", "addDelete", ["/services"], ["POST /resources/services"]),
  item("add-delete", "Add & Delete", "packages", "create", "Package", "addDelete", ["/packages"], ["POST /resources/packages"]),
  item("add-delete", "Add & Delete", "memberships", "create", "Membership", "addDelete", ["/memberships"], ["POST /membership-enterprise"]),
  item("add-delete", "Add & Delete", "leads", "create", "Leads", "addDelete", ["/clients"], ["POST /leads"]),
  item("add-delete", "Add & Delete", "warehouse-products", "create", "Add Warehouse Product", "addDelete", ["/inventory"], ["POST /inventory"]),
  item("add-delete", "Add & Delete", "warehouse-products", "update", "Update Warehouse Product", "addDelete", ["/inventory"], ["PATCH /inventory"]),
  item("add-delete", "Add & Delete", "warehouse-products", "delete", "Delete Warehouse Product", "addDelete", ["/inventory"], ["DELETE /inventory"]),
  item("add-delete", "Add & Delete", "purchases", "create", "Add Purchase", "addDelete", ["/inventory/procurement"], ["POST /purchase"]),
  item("add-delete", "Add & Delete", "purchases", "update", "Update Purchase", "addDelete", ["/inventory/procurement"], ["PATCH /purchase"]),
  item("add-delete", "Add & Delete", "purchases", "delete", "Delete Purchase", "addDelete", ["/inventory/procurement"], ["DELETE /purchase"]),
  item("add-delete", "Add & Delete", "warehouse-request-approval", "allow", "Staff can Accept Reject Warehouse Requests?", "addDelete", ["/inventory"], ["POST /warehouse-requests/*/decision"]),
  item("add-delete", "Add & Delete", "products", "create", "Add Product", "addDelete", ["/inventory/products"], ["POST /resources/products"]),
  item("add-delete", "Add & Delete", "products", "update", "Update Product", "addDelete", ["/inventory/products"], ["PATCH /resources/products"]),
  item("add-delete", "Add & Delete", "products", "delete", "Delete Product", "addDelete", ["/inventory/products"], ["DELETE /resources/products"]),
  item("add-delete", "Add & Delete", "product-request-approval", "allow", "Staff can Accept Reject Product Requests?", "addDelete", ["/inventory"], ["POST /product-requests/*/decision"]),

  item("marketing", "Marketing Permission", "marketing", "write", "Campaigns", "marketing", ["/marketing"], ["POST /marketing"]),
  item("marketing", "Marketing Permission", "gift-cards", "write", "Gift Card", "marketing", ["/gift-cards"], ["POST /gift-cards"]),
  item("marketing", "Marketing Permission", "coupons", "write", "Coupon", "marketing", ["/coupons"], ["POST /coupon-engine"]),

  item("micro", "Micro Permission", "staff-message", "allow", "Message", "micro", ["/staff-os"], ["POST /messages"]),
  item("micro", "Micro Permission", "display-calendar", "allow", "Display in Calendar", "micro", ["/appointments"], ["GET /appointments"]),
  item("micro", "Micro Permission", "display-quicksale", "allow", "Display in QuickSale", "micro", ["/pos"], ["GET /pos"]),
  item("micro", "Micro Permission", "calendar-all-staff", "allow", "Calendar With All Staff Members", "micro", ["/appointments"], ["GET /appointments"]),
  item("micro", "Micro Permission", "staff-all-data", "allow", "Show Data With All Staff Members", "micro", ["/staff-os"], ["GET /staff"]),
  item("micro", "Micro Permission", "previous-bill-generation", "allow", "Previous Bill Generation", "micro", ["/pos"], ["POST /billing/invoices"]),
  item("micro", "Micro Permission", "display-staff-online-booking", "allow", "Display Staff for Online Booking", "micro", ["/book"], ["GET /booking-portal"]),
  item("micro", "Micro Permission", "show-product-cost-price", "allow", "Show Product CP/FP", "micro", ["/inventory"], ["GET /inventory"]),
  item("micro", "Micro Permission", "tax-settings", "write", "Tax Setting", "micro", ["/settings"], ["POST /tax-settings"]),
  item("micro", "Micro Permission", "price-edit-quicksale", "allow", "Price Editing on Quicksale", "micro", ["/pos"], ["PATCH /billing/invoices"]),
  item("micro", "Micro Permission", "price-edit-calendar", "allow", "Price Editing on Calendar", "micro", ["/appointments"], ["PATCH /appointments"]),
  item("micro", "Micro Permission", "discount-edit-quicksale", "allow", "Discount Editing on Quicksale", "micro", ["/pos"], ["PATCH /billing/invoices"]),
  item("micro", "Micro Permission", "discount-edit-calendar", "allow", "Discount Editing on Calendar", "micro", ["/appointments"], ["PATCH /appointments"]),
  item("micro", "Micro Permission", "outgoing-funds", "update", "Expense Edit", "micro", ["/transactions/outgoing-funds"], ["PATCH /transactions/outgoing-funds"]),
  item("micro", "Micro Permission", "outgoing-funds", "create", "Can Add Previous Expense?", "micro", ["/transactions/outgoing-funds"], ["POST /transactions/outgoing-funds"]),
  item("micro", "Micro Permission", "outgoing-funds", "delete", "Expense Delete", "micro", ["/transactions/outgoing-funds"], ["DELETE /transactions/outgoing-funds"]),
  item("micro", "Micro Permission", "invoices", "update", "Edit Bill Option", "micro", ["/pos/invoices"], ["PATCH /billing/invoices"]),
  item("micro", "Micro Permission", "cancel-bill", "allow", "Cancel Bill Option", "micro", ["/pos/invoices"], ["POST /audit/invoices/cancel"]),
  item("micro", "Micro Permission", "generate-full-payment-bill", "allow", "Generate Bill on Full Payment", "micro", ["/pos"], ["POST /billing/invoices"]),
  item("micro", "Micro Permission", "quick-sale-history", "read", "Quick Sale - View History", "micro", ["/pos/invoices"], ["GET /billing/invoices"]),
  item("micro", "Micro Permission", "clients", "read", "Show Client Details to Staff Member", "micro", ["/clients"], ["GET /resources/clients"]),
  item("micro", "Micro Permission", "appointments", "update", "Can change appointment status?", "micro", ["/appointments"], ["PATCH /appointments"]),
  item("micro", "Micro Permission", "staff-previous-bills-hidden", "allow", "Staff / manager can't see the previous bills?", "micro", ["/pos/invoices"], ["GET /billing/invoices"]),
  item("micro", "Micro Permission", "invoice-log", "read", "Can check Invoice Log?", "micro", ["/pos/invoice-activity"], ["GET /audit/invoices"]),
  item("micro", "Micro Permission", "clients", "update", "Staff Staff Can Edit Client Info", "micro", ["/clients"], ["PATCH /resources/clients"]),
  item("micro", "Micro Permission", "quick-sale-revenue", "allow", "Show Total Revenue in quicksale", "micro", ["/pos"], ["GET /billing-analytics"]),
  item("micro", "Micro Permission", "commission-billable", "allow", "Assign commission on whole billable amount?", "micro", ["/commissions"], ["POST /commissions"]),
  item("micro", "Micro Permission", "staff-ewallet-update", "allow", "Staff can update ewallet", "micro", ["/clients"], ["PATCH /wallet"]),
  item("micro", "Micro Permission", "staff-schedule", "read", "Staff Schedule", "micro", ["/staff-os/roster"], ["GET /staff-schedule"]),
  item("micro", "Micro Permission", "appointments", "delete", "Staff can delete appointments", "micro", ["/appointments"], ["DELETE /appointments"]),
  item("micro", "Micro Permission", "product-audit", "allow", "Staff can audit products", "micro", ["/inventory/stock-audit"], ["POST /inventory/audit"]),
  item("micro", "Micro Permission", "staff-payment-date", "allow", "Staff can update payment date", "micro", ["/payments"], ["PATCH /payments"]),
  item("micro", "Micro Permission", "staff-checkin-checkout", "allow", "Staff can checkin and checkout", "micro", ["/staff-os/attendance"], ["POST /staff-attendance"]),
  item("micro", "Micro Permission", "staff", "write", "Manage Staff", "micro", ["/staff-os"], ["POST /staff"]),
  item("micro", "Micro Permission", "staff-tips", "allow", "Staff can add tips", "micro", ["/pos/tips"], ["POST /staff-tips"]),
  item("micro", "Micro Permission", "limited-permission-assignment", "allow", "Staff can assign permission", "micro", ["/permissions"], ["PATCH /security/users/*/limited-role"]),

  item("home-screen", "Micro Permission - Home Screen", "home-sales-graph", "read", "Sales Graph", "homeScreen", ["/home"], ["GET /dashboard"])
];

export const staffAppPermissionCatalog = [
  item("scheduling", "Scheduling", "staff-app-appointments", "read", "View appointments", "scheduling", ["/staff/appointments"], ["GET /appointments"]),
  item("scheduling", "Scheduling", "staff-app-appointments", "update", "Update appointment status", "scheduling", ["/staff/calendar"], ["PATCH /appointments"]),
  item("scheduling", "Scheduling", "staff-app-appointments", "write", "Send chat messages", "scheduling", ["/staff/chat"], ["POST /team-chat"]),

  item("team", "Team", "staff-app-staff", "read", "View staff data", "team", ["/staff/tasks", "/staff/reports", "/staff/leaderboard"], ["GET /staff"]),
  item("team", "Team", "staff-app-staff", "write", "Manage tasks and leaves", "team", ["/staff/attendance", "/staff/tasks"], ["POST /staff-attendance", "POST /team-tasks"]),
  item("team", "Team", "staff-app-staff", "update", "Update tasks and leaves", "team", ["/staff/tasks", "/staff/leaves"], ["PATCH /team-tasks"]),

  item("attendance", "Attendance", "staff-app-checkin-checkout", "allow", "Staff can check in and out", "attendance", ["/staff/attendance"], ["POST /staff-attendance"]),

  item("finance", "Finance & Revenue", "staff-app-finance", "read", "View finance data", "finance", ["/staff/payroll", "/staff/performance"], ["GET /finance"]),
  item("finance", "Finance & Revenue", "staff-app-payroll", "read", "View payroll", "finance", ["/staff/payroll"], ["GET /staff-payroll"]),
  item("finance", "Finance & Revenue", "staff-app-payroll", "write", "Manage payroll", "finance", ["/staff/payroll"], ["POST /staff-payroll"]),
  item("finance", "Finance & Revenue", "staff-app-sales", "read", "View sales data", "finance", ["/staff/performance"], ["GET /sales"]),
  item("finance", "Finance & Revenue", "staff-app-payments", "read", "View payments data", "finance", ["/staff/performance"], ["GET /payments"]),
  item("finance", "Finance & Revenue", "staff-app-invoices", "read", "View invoices data", "finance", ["/staff/performance"], ["GET /invoices"]),

  item("notifications", "Notifications", "staff-app-notifications", "read", "View notifications", "notifications", ["/staff/notifications"], ["GET /notifications"]),
  item("notifications", "Notifications", "staff-app-notifications", "update", "Mark notifications read", "notifications", ["/staff/notifications"], ["PATCH /notifications"]),
  item("notifications", "Notifications", "staff-app-notifications", "write", "Manage staff notifications", "notifications", ["/staff/notifications"], ["POST /notifications"])
  ,item("staff-os", "Staff OS", "staff-app-master", "read", "View Staff OS masters", "staffOs", ["/staff-os"], ["GET /staff-os/staff-categories", "GET /staff-os/*-masters"])
  ,item("staff-os", "Staff OS", "staff-app-master", "write", "Manage Staff OS masters", "staffOs", ["/staff-os"], ["POST/PATCH /staff-os/*-masters"])
  ,item("staff-os", "Staff OS", "staff-app-schedules", "read", "View staff schedules", "staffOs", ["/staff-os/roster"], ["GET /staff-os/schedules", "GET /staff-os/shift-swaps"])
  ,item("staff-os", "Staff OS", "staff-app-schedules", "write", "Manage staff schedules", "staffOs", ["/staff-os/roster"], ["POST/PATCH/DELETE /staff-os/schedules", "POST /staff-os/shift-swaps"])
  ,item("staff-os", "Staff OS", "staff-app-attendance", "read", "View attendance", "staffOs", ["/staff-os/attendance"], ["GET /staff-os/attendance"])
  ,item("staff-os", "Staff OS", "staff-app-attendance", "write", "Record and correct attendance", "staffOs", ["/staff-os/attendance"], ["POST /staff-os/attendance"])
  ,item("staff-os", "Staff OS", "staff-app-leave", "read", "View leave", "staffOs", ["/staff-os/leaves"], ["GET /staff-os/leaves", "GET /staff-os/leave-calendar"])
  ,item("staff-os", "Staff OS", "staff-app-leave", "write", "Request and decide leave", "staffOs", ["/staff-os/leaves"], ["POST/PATCH /staff-os/leaves"])
  ,item("staff-os-sensitive", "Staff OS Sensitive", "staff-app-commissions", "read", "View commissions", "staffOs", ["/staff-os/commissions"], ["GET /staff-os/commissions"])
  ,item("staff-os-sensitive", "Staff OS Sensitive", "staff-app-commissions", "write", "Calculate and approve commissions", "staffOs", ["/staff-os/commissions"], ["POST /staff-os/commissions"])
  ,item("staff-os-sensitive", "Staff OS Sensitive", "staff-app-tips", "read", "View tips", "staffOs", ["/staff-os/tips"], ["GET /staff-os/tips"])
  ,item("staff-os-sensitive", "Staff OS Sensitive", "staff-app-tips", "write", "Manage tips", "staffOs", ["/staff-os/tips"], ["POST/PATCH /staff-os/tips"])
  ,item("staff-os-sensitive", "Staff OS Sensitive", "staff-app-performance", "read", "View staff performance", "staffOs", ["/staff-os/performance"], ["GET /staff-os/performance"])
  ,item("staff-os-sensitive", "Staff OS Sensitive", "staff-app-performance", "write", "Manage performance targets", "staffOs", ["/staff-os/performance"], ["POST/PATCH /staff-os/performance"])
  ,item("staff-os-sensitive", "Staff OS Sensitive", "staff-app-intelligence", "read", "View workforce intelligence", "staffOs", ["/staff-os/intelligence"], ["GET /staff-os/intelligence"])
  ,item("staff-os-sensitive", "Staff OS Sensitive", "staff-app-intelligence", "write", "Run workforce intelligence actions", "staffOs", ["/staff-os/intelligence"], ["POST /staff-os/intelligence"])
  ,item("staff-os", "Staff OS", "staff-app-mobile", "read", "View Staff App mobile data", "staffOs", ["/staff"], ["GET /staff-os/mobile"])
  ,item("staff-os", "Staff OS", "staff-app-mobile", "write", "Submit Staff App mobile requests", "staffOs", ["/staff"], ["POST /staff-os/mobile"])
  ,item("staff-os", "Staff OS", "staff-app-tasks", "read", "View staff tasks", "staffOs", ["/staff/tasks"], ["GET /staff-os/tasks"])
  ,item("staff-os", "Staff OS", "staff-app-tasks", "write", "Manage staff tasks", "staffOs", ["/staff/tasks"], ["POST/PATCH /staff-os/tasks"])
  ,item("staff-os-sensitive", "Staff OS Sensitive", "staff-app-audit", "read", "View Staff OS audit trail", "staffOs", ["/staff-os/audit"], ["GET /staff-os/audit"])
  ,item("staff-os-sensitive", "Staff OS Sensitive", "staff-app-reports", "read", "View Staff OS reports", "staffOs", ["/staff-os/reports"], ["GET /staff-os/reports"])
  ,item("staff-os-sensitive", "Staff OS Sensitive", "staff-app-biometric", "read", "View biometric operations", "staffOs", ["/staff-os/biometric"], ["GET /staff-os/biometric", "GET /staff-os/attendance/biometric-center"])
  ,item("staff-os-sensitive", "Staff OS Sensitive", "staff-app-biometric", "write", "Manage biometric operations", "staffOs", ["/staff-os/biometric"], ["POST/PATCH /staff-os/biometric", "POST /staff-os/attendance/fraud-scan"])
  ,item("staff-os-sensitive", "Staff OS Sensitive", "staff-app-payroll-compliance", "read", "View payroll compliance", "staffOs", ["/staff-os/payroll"], ["GET /staff-os/payroll-compliance"])
  ,item("staff-os-sensitive", "Staff OS Sensitive", "staff-app-payroll-compliance", "write", "Manage payroll compliance", "staffOs", ["/staff-os/payroll"], ["POST/PATCH /staff-os/payroll-compliance"])
  ,item("staff-os-sensitive", "Staff OS Sensitive", "staff-app-replacement", "read", "View replacement recommendations", "staffOs", ["/staff-os/roster"], ["GET /staff-os/replacement"])
  ,item("staff-os-sensitive", "Staff OS Sensitive", "staff-app-replacement", "write", "Run replacement actions", "staffOs", ["/staff-os/roster"], ["POST /staff-os/replacement"])
  ,item("staff-os-sensitive", "Staff OS Sensitive", "staff-app-sync", "read", "View mobile sync state", "staffOs", ["/staff"], ["GET /staff-os/mobile/snapshot", "GET /staff-os/mobile/conflicts"])
  ,item("staff-os-sensitive", "Staff OS Sensitive", "staff-app-sync", "write", "Manage mobile sync", "staffOs", ["/staff"], ["POST /staff-os/mobile/sync", "POST /staff-os/mobile/conflicts"])
  ,item("staff-os-sensitive", "Staff OS Sensitive", "staff-app-approvals", "read", "View staff approvals", "staffOs", ["/staff-os/approvals"], ["GET /staff-os/approvals"])
  ,item("staff-os-sensitive", "Staff OS Sensitive", "staff-app-approvals", "write", "Manage staff approvals", "staffOs", ["/staff-os/approvals"], ["POST /staff-os/approvals"])
  ,item("staff-os-sensitive", "Staff OS Sensitive", "staff-app-roster", "read", "View roster optimization", "staffOs", ["/staff-os/roster"], ["GET /staff-os/roster-optimizer"])
  ,item("staff-os-sensitive", "Staff OS Sensitive", "staff-app-roster", "write", "Run roster optimization", "staffOs", ["/staff-os/roster"], ["POST /staff-os/roster-optimizer"])
  ,item("staff-os-sensitive", "Staff OS Sensitive", "staff-app-forecasting", "read", "View manpower forecasts", "staffOs", ["/staff-os/forecasting"], ["GET /staff-os/manpower-forecast"])
  ,item("staff-os-sensitive", "Staff OS Sensitive", "staff-app-forecasting", "write", "Manage manpower forecasts", "staffOs", ["/staff-os/forecasting"], ["POST /staff-os/manpower-forecast"])
];

export const permissionResources = [
  ...new Set([...basePermissionResources, ...staffPermissionCatalog.map((permission) => permission.resource), ...staffAppPermissionCatalog.map((permission) => permission.resource)])
].sort();

