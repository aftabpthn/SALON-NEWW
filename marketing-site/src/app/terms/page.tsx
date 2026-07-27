import Link from "next/link";
import { Container } from "@/components/ui/Container";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Terms of Service",
  description: "Aura Salon CRM/POS terms of service — the agreement governing your use of the platform.",
};

export default function TermsPage() {
  return (
    <>
      <section className="pt-28 pb-12 md:pt-36 md:pb-16 bg-[#f5f0e8]">
        <Container>
          <Link href="/" className="inline-flex items-center gap-1 text-xs font-semibold text-aura-burgundy mb-6 hover:underline">&larr; Back to Aura</Link>
          <h1 className="font-display text-4xl md:text-5xl tracking-tight text-aura-text">Terms of Service</h1>
          <p className="mt-3 text-sm text-aura-text-muted">Last updated: July 2026</p>
        </Container>
      </section>
      <section className="pb-20 bg-white">
        <Container size="narrow">
          <article className="prose prose-aura max-w-none text-aura-text-secondary prose-headings:text-aura-text prose-h2:text-2xl prose-h2:font-display prose-h3:text-lg prose-a:text-aura-burgundy prose-strong:text-aura-text">
            <h2>1. Agreement</h2>
            <p>By using Aura, you agree to these terms. If you are using Aura on behalf of a salon or business, you represent that you have the authority to bind that entity to these terms.</p>

            <h2>2. The service</h2>
            <p>Aura provides salon management tools including appointment scheduling, point-of-sale billing, customer management, staff operations, inventory tracking, marketing automation and finance reporting. Features may change as the platform evolves.</p>

            <h2>3. Your account</h2>
            <p>You are responsible for maintaining the security of your account credentials. You must not share login details with unauthorized persons. You are responsible for all activity that occurs under your account.</p>

            <h2>4. Your data</h2>
            <p>You own the data you enter into Aura. We process it to provide the service. We will not access, use or share your business data except as necessary to provide the service or as required by law.</p>

            <h2>5. Acceptable use</h2>
            <p>You agree not to:</p>
            <ul>
              <li>Use Aura for any unlawful purpose</li>
              <li>Attempt to gain unauthorized access to other accounts or systems</li>
              <li>Interfere with or disrupt the platform</li>
              <li>Reverse engineer or attempt to extract source code</li>
              <li>Use the platform to send unsolicited communications</li>
            </ul>

            <h2>6. Billing and payments</h2>
            <p>Aura offers plans with recurring billing. Prices are listed on our <Link href="/pricing">pricing page</Link>. You are responsible for applicable taxes. Payment processing is handled by third-party providers; we do not store card details on our servers.</p>

            <h2>7. Cancellation</h2>
            <p>You may cancel your subscription through your account settings. Cancellation takes effect at the end of the current billing period. We do not provide partial refunds for unused time unless required by law.</p>

            <h2>8. Service availability</h2>
            <p>We work to keep Aura available but cannot guarantee 100% uptime. Scheduled maintenance will be communicated in advance when possible. We are not liable for data loss caused by circumstances beyond reasonable control.</p>

            <h2>9. Limitation of liability</h2>
            <p>Aura is provided &ldquo;as is&rdquo; for its intended purpose. We are not liable for indirect, incidental or consequential damages. Our total liability shall not exceed the amount you paid for the service in the twelve months preceding the claim.</p>

            <h2>10. Changes to terms</h2>
            <p>We may update these terms as the platform evolves. Continued use of Aura after changes constitutes acceptance of the updated terms.</p>

            <h2>11. Contact</h2>
            <p>Questions about these terms can be sent through our <Link href="/contact">contact page</Link>.</p>
          </article>
        </Container>
      </section>
    </>
  );
}
