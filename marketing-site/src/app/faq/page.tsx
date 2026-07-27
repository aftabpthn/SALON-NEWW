import type { Metadata } from "next";
import FAQPageContent from "./FAQPageContent";

export const metadata: Metadata = {
  title: "Frequently Asked Questions",
  description: "Answers to common questions about Aura Salon CRM/POS — pricing, features, setup, data security, multi-branch support and more.",
  openGraph: {
    title: "FAQ — Aura Salon CRM/POS",
    description: "Answers to common questions about Aura Salon CRM/POS — pricing, features, setup and more.",
    images: [{ url: "/og?path=faq", width: 1200, height: 630 }],
  },
};

const FAQ_DATA = [
  {
    q: "What is Aura?",
    a: "Aura is a connected salon operating system. Owner CRM and POS, customer booking, staff attendance and payroll, inventory, finance and branch-aware operations run around the same salon day — no double entry, no gaps.",
  },
  {
    q: "Is Aura only for large salon chains?",
    a: "No. Solo salon owners, 2-branch setups and multi-location chains all use Aura. The Starter plan covers single-branch salons. Growth supports up to 5 branches. Enterprise handles unlimited branches with custom pricing.",
  },
  {
    q: "How does multi-branch work?",
    a: "Every record — appointments, invoices, staff, inventory, expenses — carries a tenant and branch ID. Owners see a consolidated dashboard. Branch managers see only their location. Cross-branch analytics are available at the Growth tier.",
  },
  {
    q: "Does Aura support GST billing?",
    a: "Yes. Aura generates GST-ready invoices with HSN/SAC context, calculates CGST/SGST or IGST, and creates GST report summaries. Filing is done through your CA or the government portal — Aura prepares the data.",
  },
  {
    q: "Can clients book online?",
    a: "Yes. The online booking portal is a public, pay-at-salon flow. Clients choose services, pick a professional, select a slot, and confirm — no payment upfront. Bookings appear instantly on the owner's calendar.",
  },
  {
    q: "Is there a mobile app for staff?",
    a: "Yes. The Staff App supports secure attendance (Android-only face/biometric), shift viewing, commission tracking and performance dashboards. iOS users can access a web-based attendance flow.",
  },
  {
    q: "What about data security?",
    a: "Aura uses encrypted data, role-based access control, multi-tenancy isolation, and regular backups. JWT refresh tokens secure API access. The system runs on compliant cloud infrastructure.",
  },
  {
    q: "Can I import data from another tool?",
    a: "Aura supports bulk import for clients, services, staff and inventory through structured CSV templates. The import system validates data and reports errors before writing to the database.",
  },
  {
    q: "How do I get started?",
    a: "Book a free demo. We'll walk you through the platform, help you set up your services and staff, and migrate your existing client data if needed. Every plan starts with a 14-day free trial — no credit card required.",
  },
  {
    q: "What payment methods does Aura accept?",
    a: "Aura processes payments through Razorpay — UPI, credit/debit cards, net banking and bank transfers. All transactions are secured with bank-grade encryption.",
  },
  {
    q: "Does Aura handle staff payroll?",
    a: "Yes. Growth and Enterprise plans include attendance tracking, shift scheduling, commission calculation, and payroll processing. Aura calculates PF, ESI, TDS, professional tax, gratuity and bonus where applicable.",
  },
  {
    q: "Can I white-label the customer app?",
    a: "White-label branding — custom domain, logo, colors — is available on the Enterprise plan. The customer-facing booking portal can carry your salon's brand identity.",
  },
];

export default function FAQPage() {
  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: FAQ_DATA.map((item) => ({
      "@type": "Question",
      name: item.q,
      acceptedAnswer: {
        "@type": "Answer",
        text: item.a,
      },
    })),
  };

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
      />
      <FAQPageContent faqData={FAQ_DATA} />
    </>
  );
}
