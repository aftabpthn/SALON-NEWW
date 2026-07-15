import { Routes } from '@angular/router';
import { STAFF_OS_VIEWS } from './domain/staff-os.models';

const page = () => import('../../pages/staff/staff-os-workspace/staff-os-workspace-page.component').then((m) => m.StaffOsWorkspacePageComponent);

export const STAFF_OS_ROUTES: Routes = [
  { path: '', redirectTo: 'leaderboard', pathMatch: 'full' },
  ...Object.keys(STAFF_OS_VIEWS).map((key) => ({ path: key, loadComponent: page, data: { staffOsView: key } })),
  { path: 'salary-generate', redirectTo: '/staff/payroll', pathMatch: 'full' },
];
