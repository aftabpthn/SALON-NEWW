import type { Metadata } from "next";
import { getFeaturePageSEO, breadcrumbJsonLd } from "@/lib/seo";
import ClientCrmPageClient from "./ClientCrmPageClient";

export const metadata: Metadata = getFeaturePageSEO("client-crm");

export default function ClientCrmPage() {
  const breadcrumbs = breadcrumbJsonLd([
    { name: "Home", url: "/" },
    { name: "Features", url: "/features" },
    { name: "Customer 360 CRM", url: "/features/client-crm" },
  ]);
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbs) }} />
      <ClientCrmPageClient />
    </>
  );
}
