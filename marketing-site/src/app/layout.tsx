import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { Navbar } from "@/components/layout/Navbar";
import { Footer } from "@/components/layout/Footer";
import { SmoothScrollProvider } from "@/components/providers/SmoothScrollProvider";
import { CustomCursor } from "@/components/ui/CustomCursor";
import { ScrollProgress } from "@/components/ui/ScrollProgress";
import { SocialProofToast } from "@/components/ui/SocialProofToast";
import { BackToTop } from "@/components/ui/BackToTop";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "Aura — The All-in-One Salon Platform",
    template: "%s | Aura Salon CRM/POS",
  },
  description:
    "Run your salon like a star. Aura is the complete CRM, POS, and AI platform built for modern salons — appointments, billing, staff, inventory, marketing, and finance in one beautifully simple dashboard.",
  keywords: [
    "salon software", "salon CRM", "salon POS", "salon billing",
    "salon management", "appointment booking", "staff management",
    "salon inventory", "GST billing salon", "salon marketing",
    "salon POS India", "salon software India",
  ],
  openGraph: {
    title: "Aura — The All-in-One Salon Platform",
    description: "Complete CRM, POS & AI platform for modern salons.",
    type: "website",
    locale: "en_IN",
    siteName: "Aura Salon CRM/POS",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${inter.variable} h-full`}>
      <body className="min-h-full flex flex-col font-sans antialiased grain-overlay">
        {/* Skip to content */}
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-[10000] focus:px-4 focus:py-2 focus:bg-white focus:text-aura-text focus:rounded-xl focus:shadow-lg focus:outline-none focus:ring-2 focus:ring-neon-violet"
        >
          Skip to content
        </a>

        <SmoothScrollProvider>
          <ScrollProgress />
          <CustomCursor />
          <SocialProofToast />
          <BackToTop />
          <Navbar />
          <main id="main-content" className="flex-1">{children}</main>
          <Footer />
        </SmoothScrollProvider>
      </body>
    </html>
  );
}
