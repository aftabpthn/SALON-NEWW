"use client";

import { motion } from "motion/react";
import {
  Calendar, CreditCard, Users, Package, Megaphone,
  TrendingUp, ShieldCheck, Palette, Check, ArrowRight,
} from "lucide-react";
import { Container } from "@/components/ui/Container";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { Button } from "@/components/ui/Button";
import { GridBackground } from "@/components/ui/GridBackground";
import { CTA_LINKS } from "@/lib/constants";
import { staggerContainer, staggerChild } from "@/lib/animations";
import type { FeaturePageData } from "@/lib/types";
import { useLanguage } from "@/components/providers/LanguageProvider";
import { FEATURE_MESSAGES_HI } from "@/lib/translations";

const CAPABILITY_ICONS = [
  Calendar, CreditCard, Users, Package, Megaphone,
  TrendingUp, ShieldCheck, Palette, Check,
];

interface FeaturePageTemplateProps {
  data: FeaturePageData;
}

export function FeaturePageTemplate({ data }: FeaturePageTemplateProps) {
  const { language, t } = useLanguage();
  const translated = language === "hi" ? FEATURE_MESSAGES_HI[data.translationKey] : undefined;
  const title = translated?.title ?? data.title;
  const subtitle = translated?.subtitle ?? data.subtitle;
  const capabilities = translated?.capabilities ?? data.capabilities;
  const interpolate = (text: string) => text.replace("{name}", title);

  return (
    <>
      <section className="relative pt-28 pb-20 md:pt-40 md:pb-28 bg-aura-bg overflow-hidden">
        <GridBackground className="opacity-30" />

        <Container className="relative z-10">
          <motion.div
            initial={{ opacity: 0, y: 40 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
            className="max-w-5xl"
          >
            <span className="inline-flex items-center gap-2 text-[11px] font-bold uppercase tracking-[.18em] text-aura-burgundy mb-6 before:h-px before:w-6 before:bg-aura-amber">
              {t("feature.spotlight")}
            </span>
            <h1 className="max-w-4xl font-display text-[clamp(3rem,7vw,6.8rem)] font-normal tracking-[-.05em] text-aura-text leading-[.94] text-balance">
              {title}
            </h1>
            <p className="mt-7 text-base md:text-xl text-aura-text-secondary max-w-2xl leading-relaxed">
              {subtitle}
            </p>
          </motion.div>
        </Container>
      </section>

      {data.stats && (
        <section className="py-12 bg-white border-y border-aura-border">
          <Container>
            <div className="grid grid-cols-1 divide-y divide-aura-border sm:grid-cols-3 sm:divide-x sm:divide-y-0 max-w-4xl mx-auto">
              {data.stats.map((stat, i) => (
                <motion.div
                  key={stat.label}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.3 + i * 0.1, duration: 0.5 }}
                  className="px-4 py-5 text-center"
                >
                  <div className="font-display text-3xl md:text-4xl text-aura-burgundy">{stat.value}</div>
                  <div className="text-sm text-aura-text-muted mt-1">{translated?.stats[i] ?? stat.label}</div>
                </motion.div>
              ))}
            </div>
          </Container>
        </section>
      )}

      <section className="py-20 md:py-28 bg-aura-cream">
        <Container>
          <SectionHeading
            badge={t("feature.capabilities")}
            title={t("feature.what")}
            subtitle={t("feature.whatBody")}
          />
          <motion.div
            variants={staggerContainer}
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: "-80px" }}
            className="mt-16 grid md:grid-cols-2 border-l border-t border-aura-border max-w-6xl"
          >
            {capabilities.map((cap, i) => {
              const Icon = CAPABILITY_ICONS[i % CAPABILITY_ICONS.length];
              return (
                <motion.div
                  key={cap.title}
                  variants={staggerChild}
                  className="group border-b border-r border-aura-border bg-aura-cream p-6 sm:p-8 lg:p-10 transition-colors duration-300 hover:bg-aura-bg"
                >
                  <div className="w-10 h-10 rounded-full bg-aura-rose-soft flex items-center justify-center mb-8 group-hover:scale-105 transition-transform duration-300">
                    <Icon className="w-5 h-5 text-aura-burgundy" />
                  </div>
                  <h3 className="text-lg font-bold text-aura-text mb-2">{cap.title}</h3>
                  <p className="text-sm text-aura-text-secondary leading-relaxed">{cap.description}</p>
                </motion.div>
              );
            })}
          </motion.div>
        </Container>
      </section>

      <section className="py-20 bg-white">
        <Container>
          <motion.div
            initial={{ opacity: 0, y: 40 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.7 }}
            className="text-center"
          >
            <h2 className="text-2xl md:text-3xl font-bold text-aura-text mb-4">
              {interpolate(t("feature.experience"))}
            </h2>
            <p className="text-aura-text-secondary mb-8 max-w-xl mx-auto">
              {interpolate(t("feature.experienceBody"))}
            </p>
            <a href={CTA_LINKS.trial}>
              <Button variant="primary" size="lg">
                {t("feature.demo")}
                <ArrowRight className="w-4 h-4 ml-1" />
              </Button>
            </a>
          </motion.div>
        </Container>
      </section>
    </>
  );
}
