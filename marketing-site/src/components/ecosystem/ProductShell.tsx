"use client";

import { CheckCircle2, CircleDot, MoreHorizontal } from "lucide-react";
import type { EcosystemRole } from "@/lib/ecosystem-content";
import { ECOSYSTEM_CONTENT } from "@/lib/ecosystem-content";
import { useLanguage } from "@/components/providers/LanguageProvider";

type ProductShellProps = {
  role: EcosystemRole;
  label: string;
  eyebrow: string;
  title: string;
  body: string;
  points: string[];
  note: string;
  disclosure: string;
};

export function ProductShell({ role, label, eyebrow, title, body, points, note, disclosure }: ProductShellProps) {
  const { language } = useLanguage();
  const copy = ECOSYSTEM_CONTENT[language];
  const phone = role === "customer" || role === "staff";
  return (
    <div className="min-w-0" data-media-slot="">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-[10px] font-bold uppercase tracking-[.12em] text-white/45"><span>{disclosure}</span><span>{label}</span></div>
      <div className="overflow-hidden rounded-[1.5rem] border border-white/10 bg-aura-bg p-3 text-aura-text shadow-2xl sm:p-5">
        <div className="flex items-center justify-between border-b border-aura-border pb-3"><div className="flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full bg-aura-burgundy" /><span className="text-xs font-semibold">Aura · {eyebrow}</span></div><MoreHorizontal className="h-4 w-4 text-aura-text-muted" aria-hidden="true" /></div>
        <div className={`mt-4 grid gap-3 ${phone ? "md:grid-cols-[.72fr_1.28fr]" : "md:grid-cols-[1.25fr_.75fr]"}`}>
          <section className="rounded-2xl border border-aura-border bg-white p-5"><p className="text-[10px] font-bold uppercase tracking-[.14em] text-aura-burgundy">{eyebrow}</p><h3 className="mt-3 font-display text-3xl leading-tight text-aura-text">{title}</h3><p className="mt-3 text-sm leading-6 text-aura-text-secondary">{body}</p><div className="mt-6 grid gap-2">{points.slice(0, 4).map((point, index) => <div key={point} className="flex min-h-11 items-center gap-3 rounded-xl bg-aura-surface-muted px-3 text-xs text-aura-text-secondary"><span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-white font-semibold text-aura-burgundy">{index + 1}</span>{point}</div>)}</div></section>
          <aside className="rounded-2xl bg-aura-dark-elevated p-5 text-white"><div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[.12em] text-white/40"><CircleDot className="h-3.5 w-3.5 text-aura-copper" aria-hidden="true" />{copy.common.qualification}</div><ul className="mt-5 space-y-3">{points.slice(0, 4).map((point) => <li key={point} className="flex items-start gap-2 border-b border-white/10 pb-3 text-xs leading-5 text-white/65"><CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-aura-copper" aria-hidden="true" />{point}</li>)}</ul><p className="mt-5 text-[11px] leading-5 text-white/40">{note}</p></aside>
        </div>
      </div>
    </div>
  );
}
