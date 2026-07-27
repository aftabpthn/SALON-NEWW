"use client";

import { Building2 } from "lucide-react";
import { useLanguage, type BusinessType } from "@/components/providers/LanguageProvider";

const businessTypes: BusinessType[] = ["salon", "spa", "nail", "bridal", "multi"];

export function BusinessTypeSelector() {
  const { businessType, setBusinessType, t } = useLanguage();

  return (
    <label className="inline-flex max-w-full items-center gap-2 rounded-full border border-aura-border bg-white/55 px-3 py-2 text-xs text-aura-text-secondary">
      <Building2 className="h-3.5 w-3.5 shrink-0 text-aura-burgundy" aria-hidden="true" />
      <span className="hidden sm:inline">{t("business.label")}</span>
      <select
        value={businessType}
        onChange={(event) => setBusinessType(event.target.value as BusinessType)}
        className="min-h-0 max-w-[12rem] bg-transparent py-0 font-semibold text-aura-text outline-none sm:max-w-none"
      >
        {businessTypes.map((type) => <option key={type} value={type}>{t(`business.${type}`)}</option>)}
      </select>
    </label>
  );
}
