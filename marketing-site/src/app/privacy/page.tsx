import Link from "next/link";
import { Container } from "@/components/ui/Container";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: "Aura Salon CRM/POS privacy policy — how we collect, use and protect your data.",
};

export default function PrivacyPage() {
  return (
    <>
      <section className="pt-28 pb-12 md:pt-36 md:pb-16 bg-[#f5f0e8]">
        <Container>
          <Link href="/" className="inline-flex items-center gap-1 text-xs font-semibold text-aura-burgundy mb-6 hover:underline">&larr; Back to Aura</Link>
          <h1 className="font-display text-4xl md:text-5xl tracking-tight text-aura-text">Privacy Policy</h1>
          <p className="mt-3 text-sm text-aura-text-muted">Last updated: July 2026</p>
        </Container>
      </section>
      <section className="pb-20 bg-white">
        <Container size="narrow">
          <article className="prose prose-aura max-w-none text-aura-text-secondary prose-headings:text-aura-text prose-h2:text-2xl prose-h2:font-display prose-h3:text-lg prose-a:text-aura-burgundy prose-strong:text-aura-text">
            <h2>1. Who we are</h2>
            <p>Aura is a salon management platform built for Indian salons. We provide appointment scheduling, point-of-sale billing, customer relationship management, staff management, inventory tracking, finance tools and branch-aware operations through a web and mobile interface.</p>
            <p>When this policy mentions &ldquo;Aura,&rdquo; &quot;we,&quot; or &quot;us,&quot; it refers to the team operating the Aura platform.</p>

            <h2>2. What data we collect</h2>
            <h3>Account and business data</h3>
            <p>When a salon owner or staff member creates an account, we collect name, email address, phone number, salon name, branch details and role/permission settings. This information is necessary to provide the service.</p>
            <h3>Customer data entered by salons</h3>
            <p>Salons may enter their customers&apos; names, phone numbers, visit history, preferences, allergies and consultation notes into Aura. This data belongs to the salon. We process it on their behalf to provide CRM, booking and billing features.</p>
            <h3>Booking and transaction data</h3>
            <p>Appointments, invoices, payments, staff assignments, attendance records and inventory movements are stored as part of normal platform operation.</p>
            <h3>Device and usage data</h3>
            <p>We collect standard web logs, browser type, device information and page interaction data to maintain and improve the platform. We do not sell this data to advertisers.</p>

            <h2>3. How we use your data</h2>
            <ul>
              <li>To provide and maintain the Aura platform</li>
              <li>To process bookings, billing and staff operations</li>
              <li>To send transactional notifications (appointment confirmations, reminders) through configured channels</li>
              <li>To detect and prevent security issues</li>
              <li>To communicate about your account and service updates</li>
            </ul>

            <h2>4. Data ownership</h2>
            <p>Your salon&apos;s data belongs to you. When you enter customer records, staff information, financial data or any other business content into Aura, you retain ownership. We do not use your business data to train models, build profiles for advertising or share with competitors.</p>

            <h2>5. Data sharing</h2>
            <p>We share data only when:</p>
            <ul>
              <li>You explicitly configure an integration (WhatsApp provider, payment gateway, SMS service)</li>
              <li>Required by law or valid legal process</li>
              <li>Necessary to protect the safety of our users or the public</li>
              <li>Needed to operate core platform functions (hosting, database, infrastructure providers under appropriate agreements)</li>
            </ul>
            <p>We do not sell personal data to third parties.</p>

            <h2>6. Data security</h2>
            <p>Aura uses industry-standard measures: encrypted connections (TLS), hashed passwords, role-based access controls, tenant-isolated records and branch-scoped permissions. We support two-factor authentication and passkey login for additional account security.</p>
            <p>No system is completely secure. If you discover a security issue, please report it to us promptly.</p>

            <h2>7. Data retention</h2>
            <p>We retain your data while your account is active and for a reasonable period afterward to support account recovery and legal obligations. You can request data deletion by contacting us, subject to any legal retention requirements.</p>

            <h2>8. Your rights</h2>
            <p>Depending on applicable law, you may have the right to access, correct, export or delete your data. Contact us to exercise these rights.</p>

            <h2>9. Changes to this policy</h2>
            <p>We may update this policy as the platform evolves. Significant changes will be communicated through the platform or by email.</p>

            <h2>10. Contact</h2>
            <p>Questions about this policy can be sent through our <Link href="/contact">contact page</Link>.</p>
          </article>
        </Container>
      </section>
    </>
  );
}
