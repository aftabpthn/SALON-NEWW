import Link from "next/link";
import { Container } from "@/components/ui/Container";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Cookie Policy",
  description: "Aura Salon CRM/POS cookie policy — how we use cookies and similar technologies.",
};

export default function CookiePolicyPage() {
  return (
    <>
      <section className="pt-28 pb-12 md:pt-36 md:pb-16 bg-[#f5f0e8]">
        <Container>
          <Link href="/" className="inline-flex items-center gap-1 text-xs font-semibold text-aura-burgundy mb-6 hover:underline">&larr; Back to Aura</Link>
          <h1 className="font-display text-4xl md:text-5xl tracking-tight text-aura-text">Cookie Policy</h1>
          <p className="mt-3 text-sm text-aura-text-muted">Last updated: July 2026</p>
        </Container>
      </section>
      <section className="pb-20 bg-white">
        <Container size="narrow">
          <article className="prose prose-aura max-w-none text-aura-text-secondary prose-headings:text-aura-text prose-h2:text-2xl prose-h2:font-display prose-h3:text-lg prose-a:text-aura-burgundy prose-strong:text-aura-text">
            <h2>What are cookies</h2>
            <p>Cookies are small text files placed on your device when you visit a website. They help the site remember your actions and preferences over time.</p>

            <h2>How Aura uses cookies</h2>
            <p>Aura uses cookies and similar storage technologies for the following purposes:</p>

            <h3>Essential cookies</h3>
            <p>These keep you logged in, maintain your session, remember your branch selection and ensure secure access to the platform. They are necessary for the service to function.</p>

            <h3>Preference cookies</h3>
            <p>These remember your language choice (English or Hindi), business type selection and display preferences so you don&apos;t have to set them every time.</p>

            <h3>Analytics cookies</h3>
            <p>If analytics are configured, we may use cookies to understand how the platform is used — which pages are visited, where users spend time and where they leave. This helps us improve the product. Analytics data is aggregated and does not identify individual users.</p>

            <h2>Third-party cookies</h2>
            <p>If you configure integrations such as payment gateways or messaging providers, those services may set their own cookies according to their own policies. We do not control third-party cookies.</p>

            <h2>Managing cookies</h2>
            <p>You can control or delete cookies through your browser settings. Disabling essential cookies may prevent you from using Aura effectively.</p>

            <h2>Changes to this policy</h2>
            <p>We may update this cookie policy as the platform evolves. Changes will be reflected on this page.</p>

            <h2>Contact</h2>
            <p>Questions about cookies can be sent through our <Link href="/contact">contact page</Link>.</p>
          </article>
        </Container>
      </section>
    </>
  );
}
