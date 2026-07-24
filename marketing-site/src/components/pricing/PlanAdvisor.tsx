"use client";

import { useMemo, useState } from "react";
import { ArrowRight, CheckCircle2 } from "lucide-react";
import { Container } from "@/components/ui/Container";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { useLanguage } from "@/components/providers/LanguageProvider";
import { CTA_LINKS, PRICING_TIERS } from "@/lib/constants";

const capabilityKeys = ["staff", "inventory", "marketing", "finance", "api", "whiteLabel", "compliance"] as const;
type Capability = typeof capabilityKeys[number];

export function PlanAdvisor() {
  const { t } = useLanguage();
  const [branches, setBranches] = useState(1);
  const [team, setTeam] = useState(6);
  const [capabilities, setCapabilities] = useState<Capability[]>([]);
  const result = useMemo(() => {
    const enterprise = branches > 5 || capabilities.includes("whiteLabel") || capabilities.includes("compliance");
    const growth = branches > 1 || capabilities.some((item) => ["staff", "inventory", "marketing", "finance", "api"].includes(item));
    const index = enterprise ? 2 : growth ? 1 : 0;
    return { index, tier: PRICING_TIERS[index], reason: enterprise ? "advisor.enterpriseWhy" : growth ? "advisor.growthWhy" : "advisor.starterWhy" };
  }, [branches, capabilities]);
  const toggle = (capability: Capability) => setCapabilities((current) => current.includes(capability) ? current.filter((item) => item !== capability) : [...current, capability]);
  const planName = t(`pricing.tier.${result.index}.name`, result.tier.name);
  const price = result.tier.monthlyPrice > 0 ? `₹${result.tier.monthlyPrice.toLocaleString("en-IN")}${t("common.month")}` : t("common.custom");

  return (
    <section className="bg-aura-bg py-20 md:py-28">
      <Container>
        <SectionHeading badge={t("advisor.badge")} title={t("advisor.title")} subtitle={t("advisor.body")} />
        <div className="mx-auto mt-12 grid max-w-5xl overflow-hidden rounded-[1.5rem] border border-aura-border bg-white lg:grid-cols-[1.15fr_.85fr]">
          <form className="grid gap-6 p-5 sm:p-8" onSubmit={(event) => event.preventDefault()}>
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="grid gap-2 text-sm font-semibold text-aura-text"><span>{t("advisor.branches")}</span><input type="number" min="1" max="100" inputMode="numeric" value={branches} onChange={(event) => setBranches(Math.min(100, Math.max(1, Number(event.target.value) || 1)))} className="rounded-xl border border-aura-border bg-aura-surface-muted px-4 py-3 text-base outline-none focus:border-aura-burgundy focus:ring-2 focus:ring-aura-rose-soft" /></label>
              <label className="grid gap-2 text-sm font-semibold text-aura-text"><span>{t("advisor.team")}</span><input type="number" min="1" max="1000" inputMode="numeric" value={team} onChange={(event) => setTeam(Math.min(1000, Math.max(1, Number(event.target.value) || 1)))} className="rounded-xl border border-aura-border bg-aura-surface-muted px-4 py-3 text-base outline-none focus:border-aura-burgundy focus:ring-2 focus:ring-aura-rose-soft" /></label>
            </div>
            <fieldset><legend className="text-sm font-semibold text-aura-text">{t("advisor.needs")}</legend><div className="mt-3 grid gap-2 sm:grid-cols-2">{capabilityKeys.map((capability) => <label key={capability} className={`flex min-h-12 cursor-pointer items-center gap-3 rounded-xl border px-3 py-2 text-sm transition-colors ${capabilities.includes(capability) ? "border-aura-burgundy bg-aura-rose-soft text-aura-text" : "border-aura-border text-aura-text-secondary hover:bg-aura-surface-muted"}`}><input type="checkbox" checked={capabilities.includes(capability)} onChange={() => toggle(capability)} className="h-4 w-4 accent-aura-burgundy" /><span>{t(`advisor.${capability}`)}</span></label>)}</div></fieldset>
            <p className="text-xs leading-5 text-aura-text-muted">{t("advisor.teamNote")} ({team})</p>
          </form>
          <aside className="flex flex-col bg-aura-dark-elevated p-6 text-white sm:p-8" aria-live="polite" aria-atomic="true">
            <CheckCircle2 className="h-6 w-6 text-aura-copper" aria-hidden="true" /><p className="mt-5 text-xs uppercase tracking-[.14em] text-white/45">{t("advisor.recommendation")}</p><h3 className="mt-2 font-display text-4xl font-normal">{planName}</h3><p className="mt-2 text-lg font-semibold text-aura-cream">{t("advisor.from")} {price}</p><div className="mt-6 border-t border-white/10 pt-5"><strong className="text-xs uppercase tracking-wider text-white/45">{t("advisor.why")}</strong><p className="mt-2 text-sm leading-6 text-white/65">{t(result.reason)}</p></div><div className="mt-auto flex flex-col gap-3 pt-8"><a href={CTA_LINKS.demo} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-aura-cta-cream px-5 text-sm font-semibold text-aura-burgundy">{t("advisor.demo")}<ArrowRight className="h-4 w-4" /></a><a href="/contact" className="inline-flex min-h-11 items-center justify-center rounded-full border border-white/15 px-5 text-sm text-white/75 hover:bg-white/5">{t("advisor.contact")}</a></div>
          </aside>
        </div>
      </Container>
    </section>
  );
}
