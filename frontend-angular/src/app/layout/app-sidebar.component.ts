import { Component } from '@angular/core';
import { NgFor } from '@angular/common';
import { RouterLink, RouterLinkActive } from '@angular/router';

@Component({
  selector: 'app-sidebar',
  standalone: true,
  imports: [NgFor, RouterLink, RouterLinkActive],
  templateUrl: './app-sidebar.component.html',
  styleUrls: ['./app-sidebar.component.css'],
})
export class AppSidebarComponent {
  readonly groups = [
    { label: 'Dashboard', icon: 'bi-grid-1x2', route: '/dashboard', exact: true, links: [
      { label: 'Dashboard', icon: 'bi-grid-1x2', route: '/dashboard', exact: true },
    ] },
    { label: 'Clients', icon: 'bi-people', route: '/clients', exact: false, links: [
      { label: 'Clients', icon: 'bi-people', route: '/clients', exact: false },
    ] },
    { label: 'Staff', icon: 'bi-person-badge', route: '/staff', exact: false, links: [
      { label: 'Staff', icon: 'bi-person-badge', route: '/staff', exact: false },
      { label: 'Availability', icon: 'bi-calendar-week', route: '/availability', exact: false },
    ] },
    { label: 'Services', icon: 'bi-scissors', route: '/services', exact: false, links: [
      { label: 'Services', icon: 'bi-scissors', route: '/services', exact: false },
    ] },
    { label: 'Appointments', icon: 'bi-calendar3', route: '/appointments', exact: false, links: [
      { label: 'Appointments', icon: 'bi-calendar3', route: '/appointments', exact: false },
    ] },
    { label: 'POS', icon: 'bi-receipt', route: '/pos', exact: false, links: [
      { label: 'POS Billing', icon: 'bi-receipt', route: '/pos', exact: true },
      { label: 'POS Sales', icon: 'bi-cart-check', route: '/pos/sales', exact: false },
    ] },
    { label: 'Inventory', icon: 'bi-box-seam', route: '/inventory', exact: false, links: [
      { label: 'Inventory', icon: 'bi-box-seam', route: '/inventory', exact: false },
    ] },
    { label: 'Memberships', icon: 'bi-gem', route: '/memberships', exact: false, links: [
      { label: 'Memberships', icon: 'bi-gem', route: '/memberships', exact: false },
    ] },
    { label: 'Reports', icon: 'bi-bar-chart-line', route: '/reports', exact: false, links: [
      { label: 'Reports', icon: 'bi-bar-chart-line', route: '/reports', exact: false },
    ] },
    { label: 'Notifications', icon: 'bi-bell', route: '/notifications', exact: false, links: [
      { label: 'Notifications', icon: 'bi-bell', route: '/notifications', exact: false },
    ] },
    { label: 'Settings', icon: 'bi-gear', route: '/settings', exact: false, links: [
      { label: 'Settings', icon: 'bi-gear', route: '/settings', exact: false },
    ] },
  ];
}
