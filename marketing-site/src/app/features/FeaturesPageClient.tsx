"use client";

import { motion } from "motion/react";
import Link from "next/link";
import {
  Calendar, CreditCard, Users, UserCheck, Package, Megaphone, TrendingUp, ShieldCheck, Palette,
} from "lucide-react";
import { FEATURES_OVERVIEW } from "@/lib/constants";
import { Container } from "@/components/ui/Container";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { staggerContainer, staggerChild } from "@/lib/animations";
import { useLanguage } from "@/components/providers/LanguageProvider";
import { FEATURE_OVERVIEW_HI } from "@/lib/translations";

const iconMap: Record<string, React.ComponentType<{ className?: string; style?: React.CSSProperties }>> = {
  calendar: Calendar,
  "credit-card": CreditCard,
  users: Users,
  "user-check": UserCheck,
  package: Package,
  megaphone: Megaphone,
  "trending-up": TrendingUp,
  "shield-check": ShieldCheck,
  palette: Palette,
};

export default function FeaturesPage() {
  const { language, t } = useLanguage();
  return (
    <>
      <section className="pt-28 pb-20 md:pt-36 md:pb-28 bg-gradient-to-b from-aura-bg to-white">
        <Container>
          <SectionHeading
            badge={t("features.badge")}
            title={t("features.pageTitle")}
            subtitle={t("features.pageBody")}
          />
        </Container>
      </section>

      <section className="pb-20 md:pb-28 bg-white">
        <Container>
          <motion.div
            variants={staggerContainer}
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: "-80px" }}
            className="grid md:grid-cols-2 lg:grid-cols-3 gap-6 max-w-5xl mx-auto"
          >
            {FEATURES_OVERVIEW.map((feature, featureIndex) => {
              const Icon = iconMap[feature.icon] || Calendar;
              const translated = language === "hi" ? FEATURE_OVERVIEW_HI[featureIndex] : undefined;
              return (
                <motion.div key={feature.title} variants={staggerChild}>
                  <Link href={feature.href} className="block group">
                    <div className="glow-card h-full rounded-2xl border border-aura-border bg-white p-8 transition-all duration-300 hover:shadow-xl hover:border-transparent hover:-translate-y-1">
                      <div
                        className="w-14 h-14 rounded-2xl flex items-center justify-center mb-5 transition-transform duration-300 group-hover:scale-110"
                        style={{ backgroundColor: `${feature.color}12` }}
                      >
                        <Icon className="w-7 h-7" style={{ color: feature.color }} />
                      </div>
                      <h3 className="text-lg font-bold text-aura-text mb-2 group-hover:text-neon-violet transition-colors">
                        {translated?.title ?? feature.title}
                      </h3>
                      <p className="text-sm text-aura-text-secondary leading-relaxed">
                        {translated?.description ?? feature.description}
                      </p>
                      <div className="mt-4 text-sm font-semibold text-neon-violet opacity-0 group-hover:opacity-100 transition-opacity">
                        {t("features.learn")} →
                      </div>
                    </div>
                  </Link>
                </motion.div>
              );
            })}
          </motion.div>
        </Container>
      </section>
    </>
  );
}
