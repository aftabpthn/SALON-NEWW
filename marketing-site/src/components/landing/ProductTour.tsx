"use client";

import { useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Monitor, Smartphone, UsersRound, Workflow } from "lucide-react";
import { Container } from "@/components/ui/Container";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { ProductShell } from "@/components/ecosystem/ProductShell";
import { useLanguage } from "@/components/providers/LanguageProvider";
import { ECOSYSTEM_CONTENT, type EcosystemRole } from "@/lib/ecosystem-content";
import { cn } from "@/lib/utils";

const icons = { flow: Workflow, owner: Monitor, customer: Smartphone, staff: UsersRound };

export function ProductTour() {
  const { language } = useLanguage();
  const copy = ECOSYSTEM_CONTENT[language];
  const reducedMotion = useReducedMotion();
  const roles = Object.keys(copy.tour.roles) as EcosystemRole[];
  const [active, setActive] = useState<EcosystemRole>("flow");
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const select = (index: number) => { const next = (index + roles.length) % roles.length; setActive(roles[next]); tabRefs.current[next]?.focus(); };
  const panel = copy.tour.roles[active];

  return (
    <section className="bg-aura-dark py-20 text-white md:py-28">
      <Container size="wide">
        <div className="grid gap-8 lg:grid-cols-[.58fr_1.42fr] lg:gap-12">
          <div><SectionHeading badge={copy.tour.eyebrow} title={copy.tour.title} subtitle={copy.tour.body} align="left" className="[&_h2]:text-white [&_p]:text-white/55 [&>span]:text-aura-copper" /><div role="tablist" aria-label={copy.tour.title} className="mt-8 flex gap-2 overflow-x-auto pb-2 lg:grid lg:overflow-visible">{roles.map((role, index) => { const Icon = icons[role]; return <button key={role} ref={(node) => { tabRefs.current[index] = node; }} type="button" role="tab" id={`product-stage-tab-${role}`} aria-selected={active === role} aria-controls="product-stage-panel" tabIndex={active === role ? 0 : -1} onClick={() => setActive(role)} onKeyDown={(event) => { if (event.key === "ArrowRight" || event.key === "ArrowDown") { event.preventDefault(); select(index + 1); } if (event.key === "ArrowLeft" || event.key === "ArrowUp") { event.preventDefault(); select(index - 1); } if (event.key === "Home") { event.preventDefault(); select(0); } if (event.key === "End") { event.preventDefault(); select(roles.length - 1); } }} className={cn("flex min-h-12 shrink-0 items-center gap-3 rounded-full px-4 text-left text-sm font-semibold transition-colors lg:rounded-xl", active === role ? "bg-aura-cta-cream text-aura-text" : "border border-white/10 text-white/55 hover:bg-white/5 hover:text-white")}><Icon className="h-4 w-4" aria-hidden="true" />{panel && copy.tour.roles[role].label}</button>; })}</div></div>
          <div id="product-stage-panel" role="tabpanel" aria-labelledby={`product-stage-tab-${active}`} className="min-w-0"><AnimatePresence mode="wait" initial={false}><motion.div key={active} initial={reducedMotion ? false : { opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={reducedMotion ? undefined : { opacity: 0, y: -8 }} transition={{ duration: reducedMotion ? 0 : .35, ease: "easeOut" }}><ProductShell role={active} label={panel.label} eyebrow={panel.eyebrow} title={panel.title} body={panel.body} points={panel.points} note={panel.note} disclosure={copy.tour.disclosure} /></motion.div></AnimatePresence></div>
        </div>
      </Container>
    </section>
  );
}
