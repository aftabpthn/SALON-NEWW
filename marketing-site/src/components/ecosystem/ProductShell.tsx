"use client";

import Image from "next/image";
import { CheckCircle2 } from "lucide-react";
import type { EcosystemRole } from "@/lib/ecosystem-content";
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

const media = {
  flow: { src: "/media/home-product-demo.svg", width: 1600, height: 1000, alt: "Illustrative connected salon workflow from booking to owner review" },
  owner: { src: "/media/home-product-demo.svg", width: 1600, height: 1000, alt: "Illustrative owner workflow connecting booking, checkout and review" },
  customer: { src: "/media/customer-journey-demo.svg", width: 1200, height: 1500, alt: "Illustrative customer journey from salon discovery to pay-at-salon visit and rebooking" },
  staff: { src: "/media/staff-workday-demo.svg", width: 1200, height: 1500, alt: "Illustrative staff workday from shift start through tasks to end-of-day review" },
} as const;

export function ProductShell({ role, label, eyebrow, title, body, points, note, disclosure }: ProductShellProps) {
  const { language } = useLanguage();
  const asset = media[role];
  return (
    <figure className="min-w-0">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-[10px] font-bold uppercase tracking-[.12em] text-aura-copper">
        <span>{language === "hi" ? "Demo media — launch से पहले replace करें" : "Demo media — replace before launch"}</span>
        <span>{role === "customer" || role === "staff" ? "4:5" : "16:10"}</span>
      </div>
      <div className={`grid overflow-hidden rounded-[1.5rem] border border-white/10 bg-aura-bg ${role === "customer" || role === "staff" ? "md:grid-cols-[.72fr_1.28fr]" : "md:grid-cols-[1.15fr_.85fr]"}`}>
        <div className="relative min-h-72 bg-aura-surface-muted">
          <Image src={asset.src} alt={asset.alt} width={asset.width} height={asset.height} className="h-full w-full object-cover" sizes="(max-width: 1024px) 100vw, 48vw" />
        </div>
        <figcaption className="flex flex-col justify-between p-6 sm:p-8">
          <div><p className="text-[10px] font-bold uppercase tracking-[.14em] text-aura-burgundy">{label} · {eyebrow}</p><h2 className="mt-4 font-display text-3xl leading-tight text-aura-text">{title}</h2><p className="mt-3 text-sm leading-6 text-aura-text-secondary">{body}</p><ul className="mt-6 space-y-3">{points.slice(0, 4).map(point => <li key={point} className="flex items-start gap-2 text-xs leading-5 text-aura-text-secondary"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-aura-success" aria-hidden="true"/>{point}</li>)}</ul></div>
          <div className="mt-6 border-t border-aura-border pt-4 text-[11px] leading-5 text-aura-text-muted"><p>{disclosure}</p><p className="mt-2 font-medium text-aura-text-secondary">{note}</p></div>
        </figcaption>
      </div>
    </figure>
  );
}
