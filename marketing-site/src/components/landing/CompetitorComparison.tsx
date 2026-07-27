"use client";

import { Check } from "lucide-react";
import { Container } from "@/components/ui/Container";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { useLanguage } from "@/components/providers/LanguageProvider";

const checks = ["booking", "checkout", "client", "stock", "staff", "branch"] as const;

export function CompetitorComparison() {
  const { t } = useLanguage();

  return (
    <section className="bg-aura-bg py-20 md:py-28">
      <Container>
        <SectionHeading badge={t("fit.badge")} title={t("fit.title")} subtitle={t("fit.body")} />
        <div className="mx-auto mt-12 max-w-5xl overflow-hidden rounded-2xl border border-aura-border bg-white">
          <div className="grid border-b border-aura-border bg-aura-surface-muted px-5 py-3 text-[10px] font-bold uppercase tracking-wider text-aura-text-muted sm:grid-cols-[.7fr_1.3fr]">
            <span>{t("fit.workflow")}</span>
            <span className="hidden sm:block">{t("fit.verify")}</span>
          </div>
          {checks.map((item) => (
            <div key={item} className="grid gap-2 border-b border-aura-border px-5 py-4 last:border-0 sm:grid-cols-[.7fr_1.3fr]">
              <strong className="flex items-center gap-2 text-sm text-aura-text">
                <Check className="h-4 w-4 shrink-0 text-aura-success" aria-hidden="true" />
                {t(`fit.${item}`)}
              </strong>
              <p className="text-sm leading-6 text-aura-text-secondary">{t(`fit.${item}.body`)}</p>
            </div>
          ))}
        </div>
        <p className="mx-auto mt-5 max-w-3xl text-center text-xs leading-5 text-aura-text-muted">{t("fit.note")}</p>
      </Container>
    </section>
  );
}
