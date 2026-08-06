import { Routes } from "@angular/router";
import { customerAuthGuard } from "./core/auth.guard";
import { mySalonContextGuard } from "./core/my-salon-context.guard";
import { unsavedSupportDraftGuard } from "./core/unsaved-support-draft.guard";

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
    path: "support",
    canActivate: [customerAuthGuard],
    canDeactivate: [unsavedSupportDraftGuard],
    data: { hub: "support" },
    loadComponent: () => import("./features/customer-hub/customer-hub.page").then((m) => m.CustomerHubPage)
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
        path: "my-salon",
        loadComponent: () => import("./features/my-salon/my-salon.page").then((m) => m.MySalonPage)
      },
      {
        path: "search",
        loadComponent: () => import("./features/explore/explore.page").then((m) => m.ExplorePage)
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
        canDeactivate: [unsavedSupportDraftGuard],
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
        path: "saved-salons",
        canActivate: [customerAuthGuard],
        loadComponent: () => import("./features/saved-salons/saved-salons.page").then((m) => m.SavedSalonsPage)
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
    path: "my-salon/:tenantId/:branchId",
    canActivate: [mySalonContextGuard],
    loadComponent: () => import("./features/my-salon/my-salon-shell.page").then((m) => m.MySalonShellPage),
    children: [
      {
        path: "",
        loadComponent: () => import("./features/my-salon/my-salon.page").then((m) => m.MySalonPage)
      },
      {
        path: "home",
        loadComponent: () => import("./features/my-salon/my-salon.page").then((m) => m.MySalonPage)
      },
      {
        path: "services",
        loadComponent: () => import("./features/my-salon/my-salon.page").then((m) => m.MySalonPage)
      },
      {
        path: "staff",
        loadComponent: () => import("./features/my-salon/my-salon.page").then((m) => m.MySalonPage)
      },
      {
        path: "reviews",
        loadComponent: () => import("./features/my-salon/my-salon.page").then((m) => m.MySalonPage)
      },
      {
        path: "offers",
        loadComponent: () => import("./features/my-salon/my-salon.page").then((m) => m.MySalonPage)
      },
      {
        path: "happy-hours",
        loadComponent: () => import("./features/my-salon/my-salon.page").then((m) => m.MySalonPage)
      },
      {
        path: "loyalty",
        canActivate: [customerAuthGuard],
        data: { hub: "rewards" },
        loadComponent: () => import("./features/customer-hub/customer-hub.page").then((m) => m.CustomerHubPage)
      },
      {
        path: "membership",
        canActivate: [customerAuthGuard],
        data: { hub: "memberships" },
        loadComponent: () => import("./features/customer-hub/customer-hub.page").then((m) => m.CustomerHubPage)
      },
      {
        path: "booking-history",
        canActivate: [customerAuthGuard],
        loadComponent: () => import("./features/bookings/bookings.page").then((m) => m.BookingsPage)
      },
      {
        path: "service-history",
        canActivate: [customerAuthGuard],
        loadComponent: () => import("./features/bookings/bookings.page").then((m) => m.BookingsPage)
      },
      {
        path: "wishlist",
        canActivate: [customerAuthGuard],
        loadComponent: () => import("./features/wishlist/wishlist.page").then((m) => m.WishlistPage)
      },
      {
        path: "saved-salons",
        canActivate: [customerAuthGuard],
        loadComponent: () => import("./features/saved-salons/saved-salons.page").then((m) => m.SavedSalonsPage)
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
      },
      {
        path: "profile/edit/:section",
        canActivate: [customerAuthGuard],
        loadComponent: () => import("./features/profile/profile-edit.page").then((m) => m.ProfileEditPage)
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
        path: "bookings",
        canActivate: [customerAuthGuard],
        loadComponent: () => import("./features/bookings/bookings.page").then((m) => m.BookingsPage)
      },
      {
        path: "bookings/:id/chat",
        canActivate: [customerAuthGuard],
        loadComponent: () => import("./features/bookings/booking-chat.page").then((m) => m.BookingChatPage)
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
      ...["wallet", "rewards", "memberships", "packages", "gift-cards", "support", "payments", "invoices", "referrals", "family", "corporate", "goals"].map((hub) => ({
        path: hub,
        canActivate: [customerAuthGuard],
        data: { hub },
        loadComponent: () => import("./features/customer-hub/customer-hub.page").then((m) => m.CustomerHubPage)
      }))
    ]
  },
  {
    path: "search",
    loadComponent: () => import("./features/search/search.page").then((m) => m.SearchPage)
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
    path: "bookings/:id/chat",
    canActivate: [customerAuthGuard],
    loadComponent: () => import("./features/bookings/booking-chat.page").then((m) => m.BookingChatPage)
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
