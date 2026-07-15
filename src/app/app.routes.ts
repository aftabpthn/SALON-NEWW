import { Routes } from '@angular/router';
import { permissionGuard } from './core/permission.guard';
import { ModulePageComponent } from './pages/module-page.component';

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'home' },
  { path: 'home', loadComponent: () => import('./pages/dashboard.component').then(m => m.DashboardComponent), title: 'Home', data: { preload: true, preloadPriority: 1 } },
  { path: 'dashboard', loadComponent: () => import('./pages/dashboard.component').then(m => m.DashboardComponent), title: 'Dashboard', data: { preload: true, preloadPriority: 1 } },
  { path: 'dashboard/executive', loadComponent: () => import('./pages/dashboard/executive/executive.page').then(m => m.ExecutiveDashboardPage), title: 'Executive Dashboard' },
  { path: 'apps', loadComponent: () => import('./pages/apps-launchpad.component').then(m => m.AppsLaunchpadComponent), title: 'All Apps' },
  { path: 'command-center', loadChildren: () => import('./features/command-center/command-center.routes').then(m => m.COMMAND_CENTER_ROUTES), title: 'AI Command Center' },
  { path: 'kpi-details/:module/:kpiKey', loadComponent: () => import('./pages/kpi-detail.component').then(m => m.KpiDetailComponent), title: 'KPI Details' },
  { path: 'prd', loadComponent: () => import('./pages/prd.component').then(m => m.PrdComponent), title: 'Product Requirement Document' },
  { path: 'design-system', loadComponent: () => import('./pages/design-system.component').then(m => m.DesignSystemComponent), title: 'Design System' },
  { path: 'ai/:section', loadComponent: () => import('./pages/ai-assistant.component').then(m => m.AiAssistantComponent), title: 'AI Assistant', canActivate: [permissionGuard], data: { permission: 'read:ai' } },
  { path: 'ai', loadComponent: () => import('./pages/ai-assistant.component').then(m => m.AiAssistantComponent), title: 'AI Assistant', canActivate: [permissionGuard], data: { permission: 'read:ai' } },
  { path: 'customer-care-ai', loadComponent: () => import('./pages/customer-care-ai.component').then(m => m.CustomerCareAiComponent), title: 'Customer Care AI' },
  { path: 'analytics', loadComponent: () => import('./pages/analytics-engine.component').then(m => m.AnalyticsEngineComponent), title: 'Advanced Analytics' },
  { path: 'engagement', loadComponent: () => import('./pages/engagement-command-center.component').then(m => m.EngagementCommandCenterComponent), title: 'Engagement Command Center' },
  { path: 'staff-chat', loadComponent: () => import('./pages/team-chat.component').then(m => m.TeamChatComponent), title: 'Team Chat', canActivate: [permissionGuard], data: { permission: 'read:staff' } },
  { path: 'smart-booking', loadComponent: () => import('./pages/smart-booking.component').then(m => m.SmartBookingComponent), title: 'Smart Booking System' },
  { path: 'security', loadComponent: () => import('./pages/security-layer.component').then(m => m.SecurityLayerComponent), title: 'Enterprise Security' },
  { path: 'enterprise-security-shield', loadComponent: () => import('./pages/enterprise-security-shield.component').then(m => m.EnterpriseSecurityShieldComponent), title: 'Enterprise Security Shield' },
  { path: 'two-factor', loadComponent: () => import('./pages/two-factor-setup.component').then(m => m.TwoFactorSetupComponent), title: 'Two-Factor Authentication' },
  { path: 'security-alerts', loadComponent: () => import('./pages/security-alerts.component').then(m => m.SecurityAlertsComponent), title: 'Security Alerts' },
  { path: 'security-blocklist', loadComponent: () => import('./pages/security-blocklist.component').then(m => m.SecurityBlocklistComponent), title: 'Security Blocklist' },
  { path: 'security-policy-center', loadComponent: () => import('./pages/security-policy-center.component').then(m => m.SecurityPolicyCenterComponent), title: 'Security Policy Center' },
  { path: 'permissions', loadComponent: () => import('./pages/permission-matrix.component').then(m => m.PermissionMatrixComponent), title: 'Permission Matrix' },
  { path: 'compliance', loadChildren: () => import('./features/compliance/compliance.routes').then(m => m.COMPLIANCE_ROUTES), title: 'Statutory Compliance' },
  { path: 'audit-compliance', loadComponent: () => import('./pages/compliance-audit.component').then(m => m.ComplianceAuditComponent), title: 'Audit and Compliance' },
  { path: 'quality', loadComponent: () => import('./pages/quality-center.component').then(m => m.QualityCenterComponent), title: 'Testing and Quality' },
  { path: 'deployment', loadComponent: () => import('./pages/deployment-ready.component').then(m => m.DeploymentReadyComponent), title: 'Deployment Ready' },
  { path: 'data-migration', loadComponent: () => import('./pages/data-migration.component').then(m => m.DataMigrationComponent), title: 'Data Migration Center', children: [
    { path: '', pathMatch: 'full', loadComponent: () => import('./pages/data-migration-overview.component').then(m => m.DataMigrationOverviewComponent), title: 'Data Migration Center' },
    { path: 'launch', loadComponent: () => import('./pages/data-migration-launch.component').then(m => m.DataMigrationLaunchComponent), title: 'Launch Migration' },
    { path: 'ai-mapping', loadComponent: () => import('./pages/data-migration-ai-mapping.component').then(m => m.DataMigrationAiMappingComponent), title: 'AI Mapping Studio' },
    { path: 'import-worker', loadComponent: () => import('./pages/data-migration-import-worker.component').then(m => m.DataMigrationImportWorkerComponent), title: 'Import Worker' },
    { path: 'validation', loadComponent: () => import('./pages/data-migration-validation.component').then(m => m.DataMigrationValidationComponent), title: 'Validation & Reconciliation' },
    { path: 'approval', loadComponent: () => import('./pages/data-migration-approval.component').then(m => m.DataMigrationApprovalComponent), title: 'Approval Workflow' },
    { path: 'go-live', loadComponent: () => import('./pages/data-migration-go-live.component').then(m => m.DataMigrationGoLiveComponent), title: 'Go-Live Checklist' },
    { path: 'assistant', loadComponent: () => import('./pages/data-migration-assistant.component').then(m => m.DataMigrationAssistantComponent), title: 'Migration Assistant' },
    { path: 'history', loadComponent: () => import('./pages/data-migration-history.component').then(m => m.DataMigrationHistoryComponent), title: 'History & Rollback' },
    { path: 'controlled-migration-launch', loadComponent: () => import('./pages/data-migration-section.component').then(m => m.DataMigrationSectionComponent), title: 'Controlled Migration Launch' },
    { path: 'import-blockers', loadComponent: () => import('./pages/data-migration-section.component').then(m => m.DataMigrationSectionComponent), title: 'Import Blockers' },
    { path: 'chunked-import-queue', loadComponent: () => import('./pages/data-migration-section.component').then(m => m.DataMigrationSectionComponent), title: 'Chunked Import Queue' },
    { path: 'reconciliation-sign-off', loadComponent: () => import('./pages/data-migration-section.component').then(m => m.DataMigrationSectionComponent), title: 'Reconciliation Sign-off' },
    { path: 'field-confidence-saved-profiles', loadComponent: () => import('./pages/data-migration-section.component').then(m => m.DataMigrationSectionComponent), title: 'Field Confidence & Saved Profiles' },
    { path: 'detected-modules', loadComponent: () => import('./pages/data-migration-section.component').then(m => m.DataMigrationSectionComponent), title: 'Detected Modules' },
    { path: 'old-vs-aura-checks', loadComponent: () => import('./pages/data-migration-section.component').then(m => m.DataMigrationSectionComponent), title: 'Old vs Aura Checks' },
    { path: 'expected-totals-analyzed-data', loadComponent: () => import('./pages/data-migration-section.component').then(m => m.DataMigrationSectionComponent), title: 'Expected Totals vs Analyzed Data' },
    { path: 'owner-sign-off-workflow', loadComponent: () => import('./pages/data-migration-section.component').then(m => m.DataMigrationSectionComponent), title: 'Owner Sign-off Workflow' },
    { path: 'fix-priorities', loadComponent: () => import('./pages/data-migration-section.component').then(m => m.DataMigrationSectionComponent), title: 'Fix Priorities' },
    { path: 'client-invoice-source-collisions', loadComponent: () => import('./pages/data-migration-section.component').then(m => m.DataMigrationSectionComponent), title: 'Client, Invoice & Source Collisions' },
    { path: 'sign-off-controls', loadComponent: () => import('./pages/data-migration-section.component').then(m => m.DataMigrationSectionComponent), title: 'Sign-off Controls' },
    { path: 'quality-sandbox-approval-gate', loadComponent: () => import('./pages/data-migration-section.component').then(m => m.DataMigrationSectionComponent), title: 'Quality, Sandbox & Approval Gate' },
    { path: 'ask-why-rows-failed', loadComponent: () => import('./pages/data-migration-section.component').then(m => m.DataMigrationSectionComponent), title: 'Ask Why Rows Failed' },
    { path: 'purchase-bill-history', loadComponent: () => import('./pages/data-migration-section.component').then(m => m.DataMigrationSectionComponent), title: 'Historical Purchase Bill Migration' },
    { path: 'jobs-audits-rollback-history', loadComponent: () => import('./pages/data-migration-section.component').then(m => m.DataMigrationSectionComponent), title: 'Jobs, Audits and Rollback History' }
  ] },
  { path: 'offline', loadComponent: () => import('./pages/offline-support.component').then(m => m.OfflineSupportComponent), title: 'Offline Support' },
  { path: 'offline/readiness', loadComponent: () => import('./pages/offline-readiness.component').then(m => m.OfflineReadinessComponent), title: 'Offline Readiness Score' },
  { path: 'offline/devices', loadComponent: () => import('./pages/offline-device-health.component').then(m => m.OfflineDeviceHealthComponent), title: 'Device Sync Health' },
  { path: 'offline/sync-queue', loadComponent: () => import('./pages/offline-sync-queue.component').then(m => m.OfflineSyncQueueComponent), title: 'Smart Sync Queue' },
  { path: 'offline/conflicts', loadComponent: () => import('./pages/offline-conflict-center.component').then(m => m.OfflineConflictCenterComponent), title: 'Conflict Resolution Center' },
  { path: 'offline/billing', loadComponent: () => import('./pages/offline-billing-protection.component').then(m => m.OfflineBillingProtectionComponent), title: 'Offline Billing Protection' },
  { path: 'offline/appointments', loadComponent: () => import('./pages/offline-appointment-protection.component').then(m => m.OfflineAppointmentProtectionComponent), title: 'Offline Appointment Protection' },
  { path: 'offline/risk-alerts', loadComponent: () => import('./pages/offline-risk-alerts.component').then(m => m.OfflineRiskAlertsComponent), title: 'Offline Risk Alerts' },
  { path: 'white-label', loadComponent: () => import('./pages/white-label.component').then(m => m.WhiteLabelComponent), title: 'White Label SaaS' },
  { path: 'future-features', loadComponent: () => import('./pages/future-features.component').then(m => m.FutureFeaturesComponent), title: 'Future Salon Intelligence' },
  { path: 'workflows', loadComponent: () => import('./pages/workflow-engine.component').then(m => m.WorkflowEngineComponent), title: 'Workflow Engine' },
  { path: 'finance', loadComponent: () => import('./pages/finance-engine.component').then(m => m.FinanceEngineComponent), title: 'Finance Engine' },
    { path: 'profit-intelligence', loadComponent: () => import('./pages/profit-intelligence.component').then(m => m.ProfitIntelligenceComponent), title: 'Profit Intelligence' },
  { path: 'account-master', loadComponent: () => import('./pages/account-master.component').then(m => m.AccountMasterComponent), title: 'Account Master' },
  { path: 'balance-sheet', loadComponent: () => import('./pages/balance-sheet.component').then(m => m.BalanceSheetComponent), title: 'Balance Sheet' },
  { path: 'transactions/outgoing-funds', loadComponent: () => import('./pages/outgoing-funds-entry.component').then(m => m.OutgoingFundsEntryComponent), title: 'Outgoing Funds Entry' },
  { path: 'transactions/outgoing-funds-report', loadComponent: () => import('./pages/outgoing-funds-report.component').then(m => m.OutgoingFundsReportComponent), title: 'Outgoing Funds Saved Entries' },
  { path: 'billing', loadChildren: () => import('./features/billing/billing.routes').then((m) => m.BILLING_ROUTES), title: 'Enterprise Billing' },
  { path: 'customer-360', loadComponent: () => import('./pages/customer-360.component').then(m => m.Customer360Component), title: 'Customer Intelligence' },
  { path: 'customer-360/:customerId', loadComponent: () => import('./pages/customer-360-detail.component').then(m => m.Customer360DetailComponent), title: 'Customer Profile' },
  { path: 'salon', pathMatch: 'full', redirectTo: 'salon-3d' },
  { path: 'salon-3d', loadComponent: () => import('./pages/salon-3d-website.component').then(m => m.Salon3dWebsiteComponent), title: 'AuraShine 3D Salon Website' },
  { path: 'book', loadComponent: () => import('./pages/booking-portal.component').then(m => m.BookingPortalComponent), title: 'Online Booking' },
  { path: 'book/wizard', loadComponent: () => import('./pages/booking-wizard.component').then(m => m.BookingWizardComponent), title: 'Booking Wizard' },
    { path: 'appointment-reports', loadComponent: () => import('./pages/appointment-activity.component').then(m => m.AppointmentActivityComponent), title: 'Appointment Reports' },
  { path: 'appointment-activity', loadComponent: () => import('./pages/appointment-activity.component').then(m => m.AppointmentActivityComponent), title: 'Appointment Activity' },
  { path: 'appointment-deposits', loadComponent: () => import('./pages/appointment-deposit-report.component').then(m => m.AppointmentDepositReportComponent), title: 'Appointment Deposit Report', canActivate: [permissionGuard], data: { permission: 'read:appointment_deposits' } },
  { path: 'appointments', loadComponent: () => import('./pages/appointments-enterprise.component').then(m => m.AppointmentsEnterpriseComponent), title: 'Appointment Calendar', data: { preload: true, preloadPriority: 2 } },
  { path: 'appointments-enterprise', pathMatch: 'full', redirectTo: 'appointments' },
  { path: 'scheduler', pathMatch: 'full', redirectTo: 'appointments' },
  { path: 'client-masters', loadChildren: () => import('./features/client-masters/client-masters.routes').then(m => m.CLIENT_MASTERS_ROUTES), title: 'Client Masters' },
  { path: 'clients', loadComponent: () => import('./pages/clients.component').then(m => m.ClientsComponent), title: 'Client CRM', data: { preload: true, preloadPriority: 4 } },
  { path: 'clients/reports/:reportKey', loadComponent: () => import('./pages/client-report-detail.component').then(m => m.ClientReportDetailComponent), title: 'Client Report' },
  { path: 'clients/:id', loadComponent: () => import('./pages/client-detail.component').then(m => m.ClientDetailComponent), title: 'Client Profile' },
  { path: 'pos/tips', loadComponent: () => import('./pages/pos-tips.component').then(m => m.PosTipsComponent), title: 'POS Tips' },
  { path: 'pos/payment-modes', loadComponent: () => import('./pages/payment-modes.component').then(m => m.PaymentModesComponent), title: 'Payment Modes' },
  { path: 'cash-drawer-approval/:token', loadComponent: () => import('./pages/cash-drawer-eod.component').then(m => m.CashDrawerEodComponent), title: 'Cash Drawer Approval' },
  { path: 'pos/cash-drawer-eod', loadComponent: () => import('./pages/cash-drawer-eod.component').then(m => m.CashDrawerEodComponent), title: 'Cash Drawer Tally' },
  { path: 'cash-drawer-eod', pathMatch: 'full', redirectTo: 'pos/cash-drawer-eod' },
  { path: 'pos/cash-drawer', pathMatch: 'full', redirectTo: 'pos/cash-drawer-eod' },
  { path: 'pos/invoice-activity', loadComponent: () => import('./pages/pos-invoice-activity.component').then(m => m.PosInvoiceActivityComponent), title: 'Invoice Activity' },
  { path: 'pos/invoices', loadComponent: () => import('./pages/pos-invoices.component').then(m => m.PosInvoicesComponent), title: 'POS Invoices' },
  { path: 'pos/holds', loadComponent: () => import('./pages/pos-holds.component').then(m => m.PosHoldsComponent), title: 'Held Invoices' },
  { path: 'pos', loadComponent: () => import('./pages/pos.component').then(m => m.PosComponent), title: 'POS Billing', data: { preload: true, preloadPriority: 3 } },
  {
    path: 'services',
    component: ModulePageComponent,
    title: 'Services',
    data: {
      entity: 'services',
      title: 'Services, Add-ons & Packages',
      createLabel: 'Add service',
      columns: [
        { key: 'name', label: 'Service' },
        { key: 'category', label: 'Category' },
        { key: 'price', label: 'Price', type: 'currency' },
        { key: 'durationMinutes', label: 'Duration' },
        { key: 'gstRate', label: 'GST %' },
        { key: 'status', label: 'Status', type: 'badge' }
      ],
      fields: [
        { key: 'name', label: 'Service name', required: true },
        { key: 'category', label: 'Category', required: true },
        { key: 'price', label: 'Price', type: 'number', required: true },
        { key: 'durationMinutes', label: 'Duration minutes', type: 'number', required: true },
        { key: 'processingTimeMin', label: 'Processing minutes', type: 'number', defaultValue: 0 },
        { key: 'cleanupTimeMin', label: 'Cleanup minutes', type: 'number', defaultValue: 0 },
        { key: 'bufferMinutes', label: 'Buffer minutes', type: 'number', defaultValue: 0 },
        { key: 'gstRate', label: 'GST rate', type: 'number', defaultValue: 18 },
        { key: 'assignedStaff', label: 'Assigned staff IDs JSON', type: 'json', defaultValue: [] },
        { key: 'requiredProducts', label: 'Required products JSON', type: 'json', defaultValue: [] },
        { key: 'addOns', label: 'Add-ons JSON', type: 'json', defaultValue: [] },
        { key: 'packageServices', label: 'Package service IDs JSON', type: 'json', defaultValue: [] }
      ]
    }
  },
  { path: 'inventory/products/:id/edit', loadComponent: () => import('./pages/inventory-product-edit.component').then(m => m.InventoryProductEditComponent), title: 'Edit Product' },
  { path: 'inventory/products/:id', loadComponent: () => import('./pages/product-360.component').then(m => m.Product360Component), title: 'Product 360' },
  { path: 'inventory/vendors', loadComponent: () => import('./pages/inventory-workspace-detail.component').then(m => m.InventoryWorkspaceDetailComponent), data: { workspace: 'vendors' }, title: 'Inventory Vendors' },
  { path: 'inventory/current-stock', loadComponent: () => import('./pages/inventory-workspace-detail.component').then(m => m.InventoryWorkspaceDetailComponent), data: { workspace: 'stock' }, title: 'Current Stock' },
  { path: 'inventory/procurement', loadComponent: () => import('./pages/inventory-workspace-detail.component').then(m => m.InventoryWorkspaceDetailComponent), data: { workspace: 'procurement' }, title: 'Manage Procurement' },
  { path: 'inventory/purchase-bill-drafts', loadComponent: () => import('./pages/purchase-bill-drafts.component').then(m => m.PurchaseBillDraftsComponent), title: 'AI Purchase Bill Drafts' },
  { path: 'inventory/purchase-orders/:id', loadComponent: () => import('./pages/purchase-order-detail.component').then(m => m.PurchaseOrderDetailComponent), title: 'Purchase Order Detail' },
  { path: 'inventory/purchase-orders', loadComponent: () => import('./pages/purchase-orders.component').then(m => m.PurchaseOrdersComponent), title: 'Purchase Orders' },
  { path: 'inventory/reorder', loadComponent: () => import('./pages/inventory-reorder.component').then(m => m.InventoryReorderComponent), title: 'AI Reorder Autopilot' },
  { path: 'inventory/recipes', loadComponent: () => import('./pages/inventory-recipes.component').then(m => m.InventoryRecipesComponent), title: 'Service Recipes' },
  { path: 'inventory/fifo', loadComponent: () => import('./pages/inventory-fifo.component').then(m => m.InventoryFifoComponent), title: 'Inventory FIFO' },
  { path: 'inventory/product-consume', loadComponent: () => import('./pages/product-consume.component').then(m => m.ProductConsumeComponent), title: 'Product Consume' },
  { path: 'inventory/stock-audit', loadComponent: () => import('./pages/inventory-stock-audit.component').then(m => m.InventoryStockAuditComponent), title: 'Stock Audit' },
  { path: 'inventory/financial', loadComponent: () => import('./pages/inventory-financial.component').then(m => m.InventoryFinancialComponent), title: 'Inventory Financial Brain' },
  { path: 'inventory/reports', loadComponent: () => import('./pages/inventory-reports.component').then(m => m.InventoryReportsComponent), title: 'Inventory Reports' },
  { path: 'inventory/scanner', loadComponent: () => import('./pages/inventory-scanner.component').then(m => m.InventoryScannerComponent), title: 'Inventory Scanner' },
  { path: 'inventory', loadComponent: () => import('./pages/inventory.component').then(m => m.InventoryComponent), title: 'Products & Inventory', data: { preload: true, preloadPriority: 6 } },
  { path: 'suppliers/:id', loadComponent: () => import('./pages/supplier-360.component').then(m => m.Supplier360Component), title: 'Supplier 360' },
  { path: 'suppliers', loadComponent: () => import('./pages/suppliers.component').then(m => m.SuppliersComponent), title: 'Suppliers' },
  { path: 'memberships/self-service/:token', loadComponent: () => import('./pages/membership-self-service.component').then(m => m.MembershipSelfServiceComponent), title: 'Membership Self Service' },
  { path: 'memberships/:id', loadComponent: () => import('./pages/membership-360.component').then(m => m.Membership360Component), title: 'Membership 360' },
  { path: 'memberships', loadComponent: () => import('./pages/memberships.component').then(m => m.MembershipsComponent), title: 'Memberships & Loyalty' },
  { path: 'packages', loadComponent: () => import('./pages/packages.component').then(m => m.PackagesComponent), title: 'Packages' },
  { path: 'staff/my-work', loadComponent: () => import('./pages/staff-my-work.component').then(m => m.StaffMyWorkComponent), title: 'My Staff Work', canActivate: [permissionGuard], data: { permission: 'read:appointments' } },
  { path: 'staff/connected-modules', loadComponent: () => import('./pages/staff-connected-modules.component').then(m => m.StaffConnectedModulesComponent), title: 'Staff Connected Modules', canActivate: [permissionGuard], data: { permission: 'read:staff' } },
  { path: 'staff', pathMatch: 'full', redirectTo: 'staff-os/staff-list' },
  { path: 'staff-enterprise', pathMatch: 'full', redirectTo: 'staff-os/staff-list' },
  { path: 'staff-os', loadChildren: () => import('./features/staff-os/staff-os.routes').then(m => m.STAFF_OS_ROUTES), title: 'Staff Operating System', canActivate: [permissionGuard], data: { permission: 'read:staff', preload: true, preloadPriority: 5 } },
  {
    path: 'commissions',
    component: ModulePageComponent,
    title: 'Commission Rules',
    data: {
      entity: 'commissions',
      title: 'Commission Rules',
      createLabel: 'Add commission rule',
      columns: [
        { key: 'name', label: 'Rule' },
        { key: 'staffId', label: 'Staff' },
        { key: 'type', label: 'Type' },
        { key: 'value', label: 'Value' },
        { key: 'status', label: 'Status', type: 'badge' }
      ],
      fields: [
        { key: 'name', label: 'Rule name', required: true },
        { key: 'staffId', label: 'Staff ID', required: true },
        { key: 'branchId', label: 'Branch ID' },
        { key: 'type', label: 'Type', required: true, defaultValue: 'percentage' },
        { key: 'value', label: 'Value', type: 'number', defaultValue: 0 },
        { key: 'rule', label: 'Rule JSON', type: 'json', defaultValue: {} },
        { key: 'tiers', label: 'Tiers JSON', type: 'json', defaultValue: [] },
        { key: 'metadata', label: 'Metadata JSON', type: 'json', defaultValue: {} }
      ]
    }
  },
  { path: 'marketing', loadComponent: () => import('./pages/ai-marketing-automation.component').then(m => m.AiMarketingAutomationComponent), title: 'AI Marketing Automation', data: { preload: true, preloadPriority: 8 } },
  { path: 'marketing/birthdays', loadComponent: () => import('./pages/birthday-campaign.component').then(m => m.BirthdayCampaignComponent), title: 'Birthday AI Campaigns' },
  { path: 'growth-rank-bot', loadComponent: () => import('./pages/growth-rank-bot.component').then(m => m.GrowthRankBotComponent), title: 'AI Rank Bot' },
  { path: 'whatsapp', loadComponent: () => import('./pages/whatsapp-automation.component').then(m => m.WhatsAppAutomationComponent), title: 'WhatsApp Automation' },
    { path: 'message-templates', loadComponent: () => import('./pages/message-template-studio.component').then(m => m.MessageTemplateStudioComponent), title: 'Message Templates' },
  { path: 'message-history', loadComponent: () => import('./pages/message-history-report.component').then(m => m.MessageHistoryReportComponent), title: 'Message History' },
  {
    path: 'message-logs',
    component: ModulePageComponent,
    title: 'Message Logs',
    data: {
      entity: 'messageLogs',
      title: 'Message Logs',
      createLabel: 'Add message log',
      columns: [
        { key: 'channel', label: 'Channel' },
        { key: 'recipient', label: 'Recipient' },
        { key: 'direction', label: 'Direction' },
        { key: 'status', label: 'Status', type: 'badge' },
        { key: 'createdAt', label: 'Created' }
      ],
      fields: [
        { key: 'channel', label: 'Channel', required: true, defaultValue: 'WhatsApp' },
        { key: 'recipient', label: 'Recipient', required: true },
        { key: 'message', label: 'Message', required: true },
        { key: 'branchId', label: 'Branch ID' },
        { key: 'clientId', label: 'Client ID' },
        { key: 'campaignId', label: 'Campaign ID' },
        { key: 'direction', label: 'Direction', defaultValue: 'outbound' },
        { key: 'payload', label: 'Payload JSON', type: 'json', defaultValue: {} },
        { key: 'providerResponse', label: 'Provider response JSON', type: 'json', defaultValue: {} }
      ]
    }
  },
  { path: 'business-details', loadComponent: () => import('./pages/business-details.component').then(m => m.BusinessDetailsComponent), title: 'Business Details' },
  { path: 'reports/account-ledger', loadComponent: () => import('./pages/account-ledger.component').then(m => m.AccountLedgerComponent), title: 'Account Ledger' },
  { path: 'reports/commission-preview', loadComponent: () => import('./pages/commission-preview-report.component').then(m => m.CommissionPreviewReportComponent), title: 'Commission Preview' },
    { path: 'reports/appointment-detail-list', loadComponent: () => import('./pages/appointment-detail-list-report.component').then(m => m.AppointmentDetailListReportComponent), title: 'Detail Appointment List' },
  { path: 'reports/staff-appointments', loadComponent: () => import('./pages/staff-appointments-report.component').then(m => m.StaffAppointmentsReportComponent), title: 'Appointment Booked By Staff' },
  { path: 'reports/staff-sales', loadComponent: () => import('./pages/staff-sales-report.component').then(m => m.StaffSalesReportComponent), title: 'Staff Sales Report' },
  { path: 'reports/invoices', loadComponent: () => import('./pages/invoice-reports.component').then(m => m.InvoiceReportsComponent), title: 'Invoice Reports Command Center' },
  { path: 'reports/invoices/:reportId', loadComponent: () => import('./pages/invoice-reports.component').then(m => m.InvoiceReportsComponent), title: 'Invoice Report Detail' },
    { path: 'reports/pending-packages', loadComponent: () => import('./pages/pending-packages-report.component').then(m => m.PendingPackagesReportComponent), title: 'Pending Packages' },
  { path: 'reports/expired-packages', loadComponent: () => import('./pages/expired-packages-report.component').then(m => m.ExpiredPackagesReportComponent), title: 'Expired Packages' },
  { path: 'reports/completed-packages', loadComponent: () => import('./pages/completed-packages-report.component').then(m => m.CompletedPackagesReportComponent), title: 'Completed Packages' },
  { path: 'reports/inward-revenue', loadComponent: () => import('./pages/inward-revenue-report.component').then(m => m.InwardRevenueReportComponent), title: 'Inward Revenue Report' },
    { path: 'reports/financial-summary', loadComponent: () => import('./pages/financial-summary-report.component').then(m => m.FinancialSummaryReportComponent), title: 'Financial Summary' },
  { path: 'reports', loadComponent: () => import('./pages/reports.component').then(m => m.ReportsComponent), title: 'Reports & Analytics', data: { preload: true, preloadPriority: 7 } },
  { path: 'reports/enterprise', loadComponent: () => import('./pages/reports-enterprise/reports-enterprise.component').then(m => m.ReportsEnterpriseComponent), title: 'Enterprise Reports' },
    { path: 'locations/sharing', loadComponent: () => import('./pages/location-sharing-command-center.component').then(m => m.LocationSharingCommandCenterComponent), title: 'Location Sharing Command Center' },
  { path: 'saas', loadComponent: () => import('./pages/saas-onboarding.component').then(m => m.SaasOnboardingComponent), title: 'SaaS Control' },
  { path: 'super-admin', loadComponent: () => import('./pages/super-admin.component').then(m => m.SuperAdminComponent), title: 'SaaS Super Admin' },
  {
    path: 'branches',
    component: ModulePageComponent,
    title: 'Multi-Branch',
    data: {
      entity: 'branches',
      title: 'Multi-Branch Operations',
      createLabel: 'Add branch',
      columns: [
        { key: 'name', label: 'Branch' },
        { key: 'city', label: 'City' },
        { key: 'phone', label: 'Phone' },
        { key: 'gstin', label: 'GSTIN' },
        { key: 'status', label: 'Status', type: 'badge' }
      ],
      fields: [
        { key: 'name', label: 'Branch name', required: true },
        { key: 'city', label: 'City', required: true },
        { key: 'address', label: 'Address' },
        { key: 'phone', label: 'Phone' },
        { key: 'gstin', label: 'GSTIN' },
        { key: 'timezone', label: 'Timezone', defaultValue: 'Asia/Kolkata' }
      ]
    }
  },
    { path: 'setting/calendar', loadComponent: () => import('./pages/calendar-settings.component').then(m => m.CalendarSettingsComponent), title: 'Calendar Settings' },
  { path: 'settings/calendar', loadComponent: () => import('./pages/calendar-settings.component').then(m => m.CalendarSettingsComponent), title: 'Calendar Settings' },
  { path: 'settings/taxes', loadComponent: () => import('./pages/tax-settings.component').then(m => m.TaxSettingsComponent), title: 'Tax Settings' },
  { path: 'settings/clients/custom-form', loadComponent: () => import('./pages/client-custom-form-settings.component').then(m => m.ClientCustomFormSettingsComponent), title: 'Clients - Custom Form' },
  { path: 'settings/marketplace', loadComponent: () => import('./pages/marketplace-settings.component').then(m => m.MarketplaceSettingsComponent), title: 'Marketplace Settings' },
  {
    path: 'settings',
    component: ModulePageComponent,
    title: 'Settings',
    data: {
      entity: 'settings',
      title: 'Settings',
      createLabel: 'Add setting',
      columns: [
        { key: 'key', label: 'Key' },
        { key: 'scope', label: 'Scope' },
        { key: 'value', label: 'Value', type: 'json' }
      ],
      fields: [
        { key: 'key', label: 'Key', required: true },
        { key: 'scope', label: 'Scope', defaultValue: 'global' },
        { key: 'value', label: 'Value JSON', type: 'json', defaultValue: {} }
      ]
    }
  },
  {
    path: 'audit-logs',
    component: ModulePageComponent,
    title: 'Audit Logs',
    data: {
      entity: 'auditLogs',
      title: 'Audit Logs',
      createLabel: 'Add audit event',
      columns: [
        { key: 'action', label: 'Action' },
        { key: 'entityType', label: 'Entity' },
        { key: 'entityId', label: 'Entity ID' },
        { key: 'severity', label: 'Severity', type: 'badge' },
        { key: 'createdAt', label: 'Created' }
      ],
      fields: [
        { key: 'action', label: 'Action', required: true },
        { key: 'entityType', label: 'Entity type' },
        { key: 'entityId', label: 'Entity ID' },
        { key: 'branchId', label: 'Branch ID' },
        { key: 'actorUserId', label: 'Actor user ID' },
        { key: 'severity', label: 'Severity', defaultValue: 'info' },
        { key: 'details', label: 'Details JSON', type: 'json', defaultValue: {} }
      ]
    }
  },
  {
    path: 'site-logs',
    loadComponent: () => import('./pages/site-logs-command-center.component').then(m => m.SiteLogsCommandCenterComponent),
    title: 'Site Logs'
  },
  {
    path: 'voice-receptionist', loadComponent: () => import('./pages/future-workflow.component').then(m => m.FutureWorkflowComponent), title: 'AI Voice Receptionist', data: { workflowType: 'voice-receptionist', title: 'AI Voice Receptionist', prompt: 'Classify this client call, suggest the next booking action, and prepare human handoff if needed.', primaryEndpoint: 'voice-receptionist/calls', commandCenterRoute: '/command-center/voice-ai-receptionist', recordLabel: 'Voice calls' }
  },
  {
    path: 'queue-system', component: ModulePageComponent, title: 'Smart Queue System', data: { entity: 'queueDisplays', title: 'Smart Queue TV Displays', createLabel: 'Add queue display', columns: [{ key: 'name', label: 'Display' }, { key: 'displayCode', label: 'Code' }, { key: 'branchId', label: 'Branch' }, { key: 'status', label: 'Status', type: 'badge' }], fields: [{ key: 'branchId', label: 'Branch ID', required: true }, { key: 'name', label: 'Display name', required: true }, { key: 'displayCode', label: 'Display code' }, { key: 'layout', label: 'Layout JSON', type: 'json', defaultValue: { mode: 'tv' } }, { key: 'filters', label: 'Filters JSON', type: 'json', defaultValue: {} }, { key: 'theme', label: 'Theme JSON', type: 'json', defaultValue: {} }] }
  },
  {
    path: 'dynamic-pricing', loadComponent: () => import('./pages/future-workflow.component').then(m => m.FutureWorkflowComponent), title: 'Dynamic Pricing', data: { workflowType: 'dynamic-pricing', title: 'Dynamic Pricing Engine', prompt: 'Find safe dynamic pricing rules from live sales, services and appointment demand.', primaryEndpoint: 'dynamicPricingRules', commandCenterRoute: '/future-features', recordLabel: 'Pricing rules' }
  },
  {
    path: 'discount-rules', loadComponent: () => import('./pages/discount-rules/happy-hours-workspace.component').then(m => m.HappyHoursWorkspaceComponent), title: 'Happy Hours'
  },
  {
    path: 'discount-rules/rules', loadComponent: () => import('./pages/discount-rules/rule-list.component').then(m => m.RuleListComponent), title: 'Discount Rules'
  },
  {
    path: 'discount-rules/control-tower', loadComponent: () => import('./pages/discount-rules/happy-hours-control-tower.component').then(m => m.HappyHoursControlTowerComponent), title: 'Happy Hours Control Tower'
  },
  {
    path: 'discount-rules/promotion-calendar', loadComponent: () => import('./pages/discount-rules/promotion-calendar.component').then(m => m.PromotionCalendarComponent), title: 'Promotion Calendar'
  },
  {
    path: 'discount-rules/coupon-engine', loadComponent: () => import('./pages/discount-rules/coupon-engine.component').then(m => m.CouponEngineComponent), title: 'Coupon Engine'
  },
  {
    path: 'discount-rules/client-segments', loadComponent: () => import('./pages/discount-rules/client-segments.component').then(m => m.HappyHoursClientSegmentsComponent), title: 'Client Segment Targeting'
  },
    {
    path: 'discount-rules/client-discount-brain', loadComponent: () => import('./pages/discount-rules/client-discount-brain.component').then(m => m.ClientDiscountBrainComponent), title: 'Client Discount Brain'
  },
  {
    path: 'discount-rules/staff-incentives', loadComponent: () => import('./pages/discount-rules/staff-incentives.component').then(m => m.HappyHoursStaffIncentivesComponent), title: 'Staff Incentive Link'
  },
    {
    path: 'discount-rules/staff-aware-offers', loadComponent: () => import('./pages/discount-rules/staff-aware-offers.component').then(m => m.StaffAwareOffersComponent), title: 'Staff-Aware Offers'
  },
  {
    path: 'discount-rules/inventory-aware-offers', loadComponent: () => import('./pages/discount-rules/inventory-aware-offers.component').then(m => m.InventoryAwareOffersComponent), title: 'Inventory-Aware Offers'
  },
  {
    path: 'discount-rules/weather-event-offers', loadComponent: () => import('./pages/discount-rules/weather-event-offers.component').then(m => m.WeatherEventOffersComponent), title: 'Weather/Event-Aware Offers'
  },
  {
    path: 'discount-rules/market-aware-offers', loadComponent: () => import('./pages/discount-rules/market-aware-offers.component').then(m => m.MarketAwareOffersComponent), title: 'Market-Aware Offers'
  },
  {
    path: 'discount-rules/channel-aware-offers', loadComponent: () => import('./pages/discount-rules/channel-aware-offers.component').then(m => m.ChannelAwareOffersComponent), title: 'Channel-Aware Offers'
  },
  {
    path: 'discount-rules/lead-time-offers', loadComponent: () => import('./pages/discount-rules/lead-time-offers.component').then(m => m.LeadTimeOffersComponent), title: 'Lead-Time Offers'
  },
  {
    path: 'discount-rules/bundle-aware-offers', loadComponent: () => import('./pages/discount-rules/bundle-aware-offers.component').then(m => m.BundleAwareOffersComponent), title: 'Bundle-Aware Offers'
  },
  {
    path: 'discount-rules/member-wallet-offers', loadComponent: () => import('./pages/discount-rules/member-wallet-offers.component').then(m => m.MemberWalletOffersComponent), title: 'Member / Wallet Offers'
  },
  {
    path: 'discount-rules/no-show-risk-offers', loadComponent: () => import('./pages/discount-rules/no-show-risk-offers.component').then(m => m.NoShowRiskOffersComponent), title: 'No-show Risk Offers'
  },
  {
    path: 'discount-rules/offer-lifecycle', loadComponent: () => import('./pages/discount-rules/offer-lifecycle.component').then(m => m.OfferLifecycleComponent), title: 'Offer Lifecycle OS'
  },
  {
    path: 'discount-rules/offer-roi-score', loadComponent: () => import('./pages/discount-rules/offer-roi-score.component').then(m => m.OfferRoiScoreComponent), title: 'Offer ROI Score'
  },
    {
    path: 'discount-rules/elasticity-profit-pricing', loadComponent: () => import('./pages/discount-rules/elasticity-profit-pricing.component').then(m => m.ElasticityProfitPricingComponent), title: 'Elasticity + Profit Pricing'
  },
  {
    path: 'discount-rules/fraud-guard', loadComponent: () => import('./pages/discount-rules/fraud-guard.component').then(m => m.HappyHoursFraudGuardComponent), title: 'Abuse / Fraud Guard'
  },
  {
    path: 'discount-rules/conflicts', loadComponent: () => import('./pages/discount-rules/rule-conflict-detector.component').then(m => m.RuleConflictDetectorComponent), title: 'Rule Conflict Detector'
  },
  {
    path: 'discount-rules/auto-sunset', loadComponent: () => import('./pages/discount-rules/offer-auto-sunset.component').then(m => m.OfferAutoSunsetComponent), title: 'Offer Auto-Sunset'
  },
  {
    path: 'discount-rules/branch-leaderboard', loadComponent: () => import('./pages/discount-rules/branch-offer-leaderboard.component').then(m => m.BranchOfferLeaderboardComponent), title: 'Branch Offer Leaderboard'
  },
  {
    path: 'discount-rules/client-return-tracker', loadComponent: () => import('./pages/discount-rules/client-return-tracker.component').then(m => m.ClientReturnTrackerComponent), title: 'Client Return Tracker'
  },
  {
    path: 'discount-rules/offer-health-score', loadComponent: () => import('./pages/discount-rules/offer-health-score.component').then(m => m.OfferHealthScoreComponent), title: 'Offer Health Score'
  },
  {
    path: 'discount-rules/campaign-audience-builder', loadComponent: () => import('./pages/discount-rules/campaign-audience-builder.component').then(m => m.CampaignAudienceBuilderComponent), title: 'Campaign Audience Builder'
  },
  {
    path: 'discount-rules/new', loadComponent: () => import('./pages/discount-rules/rule-builder.component').then(m => m.RuleBuilderComponent), title: 'New Discount Rule'
  },
  {
    path: 'discount-rules/approvals', loadComponent: () => import('./pages/discount-rules/approvals.component').then(m => m.DiscountRuleApprovalsComponent), title: 'Discount Rule Approvals'
  },
  {
    path: 'discount-rules/audit-log', loadComponent: () => import('./pages/discount-rules/audit-log.component').then(m => m.DiscountAuditLogComponent), title: 'Discount Audit Log'
  },
  {
    path: 'pricing/incrementality', loadComponent: () => import('./pages/pricing/incrementality.component').then(m => m.PricingIncrementalityComponent), title: 'Causal Incrementality'
  },
  {
    path: 'pricing/market-intelligence', loadComponent: () => import('./pages/pricing/market-intelligence.component').then(m => m.MarketIntelligenceComponent), title: 'Competitive Price Intelligence'
  },
  {
    path: 'pricing/level6-readiness', loadComponent: () => import('./pages/pricing/level6-readiness.component').then(m => m.Level6ReadinessComponent), title: 'Level 6 Readiness Center'
  },
  {
    path: 'discount-rules/cross-branch-analytics', loadComponent: () => import('./pages/discount-rules/cross-branch-analytics.component').then(m => m.CrossBranchAnalyticsComponent), title: 'Cross-Branch Discount Analytics'
  },
  {
    path: 'discount-rules/simulations', loadComponent: () => import('./pages/discount-rules/simulation-sandbox.component').then(m => m.DiscountSimulationSandboxComponent), title: 'Discount Simulation Sandbox'
  },
  {
    path: 'discount-rules/anomalies', loadComponent: () => import('./pages/discount-rules/anomaly-inbox.component').then(m => m.DiscountAnomalyInboxComponent), title: 'Discount Anomaly Inbox'
  },
  {
    path: 'discount-rules/white-label-rules', loadComponent: () => import('./pages/discount-rules/white-label-rules.component').then(m => m.WhiteLabelRulesComponent), title: 'White-Label Discount Rules'
  },
  {
    path: 'discount-rules/:id', loadComponent: () => import('./pages/discount-rules/rule-builder.component').then(m => m.RuleBuilderComponent), title: 'Edit Discount Rule'
  },
  {
    path: 'growth-advisor', component: ModulePageComponent, title: 'AI Growth Advisor', data: { entity: 'growthAdvisorTasks', title: 'AI Growth Advisor Tasks', createLabel: 'Add growth task', columns: [{ key: 'title', label: 'Task' }, { key: 'priority', label: 'Priority', type: 'badge' }, { key: 'dueDate', label: 'Due' }, { key: 'status', label: 'Status', type: 'badge' }], fields: [{ key: 'title', label: 'Title', required: true }, { key: 'priority', label: 'Priority', required: true, defaultValue: 'medium' }, { key: 'branchId', label: 'Branch ID' }, { key: 'dueDate', label: 'Due date' }, { key: 'signals', label: 'Signals JSON', type: 'json', defaultValue: {} }, { key: 'recommendations', label: 'Recommendations JSON', type: 'json', defaultValue: [] }] }
  },
  {
    path: 'franchise', loadComponent: () => import('./pages/future-workflow.component').then(m => m.FutureWorkflowComponent), title: 'Franchise System', data: { workflowType: 'franchise-os', title: 'Franchise OS', prompt: 'Create a franchise operator summary with royalty, compliance and branch action signals.', primaryEndpoint: 'franchise-os/units', commandCenterRoute: '/command-center/franchise-os', recordLabel: 'Franchise units' }
  },
  {
    path: 'training-academy', component: ModulePageComponent, title: 'Training Academy', data: { entity: 'trainingLessons', title: 'Training Academy', createLabel: 'Add lesson', columns: [{ key: 'title', label: 'Lesson' }, { key: 'category', label: 'Category' }, { key: 'level', label: 'Level' }, { key: 'status', label: 'Status', type: 'badge' }], fields: [{ key: 'title', label: 'Lesson title', required: true }, { key: 'category', label: 'Category', required: true }, { key: 'level', label: 'Level', defaultValue: 'beginner' }, { key: 'durationMinutes', label: 'Duration', type: 'number' }, { key: 'content', label: 'Content JSON', type: 'json', defaultValue: {} }, { key: 'quiz', label: 'Quiz JSON', type: 'json', defaultValue: {} }] }
  },
  {
    path: 'image-analysis', component: ModulePageComponent, title: 'AI Image Analysis', data: { entity: 'imageAnalyses', title: 'AI Beauty Image Analysis', createLabel: 'Add analysis', columns: [{ key: 'clientId', label: 'Client' }, { key: 'analysisType', label: 'Type' }, { key: 'status', label: 'Status', type: 'badge' }], fields: [{ key: 'clientId', label: 'Client ID', required: true }, { key: 'analysisType', label: 'Analysis type', required: true, defaultValue: 'skin' }, { key: 'branchId', label: 'Branch ID' }, { key: 'imageUri', label: 'Secure image URI' }, { key: 'findings', label: 'Findings JSON', type: 'json', defaultValue: {} }, { key: 'recommendations', label: 'Recommendations JSON', type: 'json', defaultValue: [] }, { key: 'consent', label: 'Consent JSON', type: 'json', defaultValue: {} }] }
  },
  { path: 'reputation', loadChildren: () => import('./features/reputation/reputation.routes').then(m => m.REPUTATION_ROUTES), title: 'Reputation Management' },
  { path: 'marketplace-integrations', loadComponent: () => import('./pages/marketplace-integrations.component').then(m => m.MarketplaceIntegrationsComponent), title: 'Marketplace Integrations' },
  {
    path: 'gamification', component: ModulePageComponent, title: 'Gamification', data: { entity: 'gamificationEvents', title: 'Gamification System', createLabel: 'Add gamification event', columns: [{ key: 'subjectType', label: 'Subject' }, { key: 'subjectId', label: 'ID' }, { key: 'eventType', label: 'Event' }, { key: 'createdAt', label: 'Created' }], fields: [{ key: 'subjectType', label: 'Subject type', required: true, defaultValue: 'staff' }, { key: 'subjectId', label: 'Subject ID', required: true }, { key: 'eventType', label: 'Event type', required: true }, { key: 'branchId', label: 'Branch ID' }, { key: 'points', label: 'Points JSON', type: 'json', defaultValue: {} }, { key: 'badges', label: 'Badges JSON', type: 'json', defaultValue: [] }, { key: 'metadata', label: 'Metadata JSON', type: 'json', defaultValue: {} }] }
  },
  {
    path: 'fraud-detection', component: ModulePageComponent, title: 'AI Fraud Detection', data: { entity: 'fraudAlerts', title: 'AI Fraud Detection', createLabel: 'Add fraud alert', columns: [{ key: 'alertType', label: 'Type' }, { key: 'severity', label: 'Severity', type: 'badge' }, { key: 'riskScore', label: 'Risk' }, { key: 'status', label: 'Status', type: 'badge' }], fields: [{ key: 'alertType', label: 'Alert type', required: true }, { key: 'severity', label: 'Severity', required: true, defaultValue: 'medium' }, { key: 'branchId', label: 'Branch ID' }, { key: 'riskScore', label: 'Risk score', type: 'number' }, { key: 'signals', label: 'Signals JSON', type: 'json', defaultValue: {} }, { key: 'evidence', label: 'Evidence JSON', type: 'json', defaultValue: [] }, { key: 'resolution', label: 'Resolution JSON', type: 'json', defaultValue: {} }] }
  },
  {
    path: 'notification-center', component: ModulePageComponent, title: 'Notification Center', data: { entity: 'notifications', title: 'Enterprise Notification Center', createLabel: 'Add notification', variant: 'zenoti', columns: [{ key: 'channel', label: 'Channel' }, { key: 'type', label: 'Type' }, { key: 'status', label: 'Status', type: 'badge' }], fields: [{ key: 'channel', label: 'Channel', required: true }, { key: 'message', label: 'Message', required: true }, { key: 'clientId', label: 'Client ID' }, { key: 'type', label: 'Type' }, { key: 'status', label: 'Status', defaultValue: 'queued' }] }
  },
  {
    path: 'smart-forms', loadComponent: () => import('./pages/future-workflow.component').then(m => m.FutureWorkflowComponent), title: 'Smart Forms', data: { workflowType: 'smart-forms', title: 'Smart Forms Builder', prompt: 'Design smart intake and consent forms for the current service mix and appointment flow.', primaryEndpoint: 'smartForms', secondaryEndpoint: 'formResponses', commandCenterRoute: '/future-features', recordLabel: 'Smart forms' }
  },
  {
    path: 'recommendation-engine', component: ModulePageComponent, title: 'AI Recommendation Engine', data: { entity: 'recommendationEvents', title: 'AI Recommendation Engine', createLabel: 'Add recommendation', columns: [{ key: 'clientId', label: 'Client' }, { key: 'type', label: 'Type' }, { key: 'status', label: 'Status', type: 'badge' }], fields: [{ key: 'clientId', label: 'Client ID', required: true }, { key: 'type', label: 'Type', required: true }, { key: 'branchId', label: 'Branch ID' }, { key: 'input', label: 'Input JSON', type: 'json', defaultValue: {} }, { key: 'recommendations', label: 'Recommendations JSON', type: 'json', defaultValue: [] }, { key: 'feedback', label: 'Feedback JSON', type: 'json', defaultValue: {} }] }
  },
  {
    path: 'data-warehouse', component: ModulePageComponent, title: 'Data Warehouse', data: { entity: 'warehouseSnapshots', title: 'Data Warehouse Layer', createLabel: 'Add snapshot', columns: [{ key: 'snapshotType', label: 'Type' }, { key: 'periodStart', label: 'Start' }, { key: 'periodEnd', label: 'End' }, { key: 'status', label: 'Status', type: 'badge' }], fields: [{ key: 'snapshotType', label: 'Snapshot type', required: true }, { key: 'periodStart', label: 'Period start', required: true }, { key: 'periodEnd', label: 'Period end', required: true }, { key: 'branchId', label: 'Branch ID' }, { key: 'dimensions', label: 'Dimensions JSON', type: 'json', defaultValue: {} }, { key: 'facts', label: 'Facts JSON', type: 'json', defaultValue: {} }, { key: 'aggregates', label: 'Aggregates JSON', type: 'json', defaultValue: {} }] }
  },
  {
    path: 'kpi-monitoring', component: ModulePageComponent, title: 'KPI Monitoring', data: { entity: 'kpiMonitors', title: 'KPI Monitoring', createLabel: 'Add KPI monitor', columns: [{ key: 'name', label: 'KPI' }, { key: 'metric', label: 'Metric' }, { key: 'status', label: 'Status', type: 'badge' }], fields: [{ key: 'name', label: 'KPI name', required: true }, { key: 'metric', label: 'Metric', required: true }, { key: 'branchId', label: 'Branch ID' }, { key: 'target', label: 'Target JSON', type: 'json', defaultValue: {} }, { key: 'current', label: 'Current JSON', type: 'json', defaultValue: {} }, { key: 'alerts', label: 'Alerts JSON', type: 'json', defaultValue: [] }] }
  },
  {
    path: 'appointment-optimization', component: ModulePageComponent, title: 'Appointment Optimization', data: { entity: 'appointmentOptimizations', title: 'Smart Appointment Optimization', createLabel: 'Add optimization run', columns: [{ key: 'branchId', label: 'Branch' }, { key: 'optimizationType', label: 'Type' }, { key: 'score', label: 'Score' }, { key: 'status', label: 'Status', type: 'badge' }], fields: [{ key: 'branchId', label: 'Branch ID', required: true }, { key: 'optimizationType', label: 'Optimization type', required: true }, { key: 'input', label: 'Input JSON', type: 'json', defaultValue: {} }, { key: 'recommendations', label: 'Recommendations JSON', type: 'json', defaultValue: [] }, { key: 'appliedChanges', label: 'Applied changes JSON', type: 'json', defaultValue: [] }, { key: 'score', label: 'Score', type: 'number' }] }
  },
  {
    path: 'developer-api', component: ModulePageComponent, title: 'API Platform', data: { entity: 'apiKeys', title: 'Developer API Platform', createLabel: 'Add API key record', columns: [{ key: 'name', label: 'Key' }, { key: 'keyPrefix', label: 'Prefix' }, { key: 'status', label: 'Status', type: 'badge' }, { key: 'lastUsedAt', label: 'Last used' }], fields: [{ key: 'name', label: 'Name', required: true }, { key: 'keyHash', label: 'Key hash', required: true }, { key: 'keyPrefix', label: 'Key prefix' }, { key: 'scopes', label: 'Scopes JSON', type: 'json', defaultValue: [] }, { key: 'rateLimits', label: 'Rate limits JSON', type: 'json', defaultValue: {} }, { key: 'metadata', label: 'Metadata JSON', type: 'json', defaultValue: {} }] }
  },
  {
    path: 'webhooks', component: ModulePageComponent, title: 'Webhooks', data: { entity: 'webhooks', title: 'Webhook Subscriptions', createLabel: 'Add webhook', columns: [{ key: 'name', label: 'Webhook' }, { key: 'url', label: 'URL' }, { key: 'status', label: 'Status', type: 'badge' }], fields: [{ key: 'name', label: 'Webhook name', required: true }, { key: 'url', label: 'URL', required: true }, { key: 'events', label: 'Events JSON', type: 'json', defaultValue: [] }, { key: 'headers', label: 'Headers JSON', type: 'json', defaultValue: {} }, { key: 'retryPolicy', label: 'Retry policy JSON', type: 'json', defaultValue: {} }] }
  },
  {
    path: 'predictive-forecasting', component: ModulePageComponent, title: 'Predictive Forecasting', data: { entity: 'forecastingModels', title: 'AI Predictive Forecasting', createLabel: 'Add forecast model', columns: [{ key: 'name', label: 'Model' }, { key: 'modelType', label: 'Type' }, { key: 'horizonDays', label: 'Horizon' }, { key: 'status', label: 'Status', type: 'badge' }], fields: [{ key: 'name', label: 'Model name', required: true }, { key: 'modelType', label: 'Model type', required: true }, { key: 'branchId', label: 'Branch ID' }, { key: 'horizonDays', label: 'Horizon days', type: 'number', defaultValue: 30 }, { key: 'features', label: 'Features JSON', type: 'json', defaultValue: {} }, { key: 'metrics', label: 'Metrics JSON', type: 'json', defaultValue: {} }, { key: 'predictions', label: 'Predictions JSON', type: 'json', defaultValue: [] }] }
  },
  {
    path: 'knowledge-base', component: ModulePageComponent, title: 'AI Knowledge Base', data: { entity: 'knowledgeBaseArticles', title: 'AI Knowledge Base', createLabel: 'Add article', columns: [{ key: 'title', label: 'Article' }, { key: 'audience', label: 'Audience' }, { key: 'category', label: 'Category' }, { key: 'status', label: 'Status', type: 'badge' }], fields: [{ key: 'title', label: 'Title', required: true }, { key: 'audience', label: 'Audience', required: true }, { key: 'category', label: 'Category' }, { key: 'body', label: 'Body' }, { key: 'tags', label: 'Tags JSON', type: 'json', defaultValue: [] }, { key: 'contentBlocks', label: 'Content blocks JSON', type: 'json', defaultValue: [] }] }
  },
  {
    path: 'plugins', component: ModulePageComponent, title: 'Plugin Ecosystem', data: { entity: 'pluginManifests', title: 'Plugin Ecosystem', createLabel: 'Add plugin', columns: [{ key: 'name', label: 'Plugin' }, { key: 'version', label: 'Version' }, { key: 'vendor', label: 'Vendor' }, { key: 'status', label: 'Status', type: 'badge' }], fields: [{ key: 'name', label: 'Plugin name', required: true }, { key: 'version', label: 'Version', required: true }, { key: 'vendor', label: 'Vendor' }, { key: 'permissions', label: 'Permissions JSON', type: 'json', defaultValue: [] }, { key: 'extensionPoints', label: 'Extension points JSON', type: 'json', defaultValue: [] }, { key: 'settings', label: 'Settings JSON', type: 'json', defaultValue: {} }] }
  },
  {
    path: 'app-marketplace', loadComponent: () => import('./pages/future-workflow.component').then(m => m.FutureWorkflowComponent), title: 'App Marketplace', data: { workflowType: 'marketplace', title: 'App Marketplace', prompt: 'Recommend marketplace connectors and plugins that should be installed for this tenant.', primaryEndpoint: 'marketplace/connectors', secondaryEndpoint: 'marketplace/plugins', commandCenterRoute: '/command-center/marketplace-platform', recordLabel: 'Marketplace connectors' }
  },
  {
    path: 'localization', component: ModulePageComponent, title: 'Multi-Country', data: { entity: 'localizationProfiles', title: 'Multi-Country Localization', createLabel: 'Add localization profile', columns: [{ key: 'name', label: 'Profile' }, { key: 'primaryCountry', label: 'Primary country' }, { key: 'status', label: 'Status', type: 'badge' }], fields: [{ key: 'name', label: 'Profile name', required: true }, { key: 'primaryCountry', label: 'Primary country', required: true }, { key: 'countries', label: 'Countries JSON', type: 'json', defaultValue: [] }, { key: 'currencies', label: 'Currencies JSON', type: 'json', defaultValue: [] }, { key: 'taxRules', label: 'Tax rules JSON', type: 'json', defaultValue: {} }, { key: 'translations', label: 'Translations JSON', type: 'json', defaultValue: {} }] }
  },
  { path: '', loadChildren: () => import('./features/merged-ops/merged-ops.routes').then(m => m.MERGED_OPS_ROUTES) },
  { path: '**', redirectTo: 'home' }
];



