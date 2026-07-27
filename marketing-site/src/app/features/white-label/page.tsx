import type { Metadata } from "next";
import { getFeaturePageSEO, breadcrumbJsonLd } from "@/lib/seo";
import WhiteLabelPageClient from "./WhiteLabelPageClient";

export const metadata: Metadata = getFeaturePageSEO("white-label");

export default function WhiteLabelPage() {
  const breadcrumbs = breadcrumbJsonLd([
    { name: "Home", url: "/" },
    { name: "Features", url: "/features" },
    { name: "White Label", url: "/features/white-label" },
  ]);
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbs) }} />
      <WhiteLabelPageClient />
    </>
  );
}
