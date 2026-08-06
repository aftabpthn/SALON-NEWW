"use client";

import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { useLanguage } from "@/components/providers/LanguageProvider";

export function FloatingConversionDock() {
  const { language } = useLanguage();
  return (
    <div className="fixed bottom-[max(1rem,env(safe-area-inset-bottom))] right-4 z-[990] hidden sm:block">
      <Link href="/demo" className="inline-flex min-h-11 items-center gap-2 rounded-full border border-white/15 bg-aura-dark px-5 text-xs font-bold text-white shadow-xl transition-colors hover:bg-aura-burgundy">
        {language === "hi" ? "डेमो का अनुरोध करें" : "Request a demo"}
        <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
      </Link>
    </div>
  );
}
