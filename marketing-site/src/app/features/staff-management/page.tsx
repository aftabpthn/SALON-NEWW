import type { Metadata } from "next";
import { getFeaturePageSEO, breadcrumbJsonLd } from "@/lib/seo";
import StaffManagementPageClient from "./StaffManagementPageClient";

export const metadata: Metadata = getFeaturePageSEO("staff-management");

export default function StaffManagementPage() {
  const breadcrumbs = breadcrumbJsonLd([
    { name: "Home", url: "/" },
    { name: "Features", url: "/features" },
    { name: "Staff Management", url: "/features/staff-management" },
  ]);
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbs) }} />
      <StaffManagementPageClient />
    </>
  );
}
