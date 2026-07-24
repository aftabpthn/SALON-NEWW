import type { Metadata } from "next";
import { PAGE_SEO, breadcrumbJsonLd } from "@/lib/seo";
import { EcosystemRoutePage } from "@/components/ecosystem/EcosystemRoutePage";

export const metadata: Metadata = PAGE_SEO["/owner-crm"];

export default function OwnerCrmPage() {
  const breadcrumbs = breadcrumbJsonLd([
    { name: "Home", url: "/" },
    { name: "Owner CRM & POS", url: "/owner-crm" },
  ]);
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbs) }} />
      <EcosystemRoutePage route="owner" />
    </>
  );
}
