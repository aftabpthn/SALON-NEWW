import type { Metadata } from "next";
import { PAGE_SEO, breadcrumbJsonLd } from "@/lib/seo";
import FeaturesPageClient from "./FeaturesPageClient";

export const metadata: Metadata = PAGE_SEO["/features"];

export default function FeaturesPage() {
  const breadcrumbs = breadcrumbJsonLd([
    { name: "Home", url: "/" },
    { name: "Features", url: "/features" },
  ]);
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbs) }} />
      <FeaturesPageClient />
    </>
  );
}
