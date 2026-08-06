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
    a: "Aura is a connected salon operating system. Owner CRM and POS, pay-at-salon customer booking, qualified staff operations, inventory, finance and branch-aware records are designed around the same salon day.",
  },
  {
    q: "Is Aura only for large salon chains?",
    a: "Aura plans are structured for a single branch, growing operations up to five branches, and proposal-based enterprise operations. Confirm fit and final scope in a demo and proposal.",
  },
  {
    q: "How does multi-branch work?",
    a: "Operational records carry tenant and branch context. Access is designed around authorised roles and locations; exact cross-branch permissions and settlement rules should be verified for your configuration.",
  },
  {
    q: "Does Aura support GST billing?",
    a: "Yes. Aura generates GST-ready invoices with HSN/SAC context, calculates CGST/SGST or IGST, and creates GST report summaries. Filing is done through your CA or the government portal — Aura prepares the data.",
  },
  {
    q: "Can clients book online?",
    a: "Yes. The current public booking story is pay at salon: clients choose a service, professional and slot, then confirm without online prepayment.",
  },
  {
    q: "Is there a mobile app for staff?",
    a: "The Staff App supports a qualified workday journey. Secure attendance is Android-only when owner policy and configuration enable it. Roster, tasks, leave, communication and permitted attribution context are included in the current story; complete iOS attendance is not claimed.",
  },
  {
    q: "What about data security?",
    a: "Aura is designed around tenant and branch isolation, role-based access and audit trails. Hosting, encryption, backup, retention and compliance commitments are confirmed in the proposal and data-processing terms.",
  },
  {
    q: "Can I import data from another tool?",
    a: "Data preparation and agreed imports are part of the onboarding process. Source formats, validation, correction responsibility and migration scope are confirmed during assessment.",
  },
  {
    q: "How do I get started?",
    a: "Request a demo. The team will review your workflow, then confirm assessment, data preparation, configuration, role training, go-live checks and any suitable trial access in the proposal.",
  },
  {
    q: "What payment methods does Aura accept?",
    a: "Subscription payment methods and payment-provider details are confirmed in the proposal. Customer bookings shown on this site use the pay-at-salon flow.",
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
