import { Routes } from "@angular/router";
import { customerAuthGuard } from "./core/auth.guard";

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
