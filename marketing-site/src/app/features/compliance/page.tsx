import type { Metadata } from "next";
import { getFeaturePageSEO, breadcrumbJsonLd } from "@/lib/seo";
import CompliancePageClient from "./CompliancePageClient";

export const metadata: Metadata = getFeaturePageSEO("compliance");

export default function CompliancePage() {
  const breadcrumbs = breadcrumbJsonLd([
    { name: "Home", url: "/" },
    { name: "Features", url: "/features" },
    { name: "Staff Compliance", url: "/features/compliance" },
  ]);
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbs) }} />
      <CompliancePageClient />
    </>
  );
}
