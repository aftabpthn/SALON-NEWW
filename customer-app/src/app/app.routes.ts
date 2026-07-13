import { Routes } from "@angular/router";
import { customerAuthGuard } from "./core/auth.guard";
import { staffAuthGuard, staffPermissionGuard } from "./core/staff-auth.guard";

export const routes: Routes = [
  { path: "", redirectTo: "onboarding", pathMatch: "full" },
  {
    path: "onboarding",
    loadComponent: () => import("./features/onboarding/onboarding.page").then((m) => m.OnboardingPage)
  },
  {
    path: "login",
    loadComponent: () => import("./features/auth/login.page").then((m) => m.LoginPage)
  },
  {
    path: "signup",
    data: { authMode: "signup" },
    loadComponent: () => import("./features/auth/login.page").then((m) => m.LoginPage)
  },
  {
    path: "verify-otp",
    loadComponent: () => import("./features/auth/verify-otp.page").then((m) => m.VerifyOtpPage)
  },
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
      { path: "dashboard", loadComponent: () => import("./features/staff/staff-dashboard.page").then((m) => m.StaffDashboardPage) },
      { path: "appointments", loadComponent: () => import("./features/staff/staff-appointments.page").then((m) => m.StaffAppointmentsPage) },
      { path: "business", loadComponent: () => import("./features/staff/staff-business.page").then((m) => m.StaffBusinessPage) },
      { path: "queue", redirectTo: "business", pathMatch: "full" },
      { path: "clients", loadComponent: () => import("./features/staff/staff-clients.page").then((m) => m.StaffClientsPage) },
      { path: "client-360", loadComponent: () => import("./features/staff/staff-client360.page").then((m) => m.StaffClient360Page) },
      { path: "client-360/:id", loadComponent: () => import("./features/staff/staff-client360.page").then((m) => m.StaffClient360Page) },
      { path: "tasks", canActivate: [staffPermissionGuard], data: { permissions: "read:staff" }, loadComponent: () => import("./features/staff/staff-tasks.page").then((m) => m.StaffTasksPage) },
      { path: "attendance", loadComponent: () => import("./features/staff/staff-attendance.page").then((m) => m.StaffAttendancePage) },
      { path: "roster", canActivate: [staffPermissionGuard], data: { permissions: "read:staff" }, loadComponent: () => import("./features/staff/staff-roster.page").then((m) => m.StaffRosterPage) },
      { path: "performance", loadComponent: () => import("./features/staff/staff-performance.page").then((m) => m.StaffPerformancePage) },
      { path: "leaderboard", loadComponent: () => import("./features/staff/staff-leaderboard.page").then((m) => m.StaffLeaderboardPage) },
      { path: "ai-coach", loadComponent: () => import("./features/staff/staff-ai-coach.page").then((m) => m.StaffAiCoachPage) },
      { path: "notifications", loadComponent: () => import("./features/staff/staff-notifications.page").then((m) => m.StaffNotificationsPage) },
      { path: "reports", loadComponent: () => import("./features/staff/staff-reports.page").then((m) => m.StaffReportsPage) },
      { path: "calendar", loadComponent: () => import("./features/staff/staff-calendar.page").then((m) => m.StaffCalendarPage) },
      { path: "chat", loadComponent: () => import("./features/staff/staff-chat.page").then((m) => m.StaffChatPage) },
      { path: "learning", loadComponent: () => import("./features/staff/staff-learning.page").then((m) => m.StaffLearningPage) },
      { path: "payroll", canActivate: [staffPermissionGuard], data: { anyPermissions: ["read:payroll", "read:finance"] }, loadComponent: () => import("./features/staff/staff-payroll.page").then((m) => m.StaffPayrollPage) },
      { path: "leaves", canActivate: [staffPermissionGuard], data: { permissions: "read:staff" }, loadComponent: () => import("./features/staff/staff-leaves.page").then((m) => m.StaffLeavesPage) },
      { path: "profile", loadComponent: () => import("./features/staff/staff-profile.page").then((m) => m.StaffProfilePage) },
      { path: "settings", loadComponent: () => import("./features/staff/staff-settings.page").then((m) => m.StaffSettingsPage) },
      { path: "permission-denied", loadComponent: () => import("./features/staff/staff-permission-denied.page").then((m) => m.StaffPermissionDeniedPage) }
    ]
  },
  {
    path: "tabs",
    loadComponent: () => import("./features/tabs/tabs.page").then((m) => m.TabsPage),
    children: [
      { path: "", redirectTo: "home", pathMatch: "full" },
      {
        path: "home",
        loadComponent: () => import("./features/home/home.page").then((m) => m.HomePage)
      },
      {
        path: "search",
        loadComponent: () => import("./features/search/search.page").then((m) => m.SearchPage)
      },
      {
        path: "consultation",
        loadComponent: () => import("./features/consultation/live-consultation.page").then((m) => m.LiveConsultationPage)
      },
      {
        path: "bookings",
        canActivate: [customerAuthGuard],
        loadComponent: () => import("./features/bookings/bookings.page").then((m) => m.BookingsPage)
      },
      {
        path: "offers",
        loadComponent: () => import("./features/offers/offers.page").then((m) => m.OffersPage)
      },
      {
        path: "rewards",
        canActivate: [customerAuthGuard],
        data: { hub: "rewards" },
        loadComponent: () => import("./features/customer-hub/customer-hub.page").then((m) => m.CustomerHubPage)
      },
      {
        path: "wallet",
        canActivate: [customerAuthGuard],
        data: { hub: "wallet" },
        loadComponent: () => import("./features/customer-hub/customer-hub.page").then((m) => m.CustomerHubPage)
      },
      {
        path: "memberships",
        canActivate: [customerAuthGuard],
        data: { hub: "memberships" },
        loadComponent: () => import("./features/customer-hub/customer-hub.page").then((m) => m.CustomerHubPage)
      },
      {
        path: "packages",
        canActivate: [customerAuthGuard],
        data: { hub: "packages" },
        loadComponent: () => import("./features/customer-hub/customer-hub.page").then((m) => m.CustomerHubPage)
      },
      {
        path: "gift-cards",
        canActivate: [customerAuthGuard],
        data: { hub: "gift-cards" },
        loadComponent: () => import("./features/customer-hub/customer-hub.page").then((m) => m.CustomerHubPage)
      },
      {
        path: "support",
        canActivate: [customerAuthGuard],
        data: { hub: "support" },
        loadComponent: () => import("./features/customer-hub/customer-hub.page").then((m) => m.CustomerHubPage)
      },
      {
        path: "payments",
        canActivate: [customerAuthGuard],
        data: { hub: "payments" },
        loadComponent: () => import("./features/customer-hub/customer-hub.page").then((m) => m.CustomerHubPage)
      },
      {
        path: "invoices",
        canActivate: [customerAuthGuard],
        data: { hub: "invoices" },
        loadComponent: () => import("./features/customer-hub/customer-hub.page").then((m) => m.CustomerHubPage)
      },
      {
        path: "wishlist",
        canActivate: [customerAuthGuard],
        loadComponent: () => import("./features/wishlist/wishlist.page").then((m) => m.WishlistPage)
      },
      {
        path: "referrals",
        canActivate: [customerAuthGuard],
        data: { hub: "referrals" },
        loadComponent: () => import("./features/customer-hub/customer-hub.page").then((m) => m.CustomerHubPage)
      },
      {
        path: "gallery",
        canActivate: [customerAuthGuard],
        loadComponent: () => import("./features/wishlist/wishlist.page").then((m) => m.WishlistPage)
      },
      {
        path: "family",
        canActivate: [customerAuthGuard],
        data: { hub: "family" },
        loadComponent: () => import("./features/customer-hub/customer-hub.page").then((m) => m.CustomerHubPage)
      },
      {
        path: "corporate",
        canActivate: [customerAuthGuard],
        data: { hub: "corporate" },
        loadComponent: () => import("./features/customer-hub/customer-hub.page").then((m) => m.CustomerHubPage)
      },
      {
        path: "goals",
        canActivate: [customerAuthGuard],
        data: { hub: "goals" },
        loadComponent: () => import("./features/customer-hub/customer-hub.page").then((m) => m.CustomerHubPage)
      },
      {
        path: "profile",
        canActivate: [customerAuthGuard],
        loadComponent: () => import("./features/profile/profile.page").then((m) => m.ProfilePage)
      },
      {
        path: "profile/edit",
        canActivate: [customerAuthGuard],
        loadComponent: () => import("./features/profile/profile-edit.page").then((m) => m.ProfileEditPage)
      },
      {
        path: "profile/edit/personal",
        canActivate: [customerAuthGuard],
        data: { section: "personal" },
        loadComponent: () => import("./features/profile/profile-edit.page").then((m) => m.ProfileEditPage)
      },
      {
        path: "profile/edit/notifications",
        canActivate: [customerAuthGuard],
        data: { section: "notifications" },
        loadComponent: () => import("./features/profile/profile-edit.page").then((m) => m.ProfileEditPage)
      },
      {
        path: "profile/edit/password",
        canActivate: [customerAuthGuard],
        data: { section: "password" },
        loadComponent: () => import("./features/profile/profile-edit.page").then((m) => m.ProfileEditPage)
      },
      {
        path: "profile/edit/delete",
        canActivate: [customerAuthGuard],
        data: { section: "delete" },
        loadComponent: () => import("./features/profile/profile-edit.page").then((m) => m.ProfileEditPage)
      }
    ]
  },
  {
    path: "business/:slug",
    loadComponent: () => import("./features/business/business-profile.page").then((m) => m.BusinessProfilePage)
  },
  {
    path: "business/:slug/book",
    loadComponent: () => import("./features/booking/booking-flow.page").then((m) => m.BookingFlowPage)
  },
  {
    path: "booking/summary",
    canActivate: [customerAuthGuard],
    loadComponent: () => import("./features/booking/booking-summary.page").then((m) => m.BookingSummaryPage)
  },
  {
    path: "booking/success",
    canActivate: [customerAuthGuard],
    loadComponent: () => import("./features/booking/booking-success.page").then((m) => m.BookingSuccessPage)
  },
  {
    path: "bookings/:id",
    canActivate: [customerAuthGuard],
    loadComponent: () => import("./features/bookings/booking-detail.page").then((m) => m.BookingDetailPage)
  },
  {
    path: "notifications",
    canActivate: [customerAuthGuard],
    loadComponent: () => import("./features/utility/notifications.page").then((m) => m.NotificationsPage)
  },
  {
    path: "settings",
    canActivate: [customerAuthGuard],
    loadComponent: () => import("./features/utility/settings.page").then((m) => m.SettingsPage)
  },
  {
    path: "help",
    canActivate: [customerAuthGuard],
    loadComponent: () => import("./features/utility/help.page").then((m) => m.HelpPage)
  },
  { path: "**", redirectTo: "tabs/home" }
];
