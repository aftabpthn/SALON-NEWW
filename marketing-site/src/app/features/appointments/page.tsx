import type { Metadata } from "next";
import { getFeaturePageSEO, breadcrumbJsonLd } from "@/lib/seo";
import AppointmentsPageClient from "./AppointmentsPageClient";

export const metadata: Metadata = getFeaturePageSEO("appointments");

export default function AppointmentsPage() {
  const breadcrumbs = breadcrumbJsonLd([
    { name: "Home", url: "/" },
    { name: "Features", url: "/features" },
    { name: "Smart Booking", url: "/features/appointments" },
  ]);
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbs) }} />
      <AppointmentsPageClient />
    </>
  );
}
