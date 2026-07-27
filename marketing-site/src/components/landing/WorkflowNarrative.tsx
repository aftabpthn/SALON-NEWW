"use client";

import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Container } from "@/components/ui/Container";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { useLanguage } from "@/components/providers/LanguageProvider";
import { ECOSYSTEM_CONTENT } from "@/lib/ecosystem-content";

export function WorkflowNarrative({ compact = false }: { compact?: boolean }) {
  const { language } = useLanguage();
  const copy = ECOSYSTEM_CONTENT[language];
  return (
    <section className="overflow-hidden bg-aura-bg-warm py-20 md:py-28">
      <Container size="wide">
        <SectionHeading badge={copy.workflow.eyebrow} title={copy.workflow.title} subtitle={copy.workflow.body} align="left" />
        <ol className="relative mt-12 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {copy.workflow.steps.slice(0, compact ? 4 : 8).map((step, index) => <li key={step.title} className="relative min-w-0 rounded-2xl border border-aura-border bg-[#fffdf9] p-5 shadow-[0_12px_35px_rgba(49,28,33,.05)]"><div className="flex items-center justify-between gap-3"><span className="text-[10px] font-bold uppercase tracking-[.14em] text-aura-burgundy">{step.tag}</span><span className="font-display text-lg text-aura-border-strong">{String(index + 1).padStart(2, "0")}</span></div><h3 className="mt-6 font-display text-2xl leading-tight text-aura-text">{step.title}</h3><p className="mt-3 text-sm leading-6 text-aura-text-secondary">{step.body}</p>{index < (compact ? 3 : 7) && <ArrowRight className="absolute -bottom-2 right-5 z-10 h-4 w-4 translate-y-full rotate-90 text-aura-amber md:right-6 xl:-right-2 xl:bottom-auto xl:top-1/2 xl:-translate-y-1/2 xl:rotate-0" aria-hidden="true" />}</li>)}
        </ol>
        <div className="mt-6 flex flex-col items-start justify-between gap-4 rounded-2xl border border-aura-border bg-transparent p-5 sm:flex-row sm:items-center"><p className="max-w-4xl text-xs leading-5 text-aura-text-muted">{copy.workflow.note}</p>{compact && <Link href="/workflows" className="inline-flex min-h-11 shrink-0 items-center rounded-full border border-aura-border-strong px-5 text-sm font-semibold text-aura-text">{copy.common.explore}</Link>}</div>
      </Container>
    </section>
  );
}
