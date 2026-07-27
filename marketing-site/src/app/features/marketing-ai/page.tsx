import type { Metadata } from "next";
import { getFeaturePageSEO, breadcrumbJsonLd } from "@/lib/seo";
import MarketingAiPageClient from "./MarketingAiPageClient";

export const metadata: Metadata = getFeaturePageSEO("marketing-ai");

export default function MarketingAiPage() {
  const breadcrumbs = breadcrumbJsonLd([
    { name: "Home", url: "/" },
    { name: "Features", url: "/features" },
    { name: "Marketing Workflows", url: "/features/marketing-ai" },
  ]);
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbs) }} />
      <MarketingAiPageClient />
    </>
  );
}
