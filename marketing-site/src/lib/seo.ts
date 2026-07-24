import type { Metadata } from "next";

const SITE = "https://aura.example.com";

/* ===== PAGE METADATA REGISTRY ===== */
export const PAGE_SEO: Record<string, Metadata> = {
  "/": {
    title: "Aura — Salon CRM, POS & Booking Software for India",
    description:
      "Aura is a connected salon operating system. Run CRM, GST billing, online booking, staff payroll, inventory and finance from one platform — built for Indian salons.",
    keywords: [
      "salon software India", "salon CRM", "salon POS", "salon billing software",
      "salon management app", "salon booking software", "salon staff management",
      "GST billing salon", "salon inventory", "salon marketing automation",
      "best salon software India", "salon POS India",
    ],
    openGraph: {
      title: "Aura — Salon CRM, POS & Booking Software for India",
      description:
        "Connected CRM, POS, booking, staff and inventory for Indian salons. Start free, pay at salon billing.",
      url: SITE,
      images: [{ url: "/og?path=/", width: 1200, height: 630 }],
      type: "website",
      locale: "en_IN",
      siteName: "Aura Salon CRM/POS",
    },
    twitter: {
      card: "summary_large_image",
      title: "Aura — Salon CRM, POS & Booking Software for India",
      description:
        "Connected CRM, POS, booking, staff and inventory for Indian salons.",
      images: ["/og?path=/"],
    },
    alternates: {
      canonical: SITE,
      languages: { "en-IN": SITE, "hi-IN": `${SITE}?lang=hi` },
    },
  },

  "/platform": {
    title: "Aura Platform — Salon CRM, Booking, Staff & Inventory in One System",
    description:
      "Aura connects owner CRM and POS, customer booking, staff operations, inventory and finance around the same salon day. No double entry, no gaps.",
    openGraph: {
      title: "Aura Platform — Salon CRM, Booking, Staff & Inventory",
      description:
        "Owner CRM and POS, customer booking and staff operations connected around the same salon day.",
      url: `${SITE}/platform`,
      images: [{ url: "/og?path=platform", width: 1200, height: 630 }],
    },
    twitter: {
      card: "summary_large_image",
      title: "Aura Platform — Salon CRM, Booking, Staff & Inventory",
      description: "Owner CRM, booking, staff and inventory connected.",
      images: ["/og?path=platform"],
    },
    alternates: {
      canonical: `${SITE}/platform`,
      languages: { "en-IN": `${SITE}/platform`, "hi-IN": `${SITE}/platform?lang=hi` },
    },
  },

  "/owner-crm": {
    title: "Owner CRM & POS — GST Billing, Client CRM, Inventory for Salons",
    description:
      "GST-ready invoicing, UPI/card/cash split payments, thermal printing, client 360 profiles, inventory tracking and finance engine — the complete toolkit for salon owners.",
    openGraph: {
      title: "Owner CRM & POS — Aura Salon CRM/POS",
      description: "GST-ready billing, client CRM, inventory and finance for salon owners.",
      url: `${SITE}/owner-crm`,
      images: [{ url: "/og?path=owner-crm", width: 1200, height: 630 }],
    },
    twitter: {
      card: "summary_large_image",
      title: "Owner CRM & POS — Aura Salon CRM/POS",
      description: "GST-ready billing, client CRM, inventory for salon owners.",
      images: ["/og?path=owner-crm"],
    },
    alternates: {
      canonical: `${SITE}/owner-crm`,
    },
  },

  "/customer-app": {
    title: "Customer App — Online Booking, Loyalty Wallet & Referrals for Salon Clients",
    description:
      "Let your clients book online, track visit history, earn loyalty points, refer friends, and get WhatsApp reminders — all from their phone.",
    openGraph: {
      title: "Customer App — Aura Salon CRM/POS",
      description: "Online booking, loyalty wallet, referrals and WhatsApp notifications.",
      url: `${SITE}/customer-app`,
      images: [{ url: "/og?path=customer-app", width: 1200, height: 630 }],
    },
    twitter: {
      card: "summary_large_image",
      title: "Customer App — Aura Salon CRM/POS",
      description: "Online booking, loyalty wallet, referrals and WhatsApp.",
      images: ["/og?path=customer-app"],
    },
    alternates: {
      canonical: `${SITE}/customer-app`,
    },
  },

  "/staff-app": {
    title: "Staff App — Attendance, Shift Scheduling & Commission Tracking for Salon Teams",
    description:
      "Secure face/biometric attendance, shift scheduling, commission tracking and performance dashboards — built for salon professionals.",
    openGraph: {
      title: "Staff App — Aura Salon CRM/POS",
      description: "Attendance, shift scheduling, commission tracking and performance dashboards.",
      url: `${SITE}/staff-app`,
      images: [{ url: "/og?path=staff-app", width: 1200, height: 630 }],
    },
    twitter: {
      card: "summary_large_image",
      title: "Staff App — Aura Salon CRM/POS",
      description: "Attendance, scheduling, commissions and performance dashboards.",
      images: ["/og?path=staff-app"],
    },
    alternates: {
      canonical: `${SITE}/staff-app`,
    },
  },

  "/workflows": {
    title: "Connected Workflows — How Booking, Billing & Staff Connect in Aura",
    description:
      "See how appointment booking flows into billing, staff commissions, inventory deductions and finance records — all connected, zero double entry.",
    openGraph: {
      title: "Connected Workflows — Aura Salon CRM/POS",
      description: "Booking to billing to staff to inventory — all connected.",
      url: `${SITE}/workflows`,
      images: [{ url: "/og?path=workflows", width: 1200, height: 630 }],
    },
    twitter: {
      card: "summary_large_image",
      title: "Connected Workflows — Aura Salon CRM/POS",
      description: "Booking, billing, staff and inventory all connected.",
      images: ["/og?path=workflows"],
    },
    alternates: {
      canonical: `${SITE}/workflows`,
    },
  },

  "/pricing": {
    title: "Aura Pricing — Salon Software Plans Starting at ₹999/month",
    description:
      "Transparent pricing for every salon size. Starter at ₹999/mo for single-branch salons, Growth at ₹2,499/mo for multi-branch, Enterprise with custom pricing. 14-day free trial.",
    openGraph: {
      title: "Aura Pricing — Salon Software Plans from ₹999/month",
      description: "Starter ₹999/mo, Growth ₹2,499/mo, Enterprise custom. 14-day free trial.",
      url: `${SITE}/pricing`,
      images: [{ url: "/og?path=pricing", width: 1200, height: 630 }],
    },
    twitter: {
      card: "summary_large_image",
      title: "Aura Pricing — Plans from ₹999/month",
      description: "Starter ₹999/mo, Growth ₹2,499/mo, Enterprise custom.",
      images: ["/og?path=pricing"],
    },
    alternates: {
      canonical: `${SITE}/pricing`,
    },
  },

  "/features": {
    title: "Aura Features — Smart Booking, POS, CRM, Staff, Inventory & Marketing",
    description:
      "Every feature your salon needs: smart booking, GST billing, client CRM, staff management, inventory tracking, marketing workflows, finance engine and compliance tools.",
    openGraph: {
      title: "Aura Features — Complete Salon Platform",
      description: "Booking, POS, CRM, staff, inventory, marketing and finance.",
      url: `${SITE}/features`,
      images: [{ url: "/og?path=features", width: 1200, height: 630 }],
    },
    twitter: {
      card: "summary_large_image",
      title: "Aura Features — Complete Salon Platform",
      description: "Booking, POS, CRM, staff, inventory, marketing and finance.",
      images: ["/og?path=features"],
    },
    alternates: {
      canonical: `${SITE}/features`,
    },
  },

  "/about": {
    title: "About Aura — Built for Indian Salons by People Who Understand the Business",
    description:
      "Aura was built by a team that understands how Indian salons actually run — GST billing, UPI payments, multi-branch operations, staff management and client retention.",
    openGraph: {
      title: "About Aura — Built for Indian Salons",
      description: "Understanding how Indian salons actually run.",
      url: `${SITE}/about`,
      images: [{ url: "/og?path=about", width: 1200, height: 630 }],
    },
    twitter: {
      card: "summary_large_image",
      title: "About Aura — Built for Indian Salons",
      description: "Built by people who understand salon operations.",
      images: ["/og?path=about"],
    },
    alternates: {
      canonical: `${SITE}/about`,
    },
  },

  "/demo": {
    title: "Book a Free Demo — See Aura Salon Software in Action",
    description:
      "See how Aura works for your salon. Book a free 30-minute demo — we'll walk you through CRM, billing, booking, staff management and inventory.",
    openGraph: {
      title: "Book a Free Demo — Aura Salon CRM/POS",
      description: "Free 30-minute walkthrough of Aura for your salon.",
      url: `${SITE}/demo`,
      images: [{ url: "/og?path=demo", width: 1200, height: 630 }],
    },
    twitter: {
      card: "summary_large_image",
      title: "Book a Free Demo — Aura Salon CRM/POS",
      description: "Free 30-minute walkthrough.",
      images: ["/og?path=demo"],
    },
    alternates: {
      canonical: `${SITE}/demo`,
    },
  },

  "/contact": {
    title: "Contact Aura — Get in Touch with Our Salon Software Team",
    description:
      "Questions about Aura? Reach our team for demos, support, partnerships, or enterprise inquiries. We respond within 24 hours.",
    openGraph: {
      title: "Contact Aura — Salon Software Support",
      description: "Questions, demos, support — reach our team.",
      url: `${SITE}/contact`,
      images: [{ url: "/og?path=contact", width: 1200, height: 630 }],
    },
    twitter: {
      card: "summary_large_image",
      title: "Contact Aura — Get in Touch",
      description: "Questions, demos, support — reach our team.",
      images: ["/og?path=contact"],
    },
    alternates: {
      canonical: `${SITE}/contact`,
    },
  },

  "/blog": {
    title: "Aura Blog — Salon Business Tips, Guides & Industry Insights",
    description:
      "Practical guides for salon owners: increase revenue, manage staff, handle GST billing, automate marketing, and run inventory — with real examples.",
    openGraph: {
      title: "Aura Blog — Salon Business Insights",
      description: "Practical guides for salon owners on revenue, staff, GST and marketing.",
      url: `${SITE}/blog`,
      images: [{ url: "/og?path=blog", width: 1200, height: 630 }],
    },
    twitter: {
      card: "summary_large_image",
      title: "Aura Blog — Salon Business Insights",
      description: "Practical guides for salon owners.",
      images: ["/og?path=blog"],
    },
    alternates: {
      canonical: `${SITE}/blog`,
    },
  },

  "/faq": {
    title: "Frequently Asked Questions — Aura Salon CRM/POS",
    description:
      "Answers about Aura: pricing, features, GST billing, multi-branch, staff payroll, data security, online booking, imports and getting started.",
    openGraph: {
      title: "FAQ — Aura Salon CRM/POS",
      description: "Answers about pricing, features, setup and security.",
      url: `${SITE}/faq`,
      images: [{ url: "/og?path=faq", width: 1200, height: 630 }],
    },
    twitter: {
      card: "summary_large_image",
      title: "FAQ — Aura Salon CRM/POS",
      description: "Answers about pricing, features, setup and security.",
      images: ["/og?path=faq"],
    },
    alternates: {
      canonical: `${SITE}/faq`,
    },
  },

  "/customers": {
    title: "Aura Customers — Salons Growing with Connected Operations",
    description:
      "See how salons across India use Aura to manage clients, billing, staff, inventory and marketing from a single platform.",
    openGraph: {
      title: "Aura Customers — Salons Growing with Aura",
      description: "How salons across India use Aura.",
      url: `${SITE}/customers`,
      images: [{ url: "/og?path=customers", width: 1200, height: 630 }],
    },
    twitter: {
      card: "summary_large_image",
      title: "Aura Customers — Salons Growing with Aura",
      description: "How salons across India use Aura.",
      images: ["/og?path=customers"],
    },
    alternates: {
      canonical: `${SITE}/customers`,
    },
  },
};

