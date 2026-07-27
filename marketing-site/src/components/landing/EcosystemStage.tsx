"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import { Monitor, Smartphone, UsersRound, Workflow } from "lucide-react";
import { cn } from "@/lib/utils";
import { useExperienceCapabilities } from "@/components/providers/useExperienceCapabilities";
import { useLanguage } from "@/components/providers/LanguageProvider";
import { ECOSYSTEM_CONTENT, type EcosystemRole } from "@/lib/ecosystem-content";

const DynamicScene = dynamic(() => import("@/components/three/AuraEcosystemScene").then((module) => module.AuraEcosystemScene), { ssr: false, loading: () => null });
const roleIcons = { flow: Workflow, owner: Monitor, customer: Smartphone, staff: UsersRound };

function StaticScene({ selected }: { selected: EcosystemRole }) {
  return (
    <div className="absolute inset-0 grid place-items-center" aria-hidden="true">
      <div className="ecosystem-orbit relative h-[78%] w-[82%] max-w-[38rem]">
        <div className="absolute left-1/2 top-1/2 grid h-28 w-28 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-[2rem] border border-white/35 bg-aura-burgundy text-center text-white shadow-[0_24px_70px_rgba(69,18,37,.35)] sm:h-36 sm:w-36"><span className="font-display text-3xl italic">Aura</span></div>
        {(["owner", "customer", "staff", "flow"] as EcosystemRole[]).map((role, index) => {
          const Icon = roleIcons[role];
          const position = ["left-[2%] top-[18%]", "right-[4%] top-[12%]", "right-[1%] bottom-[10%]", "left-[8%] bottom-[8%]"][index];
          return <div key={role} className={cn("absolute grid h-14 w-14 place-items-center rounded-2xl border bg-aura-surface/90 shadow-lg transition-transform sm:h-16 sm:w-16", position, selected === role ? "scale-110 border-aura-amber text-aura-burgundy" : "border-aura-border text-aura-text-muted")}><Icon className="h-5 w-5" /></div>;
        })}
      </div>
    </div>
  );
}

export function EcosystemStage({ selected, onSelect }: { selected: EcosystemRole; onSelect: (role: EcosystemRole) => void }) {
  const { language } = useLanguage();
  const copy = ECOSYSTEM_CONTENT[language];
  const capabilities = useExperienceCapabilities();
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { rootMargin: "120px" });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const useWebGL = visible && capabilities.ready && capabilities.webgl && !capabilities.coarsePointer && capabilities.viewport === "wide";
  return (
    <div ref={ref} className="relative aspect-[4/4.35] min-h-[25rem] overflow-hidden rounded-[1.75rem] border border-white/60 bg-[radial-gradient(circle_at_50%_45%,#fffaf2_0%,#eadfd2_52%,#d7c5b4_100%)] shadow-[0_35px_100px_rgba(61,30,40,.2)] sm:aspect-[4/3.3] lg:aspect-[4/4.15]" aria-label={copy.hero.sceneLabel}>
      <StaticScene selected={selected} />
      {useWebGL && <div className="absolute inset-0"><DynamicScene selected={selected} reducedMotion={capabilities.reducedMotion} onSelect={onSelect} /></div>}
      <div className="absolute inset-x-3 bottom-3 rounded-2xl border border-white/60 bg-aura-surface/92 p-2.5 shadow-lg backdrop-blur-md sm:inset-x-5 sm:bottom-5">
        <div className="grid grid-cols-4 gap-1" role="group" aria-label={copy.ecosystem.title}>
          {(Object.keys(copy.ecosystem.roles) as EcosystemRole[]).map((role) => {
            const Icon = roleIcons[role];
            return <button key={role} type="button" onClick={() => onSelect(role)} aria-pressed={selected === role} className={cn("flex min-h-12 min-w-0 flex-col items-center justify-center gap-1 rounded-xl px-1 text-[10px] font-bold leading-tight transition-colors sm:text-xs", selected === role ? "bg-aura-burgundy text-white" : "text-aura-text-muted hover:bg-aura-surface-muted hover:text-aura-text")}><Icon className="h-4 w-4 shrink-0" aria-hidden="true" /><span className="line-clamp-2">{copy.ecosystem.roles[role].label}</span></button>;
          })}
        </div>
      </div>
      <p className="absolute left-4 top-4 max-w-[15rem] rounded-full border border-white/60 bg-aura-surface/85 px-3 py-1.5 text-[9px] font-bold uppercase tracking-[.1em] text-aura-text-muted backdrop-blur sm:left-5 sm:top-5 sm:text-[10px]">{copy.hero.disclosure}</p>
    </div>
  );
}
