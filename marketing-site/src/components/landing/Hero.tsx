"use client";

import { useState } from "react";
import Link from "next/link";
import { motion, useReducedMotion } from "motion/react";
import { ArrowRight, Check } from "lucide-react";
import { CTA_LINKS } from "@/lib/constants";
import { Container } from "@/components/ui/Container";
import { Button } from "@/components/ui/Button";
import { useLanguage } from "@/components/providers/LanguageProvider";
import { BusinessTypeSelector } from "./BusinessTypeSelector";
import { EcosystemStage } from "./EcosystemStage";
import { ECOSYSTEM_CONTENT, type EcosystemRole } from "@/lib/ecosystem-content";
import { Aura3dOrbit } from "@/components/three/Aura3dOrbit";

export function Hero() {
  const { language } = useLanguage();
  const copy = ECOSYSTEM_CONTENT[language];
  const reducedMotion = useReducedMotion();
  const [selected, setSelected] = useState<EcosystemRole>("flow");
  const role = copy.ecosystem.roles[selected];
  const reveal = (delay: number) => ({ initial: reducedMotion ? false : { opacity: 0, y: 18 }, animate: { opacity: 1, y: 0 }, transition: { duration: .55, delay: reducedMotion ? 0 : delay, ease: [0.22, 1, 0.36, 1] as [number, number, number, number] } });

  return (
    <section className="relative overflow-hidden bg-[var(--gradient-hero)] text-white">
      <Aura3dOrbit />
      <div className="absolute inset-0 opacity-45 [background-image:linear-gradient(rgba(255,255,255,.12)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,.12)_1px,transparent_1px)] [background-size:72px_72px] [mask-image:linear-gradient(to_bottom,black,transparent_82%)]" aria-hidden="true" />
      <Container size="wide" className="relative z-10">
        <div className="grid items-center gap-10 pb-16 lg:grid-cols-[.86fr_1.14fr] lg:gap-12 lg:pb-24 xl:gap-16">
          <div className="max-w-2xl">
            <motion.div {...reveal(0)} className="mb-6 flex flex-wrap items-center gap-3">
              <p className="text-[11px] font-bold uppercase tracking-[.2em] text-aura-copper">{copy.hero.eyebrow}</p>
              <BusinessTypeSelector />
            </motion.div>
            <motion.h1 {...reveal(.06)} className="font-display text-[clamp(3.45rem,6.8vw,7.4rem)] font-medium leading-[.94] tracking-[-.05em] text-aura-cta-cream">{copy.hero.title}</motion.h1>
            <motion.p {...reveal(.12)} className="mt-7 max-w-xl text-base leading-7 text-white/75 md:text-lg md:leading-8">{copy.hero.body}</motion.p>
            <motion.div {...reveal(.18)} className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Button asChild variant="primary" size="lg" className="bg-aura-cta-cream text-aura-burgundy shadow-xl hover:bg-white">
                <Link href={CTA_LINKS.demo} className="group">
                  {copy.hero.primary}
                  <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" aria-hidden="true" />
                </Link>
              </Button>
              <Button asChild variant="outline" size="lg" className="border-white/35 text-white hover:border-white/60 hover:bg-white/10">
                <Link href="/platform">{copy.hero.secondary}</Link>
              </Button>
            </motion.div>
            <motion.div {...reveal(.23)} className="mt-8 border-l border-aura-amber pl-4" aria-live="polite">
              <p className="text-[10px] font-bold uppercase tracking-[.16em] text-aura-copper">{role.eyebrow}</p>
              <p className="mt-1 text-sm font-semibold text-white">{role.title}</p>
              <ul className="mt-3 grid gap-2 text-xs text-white/70 sm:grid-cols-2">{role.points.slice(0, 4).map((point) => <li key={point} className="flex items-start gap-2"><Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-aura-amber" aria-hidden="true" />{point}</li>)}</ul>
            </motion.div>
          </div>
          <motion.div initial={reducedMotion ? false : { opacity: 0, x: 24, scale: .985 }} animate={{ opacity: 1, x: 0, scale: 1 }} transition={{ duration: .65, delay: reducedMotion ? 0 : .12, ease: [0.22, 1, 0.36, 1] }} className="min-w-0">
            <EcosystemStage selected={selected} onSelect={setSelected} />
          </motion.div>
        </div>
      </Container>
    </section>
  );
}
