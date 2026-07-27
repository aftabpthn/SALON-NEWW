"use client";

import { useMemo, useState } from "react";
import { ArrowRight, Calculator } from "lucide-react";
import { Container } from "@/components/ui/Container";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { useLanguage } from "@/components/providers/LanguageProvider";
import { CTA_LINKS } from "@/lib/constants";

type Assumptions = { appointments: number; ticket: number; noShow: number; recovery: number; hours: number; hourValue: number };
const limits: Record<keyof Assumptions, [number, number]> = { appointments: [0, 100000], ticket: [0, 1000000], noShow: [0, 100], recovery: [0, 100], hours: [0, 744], hourValue: [0, 100000] };

function clamp(value: number, [min, max]: [number, number]) {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
}

export function ROICalculator() {
  const { language, t } = useLanguage();
  const [values, setValues] = useState<Assumptions>({ appointments: 300, ticket: 1500, noShow: 10, recovery: 20, hours: 16, hourValue: 300 });
  const currency = useMemo(() => new Intl.NumberFormat(language === "hi" ? "hi-IN" : "en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }), [language]);
  const result = useMemo(() => {
    const missedAppointmentValue = values.appointments * values.ticket * (values.noShow / 100);
    const recoveredRevenue = missedAppointmentValue * (values.recovery / 100);
    const timeValue = values.hours * values.hourValue;
    return { recoveredRevenue, timeValue, monthly: recoveredRevenue + timeValue };
  }, [values]);
  const update = (key: keyof Assumptions, input: string) => setValues((current) => ({ ...current, [key]: clamp(Number(input), limits[key]) }));
  const fields: Array<{ key: keyof Assumptions; label: string; step?: number }> = [
    { key: "appointments", label: t("roi.appointments") }, { key: "ticket", label: t("roi.ticket") }, { key: "noShow", label: t("roi.noShow"), step: .5 },
    { key: "recovery", label: t("roi.recovery"), step: .5 }, { key: "hours", label: t("roi.hours"), step: .5 }, { key: "hourValue", label: t("roi.hourValue") },
  ];

  return (
    <section className="bg-aura-surface py-20 md:py-28">
      <Container>
        <div className="grid gap-10 lg:grid-cols-[.72fr_1.28fr] lg:gap-16">
          <div><SectionHeading badge={t("roi.badge")} title={t("roi.title")} subtitle={t("roi.body")} align="left" /><div className="mt-8 rounded-2xl border border-aura-border bg-aura-bg p-5"><Calculator className="h-5 w-5 text-aura-burgundy" /><p className="mt-4 text-xs leading-5 text-aura-text-muted">{t("roi.disclaimer")}</p></div></div>
          <div className="overflow-hidden rounded-[1.5rem] border border-aura-border bg-white shadow-[0_24px_70px_rgba(49,28,33,.09)]">
            <div className="grid gap-4 p-5 sm:grid-cols-2 sm:p-7">
              {fields.map((field) => <label key={field.key} className="grid gap-2 text-xs font-semibold text-aura-text-secondary"><span>{field.label}</span><input type="number" min={limits[field.key][0]} max={limits[field.key][1]} step={field.step ?? 1} inputMode="decimal" value={values[field.key]} onChange={(event) => update(field.key, event.target.value)} onBlur={(event) => update(field.key, event.target.value)} className="w-full rounded-xl border border-aura-border bg-aura-surface-muted px-3 py-3 text-base font-semibold text-aura-text outline-none focus:border-aura-burgundy focus:ring-2 focus:ring-aura-rose-soft" /></label>)}
            </div>
            <div className="bg-aura-dark-elevated p-5 text-white sm:p-7" aria-live="polite" aria-atomic="true">
              <div className="grid gap-5 sm:grid-cols-2"><div><p className="text-xs text-white/45">{t("roi.monthly")}</p><strong className="mt-1 block font-display text-3xl font-normal sm:text-4xl">{currency.format(result.monthly)}</strong></div><div><p className="text-xs text-white/45">{t("roi.annual")}</p><strong className="mt-1 block text-xl">{currency.format(result.monthly * 12)}</strong></div></div>
              <dl className="mt-6 grid gap-2 border-t border-white/10 pt-5 text-xs sm:grid-cols-2"><div className="flex justify-between gap-3 sm:block"><dt className="text-white/45">{t("roi.revenue")}</dt><dd className="mt-1 font-semibold">{currency.format(result.recoveredRevenue)}</dd></div><div className="flex justify-between gap-3 sm:block"><dt className="text-white/45">{t("roi.time")}</dt><dd className="mt-1 font-semibold">{currency.format(result.timeValue)}</dd></div></dl>
              <details className="mt-5 border-t border-white/10 pt-4 text-xs text-white/55"><summary className="min-h-10 cursor-pointer py-2 font-semibold text-white/75">{t("roi.method")}</summary><div className="space-y-2 pb-2 leading-5"><p>{t("roi.formulaRevenue")}</p><p>{t("roi.formulaTime")}</p></div></details>
              <a href={CTA_LINKS.demo} className="mt-5 inline-flex min-h-11 items-center gap-2 rounded-full bg-aura-cta-cream px-5 text-sm font-semibold text-aura-burgundy">{t("roi.cta")}<ArrowRight className="h-4 w-4" /></a>
            </div>
          </div>
        </div>
      </Container>
    </section>
  );
}
