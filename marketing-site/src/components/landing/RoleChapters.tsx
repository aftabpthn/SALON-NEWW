"use client";

import Link from "next/link";
import { ArrowUpRight, Check } from "lucide-react";
import { Container } from "@/components/ui/Container";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { useLanguage } from "@/components/providers/LanguageProvider";
import { ECOSYSTEM_CONTENT } from "@/lib/ecosystem-content";

const chapterRoutes = { owner: "/owner-crm", customer: "/customer-app", staff: "/staff-app" };

export function RoleChapters() {
  const { language } = useLanguage();
  const copy = ECOSYSTEM_CONTENT[language];
  const chapters = (["owner", "customer", "staff"] as const).map((role) => ({ role, content: copy.chapters[role] }));
  return (
    <section className="bg-aura-surface py-20 md:py-28">
      <Container>
        <SectionHeading badge={copy.chapters.eyebrow} title={copy.chapters.title} subtitle={copy.chapters.body} />
        <div className="mt-14 space-y-4">
          {chapters.map(({ role, content }, index) => <article key={role} className="grid overflow-hidden rounded-[1.75rem] border border-aura-border bg-white lg:grid-cols-[.78fr_1.22fr]"><div className={`relative min-h-64 p-6 text-white sm:p-8 ${index === 0 ? "bg-aura-role-owner" : index === 1 ? "bg-aura-role-customer" : "bg-aura-role-staff"}`}><p className="text-[10px] font-bold uppercase tracking-[.16em] text-white/55">{content.eyebrow}</p><h3 className="mt-5 max-w-lg font-display text-[clamp(2.25rem,5vw,4.5rem)] leading-[.98]">{content.title}</h3><p className="mt-5 max-w-lg text-sm leading-7 text-white/65">{content.body}</p><div className="absolute bottom-5 right-6 font-display text-7xl italic text-white/[.07]" aria-hidden="true">0{index + 1}</div></div><div className="p-6 sm:p-8"><ul className="grid gap-x-6 gap-y-3 sm:grid-cols-2">{content.points.map((point) => <li key={point} className="flex items-start gap-3 border-b border-aura-border pb-3 text-sm leading-6 text-aura-text-secondary"><Check className="mt-1 h-4 w-4 shrink-0 text-aura-success" aria-hidden="true" />{point}</li>)}</ul><p className="mt-6 rounded-xl bg-aura-surface-muted p-4 text-xs leading-5 text-aura-text-muted"><strong className="mb-1 block text-aura-text-secondary">{copy.common.qualification}</strong>{content.note}</p><Link href={chapterRoutes[role]} className="mt-6 inline-flex min-h-11 items-center gap-2 rounded-full bg-aura-burgundy px-5 text-sm font-semibold text-white">{copy.common.explore}<ArrowUpRight className="h-4 w-4" aria-hidden="true" /></Link></div></article>)}
        </div>
      </Container>
    </section>
  );
}
