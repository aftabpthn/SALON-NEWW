import { Component, ElementRef, EventEmitter, HostListener, Input, Output } from '@angular/core';

import { Router, RouterLink, RouterLinkActive } from '@angular/router';
import { AuthService } from '../core/services/auth.service';
import { TranslatePipe } from '../shared/pipes/translate.pipe';

@Component({
    selector: 'app-sidebar',
    imports: [RouterLink, RouterLinkActive, TranslatePipe],
    templateUrl: './app-sidebar.component.html',
    styleUrls: ['./app-sidebar.component.css'],
    host: { '[class.mobile-open]': 'mobileOpen' }
})
export class AppSidebarComponent {
  openGroup: string | null = null;
  private mobileNavOpen = false;

  @Input()
  set mobileOpen(value: boolean) {
    this.mobileNavOpen = value;
    if (!value) this.openGroup = null;
  }
  get mobileOpen(): boolean { return this.mobileNavOpen; }

  @Output() readonly navigationClosed = new EventEmitter<void>();

  readonly groups = [
    { label: 'Dashboard', icon: 'bi-grid-1x2', route: '/dashboard', exact: true, links: [
      { label: 'Dashboard', icon: 'bi-grid-1x2', route: '/dashboard', exact: true },
    ] },
    { label: 'Command Center', icon: 'bi-command', route: '/command-center', exact: false, links: [
      { label: 'Executive Overview', icon: 'bi-speedometer2', route: '/command-center', exact: true },
      { label: 'Profit Intelligence', icon: 'bi-graph-up-arrow', route: '/reports', exact: false },
      { label: 'Staff Control', icon: 'bi-person-gear', route: '/staff/control-center', exact: false },
      { label: 'Inventory Autopilot', icon: 'bi-box-seam', route: '/inventory/advanced-controls', exact: false },
      { label: 'Security Center', icon: 'bi-shield-lock', route: '/security', exact: false },
    ] },
    { label: 'Clients', icon: 'bi-people', route: '/clients', exact: false, links: [
      { label: 'Clients', icon: 'bi-people', route: '/clients', exact: false },
    ] },
    { label: 'Staff', icon: 'bi-person-badge', route: '/staff', exact: false, links: [
      { label: 'Staff', icon: 'bi-person-badge', route: '/staff', exact: false },
      { label: 'Control Center', icon: 'bi-speedometer2', route: '/staff/control-center', exact: false },
      { label: 'Availability', icon: 'bi-calendar-week', route: '/availability', exact: false },
      { label: 'Attendance Summary', icon: 'bi-calendar-check', route: '/staff/attendance-summary', exact: false },
      { label: 'Face Punch', icon: 'bi-fingerprint', route: '/staff-os/face-punch', exact: false },
      { label: 'Heatmaps', icon: 'bi-grid-3x3-gap', route: '/staff-os/heatmaps', exact: false },
      { label: 'Leave', icon: 'bi-calendar2-check', route: '/staff/leave-management', exact: false },
      { label: 'Payroll', icon: 'bi-wallet2', route: '/staff/payroll', exact: false },
      { label: 'Salary Structure', icon: 'bi-cash-coin', route: '/staff-os/salary-structure', exact: false },
      { label: 'Salary Rules', icon: 'bi-sliders', route: '/staff-os/salary-rules', exact: false },
      { label: 'Salary History', icon: 'bi-clock-history', route: '/staff-os/salary-history', exact: false },
      { label: 'Fines & Deductions', icon: 'bi-receipt-cutoff', route: '/staff-os/fines-deductions', exact: false },
      { label: 'Target Incentive', icon: 'bi-bullseye', route: '/staff-os/target-incentive', exact: false },
      { label: 'Leaderboard', icon: 'bi-trophy', route: '/staff-os/leaderboard', exact: false },
      { label: 'Training', icon: 'bi-mortarboard', route: '/staff-os/training', exact: false },
      { label: 'Tasks', icon: 'bi-list-check', route: '/staff-os/tasks', exact: false },
      { label: 'Mobile Preview', icon: 'bi-phone', route: '/staff-os/mobile-preview', exact: false },
    ] },
    { label: 'Services', icon: 'bi-scissors', route: '/services', exact: false, links: [
      { label: 'Services', icon: 'bi-scissors', route: '/services', exact: false },
    ] },
    { label: 'Appointments', icon: 'bi-calendar3', route: '/appointments', exact: false, links: [
      { label: 'Appointments', icon: 'bi-calendar3', route: '/appointments', exact: false },
    ] },
    { label: 'POS', icon: 'bi-receipt', route: '/pos', exact: false, links: [
      { label: 'POS Billing', icon: 'bi-receipt', route: '/pos', exact: true },
      { label: 'Invoices & Refunds', icon: 'bi-receipt-cutoff', route: '/pos/invoices', exact: false },
      { label: 'Held Invoices', icon: 'bi-pause-circle', route: '/pos/holds', exact: false },
      { label: 'Payment Modes', icon: 'bi-credit-card', route: '/pos/payment-modes', exact: false },
      { label: 'Tips', icon: 'bi-cash-coin', route: '/pos/tips', exact: false },
      { label: 'Cash Drawer & Reconciliation', icon: 'bi-cash-stack', route: '/pos/cash-drawer', exact: false },
      { label: 'Happy Hours', icon: 'bi-clock-history', route: '/pos/happy-hours', exact: false },
      { label: 'Enterprise POS Controls', icon: 'bi-building-gear', route: '/pos/enterprise', exact: false },
    ] },
    { label: 'Inventory', icon: 'bi-box-seam', route: '/inventory', exact: false, links: [
      { label: 'Inventory', icon: 'bi-box-seam', route: '/inventory', exact: true },
      { label: 'Service Recipes', icon: 'bi-diagram-3', route: '/inventory/recipes', exact: false },
      { label: 'Product Consume', icon: 'bi-droplet-half', route: '/inventory/backbar', exact: false },
      { label: 'Inventory Scanner', icon: 'bi-upc-scan', route: '/inventory/scanner', exact: false },
      { label: 'Stock Audit', icon: 'bi-clipboard2-check', route: '/inventory/stock-audit', exact: false },
      { label: 'Laundry Tracker', icon: 'bi-basket2', route: '/inventory/laundry', exact: false },
      { label: 'Suppliers', icon: 'bi-truck', route: '/suppliers', exact: false },
      { label: 'Purchase Orders', icon: 'bi-file-earmark-text', route: '/purchase-orders', exact: false },
      { label: 'Purchase Bill Entry', icon: 'bi-receipt-cutoff', route: '/purchase-bill-entry', exact: false },
      { label: 'Purchase Bill Register', icon: 'bi-journal-text', route: '/purchase-bill-register', exact: false },
      { label: 'AI Bill Drafts', icon: 'bi-file-earmark-check', route: '/purchase-bill-drafts', exact: false },
      { label: 'Advanced Controls', icon: 'bi-shield-check', route: '/inventory/advanced-controls', exact: false },
      { label: 'GL Reconciliation', icon: 'bi-journal-check', route: '/inventory/gl-reconciliation', exact: false },
    ] },
    { label: 'Memberships', icon: 'bi-gem', route: '/memberships', exact: false, links: [
      { label: 'Memberships', icon: 'bi-gem', route: '/memberships', exact: false },
    ] },
    { label: 'Reports', icon: 'bi-bar-chart-line', route: '/reports', exact: false, links: [
      { label: 'Reports', icon: 'bi-bar-chart-line', route: '/reports', exact: false },
      { label: 'Invoice Reports', icon: 'bi-file-earmark-bar-graph', route: '/reports/invoices', exact: false },
    ] },
    { label: 'Marketing', icon: 'bi-megaphone', route: '/marketing', exact: false, links: [
      { label: 'Marketing & Leads', icon: 'bi-megaphone', route: '/marketing', exact: true },
      { label: 'Birthdays & Anniversaries', icon: 'bi-calendar2-heart', route: '/marketing/birthdays', exact: false },
    ] },
    { label: 'Operations', icon: 'bi-geo-alt', route: '/operations', exact: false, links: [
      { label: 'Outcall & Marketplace', icon: 'bi-geo-alt', route: '/operations', exact: true },
    ] },
    { label: 'Finance', icon: 'bi-bank', route: '/finance', exact: false, links: [
      { label: 'Balance Sheet', icon: 'bi-bank', route: '/finance', exact: false },
      { label: 'Outgoing Funds', icon: 'bi-wallet2', route: '/finance/outgoing-funds', exact: false },
    ] },
    { label: 'SMS Center', icon: 'bi-chat-left-text', route: '/sms-center', exact: false, links: [
      { label: 'SMS Center', icon: 'bi-chat-left-text', route: '/sms-center', exact: false },
    ] },
    { label: 'Settings', icon: 'bi-gear', route: '/settings', exact: false, links: [
      { label: 'Settings', icon: 'bi-gear', route: '/settings', exact: false },
      { label: 'Invoice Settings', icon: 'bi-receipt-cutoff', route: '/settings/invoice', exact: false },
      { label: 'Subscription & Support', icon: 'bi-headset', route: '/saas', exact: false },
    ] },
    { label: 'SaaS Admin', icon: 'bi-cloud-check', route: '/platform/saas-admin', exact: false, links: [
      { label: 'Plans & Billing', icon: 'bi-cloud-check', route: '/platform/saas-admin', exact: false },
    ] },
    { label: 'Security', icon: 'bi-shield-lock', route: '/security', exact: false, links: [
      { label: 'Security Center', icon: 'bi-shield-lock', route: '/security', exact: false },
    ] },
  ];

