import type { Metadata } from "next";
import { getFeaturePageSEO, breadcrumbJsonLd } from "@/lib/seo";
import BillingPageClient from "./BillingPageClient";

export const metadata: Metadata = getFeaturePageSEO("billing");

export default function BillingPage() {
  const breadcrumbs = breadcrumbJsonLd([
    { name: "Home", url: "/" },
    { name: "Features", url: "/features" },
    { name: "POS & Billing", url: "/features/billing" },
  ]);
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbs) }} />
      <BillingPageClient />
    </>
  );
}
