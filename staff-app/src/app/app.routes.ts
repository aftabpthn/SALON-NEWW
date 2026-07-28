import { Routes } from "@angular/router";
import { staffAuthGuard, staffPermissionGuard } from "./core/staff-auth.guard";

export const routes: Routes = [
  { path: "", redirectTo: "staff/login", pathMatch: "full" },
  {
    path: "staff/login",
    loadComponent: () => import("./features/staff/staff-login.page").then((m) => m.StaffLoginPage)
  },
  {
    path: "staff",
    canActivate: [staffAuthGuard],
    loadComponent: () => import("./features/staff/staff-layout.page").then((m) => m.StaffLayoutPage),
    children: [
      { path: "", redirectTo: "dashboard", pathMatch: "full" },
      { path: "dashboard", canActivate: [staffPermissionGuard], data: { permissions: "staff.app.dashboard.read" }, loadComponent: () => import("./features/staff/staff-dashboard.page").then((m) => m.StaffDashboardPage) },
      { path: "appointments", canActivate: [staffPermissionGuard], data: { permissions: "staff.app.appointments.read" }, loadComponent: () => import("./features/staff/staff-appointments.page").then((m) => m.StaffAppointmentsPage) },
      { path: "business", canActivate: [staffPermissionGuard], data: { permissions: "staff.app.business.read" }, loadComponent: () => import("./features/staff/staff-business.page").then((m) => m.StaffBusinessPage) },
      { path: "offers", canActivate: [staffPermissionGuard], data: { permissions: "staff.app.offers.read" }, loadComponent: () => import("./features/staff/staff-offers.page").then((m) => m.StaffOffersPage) },
      { path: "queue", canActivate: [staffPermissionGuard], data: { permissions: "staff.app.queue.read" }, loadComponent: () => import("./features/staff/staff-queue.page").then((m) => m.StaffQueuePage) },
      { path: "tasks", canActivate: [staffPermissionGuard], data: { permissions: "staff.app.tasks.read" }, loadComponent: () => import("./features/staff/staff-tasks.page").then((m) => m.StaffTasksPage) },
      { path: "attendance", canActivate: [staffPermissionGuard], data: { permissions: "staff.app.attendance.read" }, loadComponent: () => import("./features/staff/staff-attendance.page").then((m) => m.StaffAttendancePage) },
      { path: "roster", canActivate: [staffPermissionGuard], data: { permissions: "staff.app.roster.read" }, loadComponent: () => import("./features/staff/staff-roster.page").then((m) => m.StaffRosterPage) },
      { path: "performance", canActivate: [staffPermissionGuard], data: { permissions: "staff.app.performance.read" }, loadComponent: () => import("./features/staff/staff-performance.page").then((m) => m.StaffPerformancePage) },
      { path: "leaderboard", canActivate: [staffPermissionGuard], data: { permissions: "staff.app.leaderboard.read" }, loadComponent: () => import("./features/staff/staff-leaderboard.page").then((m) => m.StaffLeaderboardPage) },
      { path: "notifications", canActivate: [staffPermissionGuard], data: { permissions: "staff.app.notifications.read" }, loadComponent: () => import("./features/staff/staff-notifications.page").then((m) => m.StaffNotificationsPage) },
      { path: "reports", canActivate: [staffPermissionGuard], data: { permissions: "staff.app.reports.read" }, loadComponent: () => import("./features/staff/staff-reports.page").then((m) => m.StaffReportsPage) },
      { path: "calendar", canActivate: [staffPermissionGuard], data: { permissions: "staff.app.calendar.read" }, loadComponent: () => import("./features/staff/staff-calendar.page").then((m) => m.StaffCalendarPage) },
      { path: "chat", canActivate: [staffPermissionGuard], data: { permissions: "staff.app.chat.read" }, loadComponent: () => import("./features/staff/staff-chat.page").then((m) => m.StaffChatPage) },
      { path: "payroll", canActivate: [staffPermissionGuard], data: { permissions: "staff.app.payroll.read" }, loadComponent: () => import("./features/staff/staff-payroll.page").then((m) => m.StaffPayrollPage) },
      { path: "leaves", canActivate: [staffPermissionGuard], data: { permissions: "staff.app.leaves.read" }, loadComponent: () => import("./features/staff/staff-leaves.page").then((m) => m.StaffLeavesPage) },
      { path: "feedback", canActivate: [staffPermissionGuard], data: { permissions: "staff.app.feedback.read" }, loadComponent: () => import("./features/staff/staff-feedback.page").then((m) => m.StaffFeedbackPage) },
      { path: "profile", canActivate: [staffPermissionGuard], data: { permissions: "staff.app.profile.read" }, loadComponent: () => import("./features/staff/staff-profile.page").then((m) => m.StaffProfilePage) },
      { path: "settings", canActivate: [staffPermissionGuard], data: { permissions: "staff.app.settings.read" }, loadComponent: () => import("./features/staff/staff-settings.page").then((m) => m.StaffSettingsPage) },
      { path: "permission-denied", loadComponent: () => import("./features/staff/staff-permission-denied.page").then((m) => m.StaffPermissionDeniedPage) }
    ]
  },
  { path: "**", redirectTo: "staff/login" }
];
