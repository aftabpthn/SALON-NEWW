import { Routes } from "@angular/router";
import { staffAuthGuard, staffPermissionGuard } from "./core/staff-auth.guard";

export const routes: Routes = [
  { path: "", redirectTo: "staff/login", pathMatch: "full" },
  {
    path: "staff/login",
    loadComponent: () => import("./features/staff/staff-login.page").then((m) => m.StaffLoginPage)
  },
  {
    path: "staff/open",
    loadComponent: () => import("./features/staff/staff-open.page").then((m) => m.StaffOpenPage)
  },
  {
    path: "staff",
    canActivate: [staffAuthGuard],
    loadComponent: () => import("./features/staff/staff-layout.page").then((m) => m.StaffLayoutPage),
    children: [
      { path: "", redirectTo: "dashboard", pathMatch: "full" },
      { path: "dashboard", canActivate: [staffPermissionGuard], data: { permissions: "read:appointments" }, loadComponent: () => import("./features/staff/staff-dashboard.page").then((m) => m.StaffDashboardPage) },
      { path: "appointments", canActivate: [staffPermissionGuard], data: { permissions: "read:appointments" }, loadComponent: () => import("./features/staff/staff-appointments.page").then((m) => m.StaffAppointmentsPage) },
      { path: "business", canActivate: [staffPermissionGuard], data: { permissions: "read:appointments" }, loadComponent: () => import("./features/staff/staff-business.page").then((m) => m.StaffBusinessPage) },
      { path: "queue", canActivate: [staffPermissionGuard], data: { permissions: "read:appointments" }, loadComponent: () => import("./features/staff/staff-queue.page").then((m) => m.StaffQueuePage) },
      { path: "tasks", canActivate: [staffPermissionGuard], data: { permissions: "read:staff" }, loadComponent: () => import("./features/staff/staff-tasks.page").then((m) => m.StaffTasksPage) },
      { path: "attendance", canActivate: [staffPermissionGuard], data: { anyPermissions: ["allow:staff-checkin-checkout", "read:staff", "write:staff"] }, loadComponent: () => import("./features/staff/staff-attendance.page").then((m) => m.StaffAttendancePage) },
      { path: "roster", canActivate: [staffPermissionGuard], data: { permissions: "read:staff" }, loadComponent: () => import("./features/staff/staff-roster.page").then((m) => m.StaffRosterPage) },
      { path: "performance", canActivate: [staffPermissionGuard], data: { permissions: "read:staff" }, loadComponent: () => import("./features/staff/staff-performance.page").then((m) => m.StaffPerformancePage) },
      { path: "leaderboard", canActivate: [staffPermissionGuard], data: { permissions: "read:staff" }, loadComponent: () => import("./features/staff/staff-leaderboard.page").then((m) => m.StaffLeaderboardPage) },
      { path: "notifications", canActivate: [staffPermissionGuard], data: { permissions: "read:staff" }, loadComponent: () => import("./features/staff/staff-notifications.page").then((m) => m.StaffNotificationsPage) },
      { path: "reports", canActivate: [staffPermissionGuard], data: { permissions: "read:staff" }, loadComponent: () => import("./features/staff/staff-reports.page").then((m) => m.StaffReportsPage) },
      { path: "calendar", canActivate: [staffPermissionGuard], data: { permissions: "read:staff" }, loadComponent: () => import("./features/staff/staff-calendar.page").then((m) => m.StaffCalendarPage) },
      { path: "chat", canActivate: [staffPermissionGuard], data: { permissions: "read:staff" }, loadComponent: () => import("./features/staff/staff-chat.page").then((m) => m.StaffChatPage) },
      { path: "payroll", canActivate: [staffPermissionGuard], data: { anyPermissions: ["read:payroll", "read:finance"] }, loadComponent: () => import("./features/staff/staff-payroll.page").then((m) => m.StaffPayrollPage) },
      { path: "leaves", canActivate: [staffPermissionGuard], data: { permissions: "read:staff" }, loadComponent: () => import("./features/staff/staff-leaves.page").then((m) => m.StaffLeavesPage) },
      { path: "profile", loadComponent: () => import("./features/staff/staff-profile.page").then((m) => m.StaffProfilePage) },
      { path: "settings", loadComponent: () => import("./features/staff/staff-settings.page").then((m) => m.StaffSettingsPage) },
      { path: "permission-denied", loadComponent: () => import("./features/staff/staff-permission-denied.page").then((m) => m.StaffPermissionDeniedPage) }
    ]
  },
  { path: "**", redirectTo: "staff/login" }
];