  constructor(
    private readonly elementRef: ElementRef<HTMLElement>,
    private readonly auth: AuthService,
    private readonly router: Router,
  ) {}

  get visibleGroups() {
    const isPlatformAdmin = this.auth.hasRole('superadmin', 'super-admin');
    if (isPlatformAdmin) return this.groups.filter((group) => group.label === 'SaaS Admin');
    const canOpenCommandCenter = this.auth.hasRole('owner', 'admin', 'super-admin', 'manager', 'analyst')
      || this.auth.hasPermission('reports.read');
    const canManageEnterprise = this.auth.hasRole('owner', 'admin', 'manager');
    const tenantGroups = this.groups
      .filter((group) => group.label !== 'SaaS Admin')
      .map((group) => canManageEnterprise ? group : {
        ...group,
        links: group.links.filter((link) => link.route !== '/pos/enterprise'),
      });
    return canOpenCommandCenter ? tenantGroups : tenantGroups.filter((group) => group.label !== 'Command Center');
  }

  toggleGroup(label: string) { this.openGroup = this.openGroup === label ? null : label; }

  logout() {
    this.closeMenu();
    this.auth.logout().subscribe(() => this.router.navigateByUrl('/login'));
  }

  @HostListener('document:keydown.escape')
  closeMenu() {
    this.openGroup = null;
    this.navigationClosed.emit();
  }

  @HostListener('document:pointerdown', ['$event'])
  closeMenuOutside(event: PointerEvent) {
    if (!this.elementRef.nativeElement.contains(event.target as Node)) this.openGroup = null;
  }
}
