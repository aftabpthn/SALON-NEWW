import type { Metadata } from "next";
import { PAGE_SEO, breadcrumbJsonLd } from "@/lib/seo";
import CustomersPageClient from "./CustomersPageClient";

export const metadata: Metadata = PAGE_SEO["/customers"];

export default function CustomersPage() {
  const breadcrumbs = breadcrumbJsonLd([
    { name: "Home", url: "/" },
    { name: "Customers", url: "/customers" },
  ]);
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbs) }} />
      <CustomersPageClient />
    </>
  );
}
