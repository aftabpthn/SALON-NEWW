"use client";

import { ArrowRight, CheckCircle2, FileCheck2 } from "lucide-react";
import { Container } from "@/components/ui/Container";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { Button } from "@/components/ui/Button";
import { GridBackground } from "@/components/ui/GridBackground";
import { useLanguage } from "@/components/providers/LanguageProvider";
import { CTA_LINKS } from "@/lib/constants";

export default function CustomersPage() {
  const { t } = useLanguage();
  const evidence = ["identity", "workflow", "outcome", "permission"];
  const workflows = ["appointments", "customer", "pos", "inventory"];
  return <>
    <section className="relative overflow-hidden bg-gradient-to-b from-aura-bg to-white pb-16 pt-28 md:pb-20 md:pt-36"><GridBackground className="opacity-30" /><Container className="relative z-10"><SectionHeading badge={t("customers.badge")} title={t("customerProof.title")} subtitle={t("customerProof.body")} /></Container></section>
    <section className="bg-white pb-20 md:pb-28"><Container><div className="mx-auto grid max-w-5xl border-l border-t border-aura-border sm:grid-cols-2">{evidence.map((item) => <article key={item} className="border-b border-r border-aura-border p-6 sm:p-8"><FileCheck2 className="h-5 w-5 text-aura-burgundy" /><h2 className="mt-5 font-display text-2xl text-aura-text">{t(`customerProof.${item}`)}</h2><p className="mt-2 text-sm leading-6 text-aura-text-secondary">{t(`customerProof.${item}.body`)}</p></article>)}</div></Container></section>
    <section className="bg-aura-bg py-20 md:py-28"><Container><SectionHeading badge={t("customers.cases")} title={t("customerProof.workflowTitle")} subtitle={t("customerProof.workflowBody")} /><div className="mx-auto mt-12 grid max-w-5xl gap-3 md:grid-cols-2">{workflows.map((item) => <article key={item} data-case-study-slot={item} className="flex items-start gap-4 rounded-2xl border border-aura-border bg-white p-5"><CheckCircle2 className="mt-1 h-5 w-5 shrink-0 text-aura-success" /><div><h3 className="font-semibold text-aura-text">{t(`tour.${item}`)}</h3><p className="mt-1 text-sm leading-6 text-aura-text-secondary">{t(`customerProof.${item}`)}</p><span className="mt-4 inline-block text-[10px] font-bold uppercase tracking-wider text-aura-text-muted">{t("proof.pending")}</span></div></article>)}</div></Container></section>
    <section className="bg-white py-20"><Container><div className="text-center"><h2 className="text-2xl font-bold text-aura-text md:text-3xl">{t("customers.ctaTitle")}</h2><p className="mx-auto mb-8 mt-3 max-w-xl text-aura-text-secondary">{t("customers.ctaBody")}</p><a href={CTA_LINKS.trial}><Button variant="primary" size="lg">{t("nav.trial")}<ArrowRight className="ml-1 h-4 w-4" /></Button></a></div></Container></section>
  </>;
}
