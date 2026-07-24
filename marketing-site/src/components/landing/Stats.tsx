"use client";

import { motion } from "motion/react";
import { Container } from "@/components/ui/Container";
import { useLanguage } from "@/components/providers/LanguageProvider";

export function Stats() {
  const { t } = useLanguage();
  const foundations = ["tenant", "branch", "realtime", "dates"];
  return (
    <section className="bg-aura-dark-elevated py-16 text-white md:py-20">
      <Container>
        <div className="mb-8 max-w-2xl"><p className="text-[10px] font-bold uppercase tracking-[.16em] text-aura-copper">{t("foundation.badge")}</p><h2 className="mt-3 font-display text-3xl font-normal sm:text-4xl">{t("foundation.title")}</h2></div>
        <div className="grid border-l border-t border-white/10 sm:grid-cols-2 lg:grid-cols-4">{foundations.map((item, index) => <motion.article key={item} initial={{ opacity: 0, y: 12 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: .4, delay: index * .05 }} className="border-b border-r border-white/10 p-5 sm:p-6"><span className="font-display text-2xl text-aura-cream">0{index + 1}</span><h3 className="mt-5 text-sm font-semibold">{t(`foundation.${item}`)}</h3><p className="mt-2 text-xs leading-5 text-white/45">{t(`foundation.${item}.body`)}</p></motion.article>)}</div>
      </Container>
    </section>
  );
}
