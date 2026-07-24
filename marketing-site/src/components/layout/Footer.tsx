"use client";

import Link from "next/link";
import { useRef } from "react";
import { motion, useInView } from "motion/react";
import { FOOTER_LINKS, CTA_LINKS } from "@/lib/constants";
import { Newsletter } from "./Newsletter";
import { useLanguage } from "@/components/providers/LanguageProvider";

const footerSections = [
  { title: "Product", links: FOOTER_LINKS.product },
  { title: "Company", links: FOOTER_LINKS.company },
  { title: "Resources", links: FOOTER_LINKS.resources },
  { title: "Legal", links: FOOTER_LINKS.legal },
];

const footerLabelKeys: Record<string, string> = {
  Platform: "nav.platform", "Owner CRM": "nav.owner-crm", "Customer App": "nav.customer-app", "Staff App": "nav.staff-app", Workflows: "nav.workflows",
  Features: "footer.features", Pricing: "footer.pricing", Customers: "footer.customers", Demo: "footer.demo", Integrations: "footer.integrations",
  "About Us": "footer.aboutUs", Blog: "footer.blog", Contact: "footer.contact", Careers: "footer.careers", Documentation: "footer.documentation",
  "Help Center": "footer.help", "Status Page": "footer.status", "API Reference": "footer.api", FAQ: "footer.faq", "Privacy Policy": "footer.privacy",
  "Terms of Service": "footer.terms", "Cookie Policy": "footer.cookies",
};

export function Footer() {
  const { t } = useLanguage();
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-50px" });

  return (
    <footer ref={ref} className="relative bg-aura-dark text-white/70 overflow-hidden">
      {/* Subtle mesh gradient background */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-0 left-1/4 w-96 h-96 rounded-full bg-aura-burgundy/5 blur-[150px]" />
        <div className="absolute bottom-0 right-1/4 w-80 h-80 rounded-full bg-aura-rose/4 blur-[120px]" />
      </div>

      {/* CTA Banner */}
      <div className="relative border-b border-white/10">
        <div className="mx-auto max-w-[82rem] px-4 sm:px-6 lg:px-10 py-16 md:py-20 text-left">
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={inView ? { opacity: 1, y: 0 } : {}}
            transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
          >
            <h2 className="max-w-4xl font-display text-[clamp(2.7rem,6vw,5.6rem)] font-normal tracking-[-.035em] text-white mb-5 leading-[1.04]">
              {t("footer.title")}
            </h2>
            <p className="text-base md:text-lg text-white/50 mb-8 max-w-2xl">
              {t("footer.body")}
            </p>
            <Link href={CTA_LINKS.trial} className="inline-flex min-h-12 items-center rounded-full bg-aura-cta-cream px-7 text-sm font-semibold text-aura-burgundy shadow-lg transition-colors duration-300 hover:bg-white">{t("nav.trial")}</Link>
          </motion.div>
        </div>
      </div>

      {/* Footer Grid */}
      <div className="relative mx-auto max-w-[82rem] px-4 sm:px-6 lg:px-10 py-14 md:py-16">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-8 lg:gap-12">
          {/* Brand Column */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={inView ? { opacity: 1, y: 0 } : {}}
            transition={{ duration: 0.5, delay: 0.1 }}
            className="col-span-2 md:col-span-1"
          >
            <Link href="/" className="flex items-center gap-2.5 mb-4 group">
              <div className="flex h-9 w-9 items-center justify-center rounded-full bg-aura-burgundy text-white font-display italic text-lg group-hover:scale-105 transition-transform duration-300">
                A
              </div>
              <span className="text-lg font-bold text-white tracking-tight">Aura</span>
            </Link>
            <p className="text-sm text-white/40 leading-relaxed mb-6">
              {t("footer.about")}
            </p>
            <div className="flex flex-wrap gap-2 text-[10px] uppercase tracking-[.12em] text-white/35"><span>{t("nav.owner-crm")}</span><span>·</span><span>{t("nav.customer-app")}</span><span>·</span><span>{t("nav.staff-app")}</span></div>
            <div className="mt-6">
              <Newsletter />
            </div>
          </motion.div>

          {/* Link Columns */}
          {footerSections.map((section, si) => (
            <motion.div
              key={section.title}
              initial={{ opacity: 0, y: 20 }}
              animate={inView ? { opacity: 1, y: 0 } : {}}
              transition={{ duration: 0.5, delay: 0.15 + si * 0.05 }}
            >
              <h3 className="text-sm font-semibold text-white mb-4 uppercase tracking-wider">
                {t(`footer.${section.title.toLowerCase()}`)}
              </h3>
              <ul className="space-y-3">
                {section.links.map((link) => (
                  <li key={link.label}>
                    <Link
                      href={link.href}
                      className="text-sm text-white/40 hover:text-white transition-colors duration-200"
                    >
                      {t(footerLabelKeys[link.label] ?? link.label)}
                    </Link>
                  </li>
                ))}
              </ul>
            </motion.div>
          ))}
        </div>

        {/* Bottom Bar */}
        <div className="mt-16 pt-8 border-t border-white/10 flex flex-col md:flex-row items-center justify-between gap-4">
          <p className="text-sm text-white/30">
            &copy; {new Date().getFullYear()} Aura Salon CRM/POS. {t("footer.rights")}
          </p>
          <div className="flex items-center gap-6">
            <Link href="/privacy" className="text-sm text-white/30 hover:text-white/60 transition-colors">{t("footer.privacy")}</Link>
            <Link href="/terms" className="text-sm text-white/30 hover:text-white/60 transition-colors">{t("footer.terms")}</Link>
            <Link href="/cookies" className="text-sm text-white/30 hover:text-white/60 transition-colors">{t("footer.cookies")}</Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
