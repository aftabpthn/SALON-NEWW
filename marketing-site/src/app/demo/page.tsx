import type { Metadata } from "next";
import { PAGE_SEO, breadcrumbJsonLd } from "@/lib/seo";
import DemoPageClient from "./DemoPageClient";

export const metadata: Metadata = PAGE_SEO["/demo"];

export default function DemoPage() {
  const breadcrumbs = breadcrumbJsonLd([
    { name: "Home", url: "/" },
    { name: "Book a Demo", url: "/demo" },
  ]);
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbs) }} />
      <DemoPageClient />
    </>
  );
}
