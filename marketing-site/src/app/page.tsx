import { Metadata } from "next";
import HomePageClient from "./HomePageClient";
import { breadcrumbJsonLd } from "@/lib/seo";
import { SITE_URL } from "@/lib/site";

export const metadata: Metadata = {
  title: "Aura — Salon CRM, POS & Booking Software for India",
  description: "Aura is a connected salon operating system. Run CRM, GST billing, online booking, staff payroll, inventory and finance from one platform — built for Indian salons.",
  openGraph: {
    title: "Aura — Salon CRM, POS & Booking Software for India",
    description: "Connected CRM, POS, booking, staff and inventory for Indian salons.",
    url: SITE_URL,
    images: [{ url: "/og?path=/", width: 1200, height: 630 }],
  },
  twitter: {
    card: "summary_large_image",
    title: "Aura — Salon CRM, POS & Booking Software for India",
    description: "Connected CRM, POS, booking, staff and inventory for Indian salons.",
    images: ["/og?path=/"],
  },
  alternates: {
    canonical: SITE_URL,
    languages: { "en-IN": SITE_URL, "hi-IN": `${SITE_URL}?lang=hi` },
  },
};

export default function HomePage() {
  const breadcrumbs = breadcrumbJsonLd([
    { name: "Home", url: "/" },
  ]);
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbs) }} />
      <HomePageClient />
    </>
  );
}
