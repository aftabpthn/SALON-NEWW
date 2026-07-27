import type { Metadata } from "next";
import { getFeaturePageSEO, breadcrumbJsonLd } from "@/lib/seo";
import FinancePageClient from "./FinancePageClient";

export const metadata: Metadata = getFeaturePageSEO("finance");

export default function FinancePage() {
  const breadcrumbs = breadcrumbJsonLd([
    { name: "Home", url: "/" },
    { name: "Features", url: "/features" },
    { name: "Finance Engine", url: "/features/finance" },
  ]);
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbs) }} />
      <FinancePageClient />
    </>
  );
}
