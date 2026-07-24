import type { Metadata } from "next";
import { getFeaturePageSEO, breadcrumbJsonLd } from "@/lib/seo";
import InventoryPageClient from "./InventoryPageClient";

export const metadata: Metadata = getFeaturePageSEO("inventory");

export default function InventoryPage() {
  const breadcrumbs = breadcrumbJsonLd([
    { name: "Home", url: "/" },
    { name: "Features", url: "/features" },
    { name: "Inventory Management", url: "/features/inventory" },
  ]);
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbs) }} />
      <InventoryPageClient />
    </>
  );
}
