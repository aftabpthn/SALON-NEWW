"use client";

import { useRef } from "react";
import Link from "next/link";
import { motion, useInView } from "motion/react";
import { ArrowRight } from "lucide-react";
import { CTA_LINKS } from "@/lib/constants";
import { Container } from "@/components/ui/Container";
import { Button } from "@/components/ui/Button";
import { useLanguage } from "@/components/providers/LanguageProvider";

export function CTASection() {
  const { t } = useLanguage();
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-80px" });

  return (
    <section ref={ref} className="relative py-20 md:py-28 bg-aura-surface overflow-hidden">
      <Container>
        <motion.div
          initial={{ opacity: 0, y: 50 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1] }}
          className="relative overflow-hidden rounded-[1.75rem] border border-white/10 bg-aura-dark-elevated"
        >
          <div className="absolute inset-y-0 right-0 w-2/5 border-l border-white/10 opacity-50 [background-image:linear-gradient(rgba(255,255,255,.08)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.08)_1px,transparent_1px)] [background-size:48px_48px]" aria-hidden="true" />

          {/* Content with parallax */}
          <div className="relative z-10 grid gap-10 p-6 sm:p-10 md:p-14 lg:grid-cols-[1.4fr_.6fr] lg:items-end lg:p-16">
            <motion.div
              initial={{ opacity: 0, y: 30 }}
              animate={inView ? { opacity: 1, y: 0 } : {}}
              transition={{ duration: 0.7, delay: 0.2 }}
            >
              <h2 className="max-w-3xl font-display text-[clamp(2.6rem,6vw,5.5rem)] font-normal leading-[1.04] tracking-[-.035em] text-white text-balance">
                {t("cta.title")}
              </h2>
              <p className="mt-6 text-base leading-7 text-white/55 max-w-2xl">
                {t("cta.body")}
              </p>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={inView ? { opacity: 1, y: 0 } : {}}
              transition={{ duration: 0.6, delay: 0.4 }}
              className="flex flex-col items-stretch gap-3 sm:flex-row lg:flex-col"
            >
              <Button
                asChild
                variant="primary"
                size="lg"
                className="bg-aura-cta-cream text-aura-burgundy hover:bg-white shadow-lg sm:inline-flex"
              >
                <Link href={CTA_LINKS.trial} className="group">
                  {t("cta.primary")}
                  <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-1" />
                </Link>
              </Button>
              <Button
                asChild
                variant="outline"
                size="lg"
                className="border-white/20 text-white hover:bg-white/10 sm:inline-flex"
              >
                <Link href="/features">{t("cta.secondary")}</Link>
              </Button>
            </motion.div>

            <motion.div
              initial={{ opacity: 0 }}
              animate={inView ? { opacity: 1 } : {}}
              transition={{ delay: 0.6 }}
              className="col-span-full flex flex-wrap gap-x-6 gap-y-2 border-t border-white/10 pt-6 text-xs text-white/40"
            >
              <span>{t("cta.meta1")}</span><span aria-hidden="true">·</span><span>{t("cta.meta2")}</span><span aria-hidden="true">·</span><span>{t("cta.meta3")}</span>
            </motion.div>
          </div>
        </motion.div>
      </Container>
    </section>
  );
}
