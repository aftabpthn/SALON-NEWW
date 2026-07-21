import { Routes } from '@angular/router';
import { STAFF_OS_VIEWS } from './domain/staff-os.models';

const page = () => import('../../pages/staff/staff-os-workspace/staff-os-workspace-page.component').then((m) => m.StaffOsWorkspacePageComponent);
const salaryGeneratePage = () => import('../../pages/staff/payroll/staff-payroll-page.component').then((m) => m.StaffPayrollPageComponent);

export const STAFF_OS_ROUTES: Routes = [
  { path: '', redirectTo: 'leaderboard', pathMatch: 'full' },
  { path: 'salary-generate', loadComponent: salaryGeneratePage, data: { staffOsSalaryGenerate: true } },
  { path: 'generate-salary', loadComponent: salaryGeneratePage, data: { staffOsSalaryGenerate: true } },
  ...Object.keys(STAFF_OS_VIEWS).map((key) => ({ path: key, loadComponent: page, data: { staffOsView: key } })),
];
