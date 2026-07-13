import { inject } from '@angular/core';
import { CanActivateFn, Router, Routes } from '@angular/router';
import { DashboardComponent } from './pages/dashboard/dashboard.component';
import { ClientsPageComponent } from './pages/clients/clients-page.component';
import { StaffPageComponent } from './pages/staff/staff-page.component';
import { ServicesPageComponent } from './pages/services/services-page.component';
import { AppointmentsPageComponent } from './pages/appointments/appointments-page.component';
import { AppointmentActivitiesPageComponent } from './pages/appointments/activities/appointment-activities-page.component';
import { AvailabilityPageComponent } from './pages/availability/availability-page.component';
import { PosPageComponent } from './pages/pos/pos-page.component';
import { PosSalesPageComponent } from './pages/pos/sales/pos-sales-page.component';
import { PosPaymentModesPageComponent } from './pages/pos/payment-modes/pos-payment-modes-page.component';
import { PosInvoicesPageComponent } from './pages/pos/invoices/pos-invoices-page.component';
import { PosHoldsPageComponent } from './pages/pos/holds/pos-holds-page.component';
import { PosTipsPageComponent } from './pages/pos/tips/pos-tips-page.component';
import { InvoiceReportsPageComponent } from './pages/reports/invoices/invoice-reports-page.component';
import { AppointmentReportsPageComponent } from './pages/reports/appointments/appointment-reports-page.component';
import { StaffBookingsReportPageComponent } from './pages/reports/staff-bookings/staff-bookings-report-page.component';
import { InventoryPageComponent } from './pages/inventory/inventory-page.component';
import { MembershipsPageComponent } from './pages/memberships/memberships-page.component';
import { PackagesPageComponent } from './pages/packages/packages-page.component';
import { ReportsPageComponent } from './pages/reports/reports-page.component';
import { NotificationsPageComponent } from './pages/notifications/notifications-page.component';
import { SettingsPageComponent } from './pages/settings/settings-page.component';
import { InvoiceSettingsPageComponent } from './pages/settings/invoice/invoice-settings-page.component';
import { authGuard } from './core/guards/auth.guard';

const packageReportRedirect = (tab: string): CanActivateFn => () =>
  inject(Router).createUrlTree(['/packages'], { queryParams: { tab } });

export const routes: Routes = [
  { path: '', redirectTo: 'dashboard', pathMatch: 'full' },
  { path: 'dashboard', component: DashboardComponent, canActivate: [authGuard] },
  { path: 'clients', component: ClientsPageComponent, canActivate: [authGuard] },
  { path: 'staff', component: StaffPageComponent, canActivate: [authGuard] },
  { path: 'staff/:id', component: StaffPageComponent, canActivate: [authGuard] },
  { path: 'services', component: ServicesPageComponent, canActivate: [authGuard] },
  { path: 'appointments', component: AppointmentsPageComponent, canActivate: [authGuard] },
  { path: 'appointments/activities', component: AppointmentActivitiesPageComponent, canActivate: [authGuard] },
  { path: 'availability', component: AvailabilityPageComponent, canActivate: [authGuard] },
  { path: 'pos', component: PosPageComponent, canActivate: [authGuard] },
  { path: 'pos/sales', component: PosSalesPageComponent, canActivate: [authGuard] },
  { path: 'pos/payment-modes', component: PosPaymentModesPageComponent, canActivate: [authGuard] },
  { path: 'pos/invoices', component: PosInvoicesPageComponent, canActivate: [authGuard] },
  { path: 'pos/holds', component: PosHoldsPageComponent, canActivate: [authGuard] },
  { path: 'pos/tips', component: PosTipsPageComponent, canActivate: [authGuard] },
  { path: 'inventory', component: InventoryPageComponent, canActivate: [authGuard] },
  { path: 'memberships', component: MembershipsPageComponent, canActivate: [authGuard] },
  { path: 'packages', component: PackagesPageComponent, canActivate: [authGuard] },
  { path: 'reports/pending-packages', canActivate: [packageReportRedirect('pending')], children: [] },
  { path: 'reports/expired-packages', canActivate: [packageReportRedirect('expired')], children: [] },
  { path: 'reports/completed-packages', canActivate: [packageReportRedirect('completed')], children: [] },
  { path: 'reports', component: ReportsPageComponent, canActivate: [authGuard] },
  { path: 'appointment-reports', component: AppointmentReportsPageComponent, canActivate: [authGuard] },
  { path: 'reports/staff-bookings', component: StaffBookingsReportPageComponent, canActivate: [authGuard] },
  { path: 'reports/invoices', component: InvoiceReportsPageComponent, canActivate: [authGuard] },
  { path: 'notifications', component: NotificationsPageComponent, canActivate: [authGuard] },
  { path: 'settings', component: SettingsPageComponent, canActivate: [authGuard] },
  { path: 'settings/invoice', component: InvoiceSettingsPageComponent, canActivate: [authGuard] },
];
