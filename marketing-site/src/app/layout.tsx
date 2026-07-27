import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { Navbar } from "@/components/layout/Navbar";
import { Footer } from "@/components/layout/Footer";
import { SmoothScrollProvider } from "@/components/providers/SmoothScrollProvider";
import { ScrollProgress } from "@/components/ui/ScrollProgress";
import { WhatsAppButton } from "@/components/ui/WhatsAppButton";
import { CommandPalette } from "@/components/ui/CommandPalette";
import { CookieConsent } from "@/components/ui/CookieConsent";
import { LanguageProvider } from "@/components/providers/LanguageProvider";
import { softwareAppJsonLd, organizationJsonLd, websiteJsonLd } from "@/lib/seo";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL("https://aura.example.com"),
  title: {
    default: "Aura — Salon CRM, POS & Booking Software for India",
    template: "%s | Aura Salon CRM/POS",
  },
  description:
    "Aura is a connected salon operating system. Run CRM, GST billing, online booking, staff payroll, inventory and finance from one platform — built for Indian salons.",
  keywords: [
    "salon software India", "salon CRM", "salon POS", "salon billing software",
    "salon management app", "salon booking software", "salon staff management",
    "GST billing salon", "salon inventory", "salon marketing automation",
    "best salon software India", "salon POS India", "salon app India",
    "salon software free", "salon billing GST", "salon management software India",
  ],
  authors: [{ name: "Aura" }],
  creator: "Aura",
  publisher: "Aura",
  formatDetection: { telephone: false },
  openGraph: {
    title: "Aura — Salon CRM, POS & Booking Software for India",
    description:
      "Connected CRM, POS, booking, staff and inventory for Indian salons. Start free.",
    url: "https://aura.example.com",
    siteName: "Aura Salon CRM/POS",
    locale: "en_IN",
    type: "website",
    images: [
      {
        url: "/og?path=/",
        width: 1200,
        height: 630,
        alt: "Aura Salon CRM/POS — Connected salon operating system",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Aura — Salon CRM, POS & Booking Software for India",
    description:
      "Connected CRM, POS, booking, staff and inventory for Indian salons.",
    images: ["/og?path=/"],
    creator: "@aurasalon",
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-video-preview": -1,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
  alternates: {
    canonical: "https://aura.example.com",
    languages: {
      "en-IN": "https://aura.example.com",
      "hi-IN": "https://aura.example.com?lang=hi",
    },
  },
};

import { CustomCursor } from "@/components/ui/CustomCursor";
import { SoundEffectsToggle } from "@/components/ui/SoundEffects";
import { FloatingConversionDock } from "@/components/ui/FloatingConversionDock";

const jsonLdScripts = [softwareAppJsonLd, organizationJsonLd, websiteJsonLd];

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en-IN" className={`${inter.variable} h-full`} suppressHydrationWarning>
      <head>
        {jsonLdScripts.map((ld, i) => (
          <script
            key={i}
            type="application/ld+json"
            dangerouslySetInnerHTML={{ __html: JSON.stringify(ld) }}
          />
        ))}
      </head>
      <body className="min-h-full flex flex-col font-sans antialiased grain-overlay">
        {/* Skip to content */}
        <a href="#main-content" className="skip-link">Skip to content / मुख्य सामग्री</a>
        <LanguageProvider>
        <SmoothScrollProvider>
          <CustomCursor />
          <SoundEffectsToggle />
          <FloatingConversionDock />
          <ScrollProgress />
          <WhatsAppButton />
          <CommandPalette />
          <CookieConsent />
          <Navbar />
          <main id="main-content" className="flex-1">{children}</main>
          <Footer />
        </SmoothScrollProvider>
        </LanguageProvider>
      </body>
    </html>
  );
}
