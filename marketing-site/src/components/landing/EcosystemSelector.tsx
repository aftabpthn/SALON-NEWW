"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ArrowUpRight, Check, Monitor, Smartphone, UsersRound, Workflow } from "lucide-react";
import { Container } from "@/components/ui/Container";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { useLanguage } from "@/components/providers/LanguageProvider";
import { ECOSYSTEM_CONTENT, type EcosystemRole } from "@/lib/ecosystem-content";
import { cn } from "@/lib/utils";

const icons = { flow: Workflow, owner: Monitor, customer: Smartphone, staff: UsersRound };
const routes = { flow: "/workflows", owner: "/owner-crm", customer: "/customer-app", staff: "/staff-app" };

export function EcosystemSelector() {
  const { language } = useLanguage();
  const copy = ECOSYSTEM_CONTENT[language];
  const reducedMotion = useReducedMotion();
  const [active, setActive] = useState<EcosystemRole>("flow");
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const roles = Object.keys(copy.ecosystem.roles) as EcosystemRole[];
  const selected = copy.ecosystem.roles[active];
  const select = (index: number) => { const next = (index + roles.length) % roles.length; setActive(roles[next]); refs.current[next]?.focus(); };

  return (
    <section className="bg-aura-surface py-20 md:py-28">
      <Container>
        <SectionHeading badge={copy.ecosystem.eyebrow} title={copy.ecosystem.title} subtitle={copy.ecosystem.body} />
        <div className="mx-auto mt-12 max-w-6xl">
          <div role="tablist" aria-label={copy.ecosystem.title} className="flex gap-2 overflow-x-auto pb-3 md:grid md:grid-cols-4 md:overflow-visible">
            {roles.map((role, index) => { const Icon = icons[role]; return <button key={role} ref={(node) => { refs.current[index] = node; }} type="button" role="tab" id={`ecosystem-tab-${role}`} aria-controls="ecosystem-panel" aria-selected={active === role} tabIndex={active === role ? 0 : -1} onClick={() => setActive(role)} onKeyDown={(event) => { if (event.key === "ArrowRight") { event.preventDefault(); select(index + 1); } if (event.key === "ArrowLeft") { event.preventDefault(); select(index - 1); } if (event.key === "Home") { event.preventDefault(); select(0); } if (event.key === "End") { event.preventDefault(); select(roles.length - 1); } }} className={cn("flex min-h-14 min-w-[10rem] items-center gap-3 rounded-2xl border px-4 text-left text-sm font-semibold transition-colors md:min-w-0", active === role ? "border-aura-burgundy bg-aura-rose-soft text-aura-burgundy" : "border-aura-border bg-white text-aura-text-secondary hover:border-aura-border-strong hover:text-aura-text")}><span className={cn("grid h-9 w-9 shrink-0 place-items-center rounded-xl", active === role ? "bg-aura-burgundy text-white" : "bg-aura-surface-muted text-aura-text-muted")}><Icon className="h-4 w-4" aria-hidden="true" /></span>{copy.ecosystem.roles[role].label}</button>; })}
          </div>
          <div id="ecosystem-panel" role="tabpanel" aria-labelledby={`ecosystem-tab-${active}`} className="mt-3 overflow-hidden rounded-[1.75rem] border border-aura-border bg-aura-dark-elevated text-white">
            <AnimatePresence mode="wait" initial={false}>
              <motion.div key={active} initial={reducedMotion ? false : { opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={reducedMotion ? undefined : { opacity: 0, y: -8 }} transition={{ duration: reducedMotion ? 0 : .35, ease: "easeOut" }} className="grid gap-8 p-6 sm:p-8 lg:grid-cols-[1.05fr_.95fr] lg:p-10">
                <div><p className="text-[10px] font-bold uppercase tracking-[.16em] text-aura-copper">{selected.eyebrow}</p><h3 className="mt-3 max-w-xl font-display text-[clamp(2rem,4vw,3.75rem)] leading-[1.02]">{selected.title}</h3><p className="mt-5 max-w-xl text-sm leading-7 text-white/60 md:text-base">{selected.body}</p><Link href={routes[active]} className="mt-7 inline-flex min-h-11 items-center gap-2 rounded-full bg-aura-cta-cream px-5 text-sm font-semibold text-aura-burgundy">{copy.common.explore}<ArrowUpRight className="h-4 w-4" aria-hidden="true" /></Link></div>
                <div className="rounded-2xl border border-white/10 bg-white/[.04] p-5"><ul className="grid gap-3">{selected.points.map((point) => <li key={point} className="flex items-start gap-3 border-b border-white/10 pb-3 text-sm text-white/75 last:border-0 last:pb-0"><Check className="mt-0.5 h-4 w-4 shrink-0 text-aura-copper" aria-hidden="true" />{point}</li>)}</ul><p className="mt-5 rounded-xl bg-black/15 p-4 text-xs leading-5 text-white/45"><strong className="mb-1 block text-white/70">{copy.common.qualification}</strong>{selected.note}</p></div>
              </motion.div>
            </AnimatePresence>
          </div>
        </div>
      </Container>
    </section>
  );
}
