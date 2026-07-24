import type { Metadata } from "next";
import { PAGE_SEO, breadcrumbJsonLd } from "@/lib/seo";
import { EcosystemRoutePage } from "@/components/ecosystem/EcosystemRoutePage";

export const metadata: Metadata = PAGE_SEO["/staff-app"];

export default function StaffAppPage() {
  const breadcrumbs = breadcrumbJsonLd([
    { name: "Home", url: "/" },
    { name: "Staff App", url: "/staff-app" },
  ]);
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbs) }} />
      <EcosystemRoutePage route="staff" />
    </>
  );
}
