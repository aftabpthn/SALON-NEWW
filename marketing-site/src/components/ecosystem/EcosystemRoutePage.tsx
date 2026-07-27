"use client";

import Link from "next/link";
import { ArrowRight, Check, Monitor, Smartphone, UsersRound, Workflow } from "lucide-react";
import { Container } from "@/components/ui/Container";
import { ProductShell } from "@/components/ecosystem/ProductShell";
import { CTA_LINKS } from "@/lib/constants";
import { useLanguage } from "@/components/providers/LanguageProvider";
import { ECOSYSTEM_CONTENT, type EcosystemRole, type EcosystemRoute } from "@/lib/ecosystem-content";

const roleForRoute: Record<EcosystemRoute, EcosystemRole> = { platform: "flow", owner: "owner", customer: "customer", staff: "staff", workflows: "flow" };
const routeLinks = [
  { key: "platform", href: "/platform", icon: Workflow },
  { key: "owner", href: "/owner-crm", icon: Monitor },
  { key: "customer", href: "/customer-app", icon: Smartphone },
  { key: "staff", href: "/staff-app", icon: UsersRound },
] as const;

export function EcosystemRoutePage({ route }: { route: EcosystemRoute }) {
  const { language } = useLanguage();
  const copy = ECOSYSTEM_CONTENT[language];
  const page = copy.route[route];
  const role = roleForRoute[route];
  const panel = copy.tour.roles[role];
  return (
    <>
      <section className="relative overflow-hidden bg-aura-bg pb-20">
        <div className="absolute inset-0 opacity-50 [background-image:linear-gradient(rgba(104,31,55,.05)_1px,transparent_1px),linear-gradient(90deg,rgba(104,31,55,.05)_1px,transparent_1px)] [background-size:72px_72px]" aria-hidden="true" />
        <Container size="wide" className="relative z-10">
          <div className="grid items-center gap-10 lg:grid-cols-[.78fr_1.22fr] lg:gap-14">
            <div><p className="text-[11px] font-bold uppercase tracking-[.2em] text-aura-burgundy">{page.eyebrow}</p><h1 className="mt-5 font-display text-[clamp(3.2rem,7vw,7rem)] leading-[1.02] tracking-[-.04em] text-aura-text">{page.title}</h1><p className="mt-7 max-w-xl text-base leading-8 text-aura-text-secondary md:text-lg">{page.body}</p><div className="mt-8 flex flex-col gap-3 sm:flex-row"><Link href={CTA_LINKS.demo} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-full bg-aura-burgundy px-6 text-sm font-semibold text-white">{copy.common.demo}<ArrowRight className="h-4 w-4" aria-hidden="true" /></Link><Link href="/workflows" className="inline-flex min-h-12 items-center justify-center rounded-full border border-aura-border-strong bg-white/60 px-6 text-sm font-semibold text-aura-text">{copy.ecosystem.roles.flow.label}</Link></div></div>
            <div className="min-w-0 rounded-[1.75rem] bg-aura-dark p-3 sm:p-5"><ProductShell role={role} label={panel.label} eyebrow={panel.eyebrow} title={panel.title} body={panel.body} points={panel.points} note={panel.note} disclosure={page.disclosure} /></div>
          </div>
        </Container>
      </section>

      <section className="bg-aura-surface py-20 md:py-28">
        <Container>
          <div className="grid gap-4 lg:grid-cols-3">
            {page.sections.map((section, index) => <article key={section.title} className="flex flex-col rounded-[1.5rem] border border-aura-border bg-white p-6 sm:p-8"><div className="flex items-center justify-between"><span className="text-[10px] font-bold uppercase tracking-[.14em] text-aura-burgundy">{String(index + 1).padStart(2, "0")}</span><span className="h-px w-12 bg-aura-amber" /></div><h2 className="mt-7 font-display text-3xl leading-tight text-aura-text">{section.title}</h2><p className="mt-3 text-sm leading-6 text-aura-text-secondary">{section.body}</p><ul className="mt-6 space-y-3">{section.items.map((item) => <li key={item} className="flex items-start gap-3 border-b border-aura-border pb-3 text-sm leading-6 text-aura-text-secondary last:border-0"><Check className="mt-1 h-4 w-4 shrink-0 text-aura-success" aria-hidden="true" />{item}</li>)}</ul>{section.note && <p className="mt-auto rounded-xl bg-aura-surface-muted p-4 text-xs leading-5 text-aura-text-muted"><strong className="mb-1 block text-aura-text-secondary">{copy.common.qualification}</strong>{section.note}</p>}</article>)}
          </div>
        </Container>
      </section>

      <section className="border-y border-aura-border bg-aura-bg-warm py-16">
        <Container><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{routeLinks.map((item) => { const Icon = item.icon; const linkedPage = copy.route[item.key]; return <Link key={item.key} href={item.href} className="group flex min-h-24 items-center gap-4 rounded-2xl border border-aura-border bg-aura-surface p-4 transition-colors hover:border-aura-border-strong"><span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-aura-rose-soft text-aura-burgundy"><Icon className="h-5 w-5" aria-hidden="true" /></span><span className="min-w-0"><strong className="block text-sm text-aura-text">{linkedPage.eyebrow}</strong><span className="mt-1 block text-xs text-aura-text-muted">{copy.common.explore}</span></span><ArrowRight className="ml-auto h-4 w-4 shrink-0 text-aura-text-muted transition-transform group-hover:translate-x-1" aria-hidden="true" /></Link>; })}</div></Container>
      </section>

      <section className="bg-aura-dark-elevated py-20 text-center text-white"><Container><div className="mx-auto grid h-24 w-24 place-items-center rounded-full border border-aura-copper/45" aria-hidden="true"><div className="grid h-16 w-16 place-items-center rounded-full border border-white/15 font-display text-3xl italic text-aura-cta-cream">A</div></div><h2 className="mx-auto mt-7 max-w-3xl font-display text-[clamp(2.3rem,5vw,4.5rem)] leading-[1.04]">{copy.hero.title}</h2><p className="mx-auto mt-4 max-w-xl text-sm leading-7 text-white/55">{copy.hero.body}</p><Link href={CTA_LINKS.demo} className="mt-7 inline-flex min-h-12 items-center gap-2 rounded-full bg-aura-cta-cream px-6 text-sm font-semibold text-aura-burgundy">{copy.common.demo}<ArrowRight className="h-4 w-4" aria-hidden="true" /></Link></Container></section>
    </>
  );
}