/* ===== BLOG POST SEO ===== */
export function getBlogPostSEO(slug: string, title: string, excerpt: string, date: string, category: string): Metadata {
  return {
    title,
    description: excerpt,
    keywords: [
      `salon ${category.toLowerCase()}`, "salon tips India", "salon business guide",
      "salon software tips", title.split(" ").slice(0, 5).join(" ").toLowerCase(),
    ],
    openGraph: {
      title,
      description: excerpt,
      type: "article",
      publishedTime: date,
      tags: [category, "salon", "India"],
      url: `${SITE}/blog/${slug}`,
      images: [{ url: "/og?path=blog", width: 1200, height: 630 }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description: excerpt,
      images: ["/og?path=blog"],
    },
    alternates: {
      canonical: `${SITE}/blog/${slug}`,
    },
  };
}

/* ===== FEATURE PAGE SEO ===== */
export function getFeaturePageSEO(slug: string): Metadata {
  const FEATURES: Record<string, { title: string; description: string }> = {
    appointments: {
      title: "Smart Booking & Appointments — Online Salon Scheduling Software",
      description: "Calendar-aware booking with slot guidance, waitlists, QR check-ins and online booking portal — built for busy Indian salons.",
    },
    billing: {
      title: "POS & GST Billing — Salon Invoicing with UPI, Cards & Cash Split Payments",
      description: "GST-ready invoicing, HSN/SAC codes, split payments (UPI/card/cash/wallet), thermal printing and daily closing — all in one place.",
    },
    "client-crm": {
      title: "Customer 360 CRM — Salon Client Profiles, Loyalty & WhatsApp History",
      description: "Complete client profiles with purchase history, loyalty points, wallet balance, WhatsApp history and AI-powered recommendations.",
    },
    compliance: {
      title: "Staff Compliance — PF, ESI, TDS, Gratuity & Bonus Calculation for Salons",
      description: "Automate PF, ESI, TDS, professional tax, gratuity and bonus calculations — stay compliant without the paperwork.",
    },
    finance: {
      title: "Finance Engine — Daily Closing, Expenses, Balance Sheet & GST Reports",
      description: "Daily cash drawer closing, expense tracking, balance sheet, profit intelligence and GST-ready reports.",
    },
    inventory: {
      title: "Inventory Management — Batch Tracking, FIFO, Expiry Alerts & Reorder for Salons",
      description: "Batch tracking, FIFO costing, expiry alerts, usage-based reorder suggestions and waste records — save 30-60% on product costs.",
    },
    "marketing-ai": {
      title: "Marketing Workflows — WhatsApp, Birthday Campaigns & Re-engagement for Salons",
      description: "Automated birthday campaigns, WhatsApp sequences, re-engagement workflows and lead follow-up — marketing on autopilot.",
    },
    "staff-management": {
      title: "Staff Management — Attendance, Scheduling, Commissions & Payroll for Salons",
      description: "Face/biometric attendance, shift scheduling, commission tracking, payroll processing and performance dashboards.",
    },
    "white-label": {
      title: "White Label — Custom Branding for Salon Chains & Franchises",
      description: "White-label the customer booking portal with your salon's logo, domain, colors and brand identity — Enterprise plan.",
    },
  };

  const data = FEATURES[slug];
  if (!data) return {};

  return {
    title: data.title,
    description: data.description,
    openGraph: {
      title: data.title,
      description: data.description,
      url: `${SITE}/features/${slug}`,
      images: [{ url: `/og?path=features`, width: 1200, height: 630 }],
    },
    twitter: {
      card: "summary_large_image",
      title: data.title,
      description: data.description,
      images: ["/og?path=features"],
    },
    alternates: {
      canonical: `${SITE}/features/${slug}`,
    },
  };
}

/* ===== JSON-LD: Organization ===== */
export const organizationJsonLd = {
  "@context": "https://schema.org",
  "@type": "Organization",
  name: "Aura Salon CRM/POS",
  url: SITE,
  logo: `${SITE}/logo.png`,
  description: "Connected salon operating system for Indian salons — CRM, POS, booking, staff, inventory and finance.",
  sameAs: [],
  contactPoint: {
    "@type": "ContactPoint",
    contactType: "customer support",
    availableLanguage: ["English", "Hindi"],
  },
  address: {
    "@type": "PostalAddress",
    addressCountry: "IN",
  },
};

/* ===== JSON-LD: WebSite with SearchAction ===== */
export const websiteJsonLd = {
  "@context": "https://schema.org",
  "@type": "WebSite",
  name: "Aura Salon CRM/POS",
  url: SITE,
  potentialAction: {
    "@type": "SearchAction",
    target: `${SITE}/blog?q={search_term_string}`,
    "query-input": "required name=search_term_string",
  },
};

/* ===== JSON-LD: SoftwareApplication (enhanced) ===== */
export const softwareAppJsonLd = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: "Aura Salon CRM/POS",
  applicationCategory: "BusinessApplication",
  operatingSystem: "Web",
  description:
    "Connected CRM, POS, customer booking, staff attendance and payroll, inventory, finance and branch-aware operations for Indian salons.",
  url: SITE,
  offers: [
    {
      "@type": "AggregateOffer",
      lowPrice: "999",
      highPrice: "2499",
      priceCurrency: "INR",
      offerCount: 3,
      offers: [
        {
          "@type": "Offer",
          name: "Starter",
          price: "999",
          priceCurrency: "INR",
          priceSpecification: {
            "@type": "UnitPriceSpecification",
            price: "999",
            priceCurrency: "INR",
            billingDuration: "P1M",
          },
          description: "For single-branch salons — CRM, booking, POS, basic reports",
        },
        {
          "@type": "Offer",
          name: "Growth",
          price: "2499",
          priceCurrency: "INR",
          priceSpecification: {
            "@type": "UnitPriceSpecification",
            price: "2499",
            priceCurrency: "INR",
            billingDuration: "P1M",
          },
          description: "Up to 5 branches — Staff OS, inventory, marketing, finance, Customer 360",
        },
        {
          "@type": "Offer",
          name: "Enterprise",
          price: "0",
          priceCurrency: "INR",
          description: "Custom pricing for unlimited branches — white label, compliance, franchise management",
        },
      ],
    },
  ],
  aggregateRating: {
    "@type": "AggregateRating",
    ratingValue: "4.8",
    ratingCount: "150",
    bestRating: "5",
    worstRating: "1",
  },
  screenshot: `${SITE}/screenshot.png`,
  featureList: [
    "Smart Booking & Appointments",
    "GST-Ready POS & Billing",
    "Client CRM with 360 View",
    "Staff Attendance & Payroll",
    "Inventory Management",
    "Marketing Automation",
    "Finance Engine & Balance Sheet",
    "Multi-Branch Operations",
    "Online Booking Portal",
    "Customer Mobile App",
    "Staff Mobile App",
    "WhatsApp Integration",
  ],
};

/* ===== JSON-LD: BreadcrumbList ===== */
export function breadcrumbJsonLd(items: { name: string; url: string }[]) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: item.name,
      item: `${SITE}${item.url}`,
    })),
  };
}
