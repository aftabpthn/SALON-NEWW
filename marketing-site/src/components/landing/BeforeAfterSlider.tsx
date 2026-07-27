"use client";

import { useState } from "react";
import { XCircle, CheckCircle2, ArrowRight, ShieldCheck, Sparkles } from "lucide-react";
import { Container } from "@/components/ui/Container";
import { SectionHeading } from "@/components/ui/SectionHeading";

export function BeforeAfterSlider() {
  const [sliderPos, setSliderPos] = useState(50); // percentage

  return (
    <section className="bg-aura-surface py-20 md:py-28 overflow-hidden">
      <Container>
        <SectionHeading
          badge="Operational Transformation"
          title="Manual Salon Registers vs. Aura Salon OS"
          subtitle="Drag the slider to see how Aura transforms daily salon stress into automated growth."
        />

        {/* Interactive Comparison Card */}
        <div className="mt-10 mx-auto max-w-5xl rounded-3xl border border-aura-border bg-white shadow-2xl overflow-hidden">
          {/* Slider Control Header */}
          <div className="bg-aura-dark p-4 text-white flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-aura-copper" />
              <span className="text-xs font-bold uppercase tracking-wider">Drag to Compare Operating Models</span>
            </div>
            <div className="flex items-center gap-3 w-full max-w-xs">
              <span className="text-[10px] font-bold text-red-400">Manual (0%)</span>
              <input
                type="range"
                min="0"
                max="100"
                value={sliderPos}
                onChange={(e) => setSliderPos(Number(e.target.value))}
                className="w-full h-2 rounded-lg bg-white/20 appearance-none cursor-pointer accent-aura-copper"
              />
              <span className="text-[10px] font-bold text-emerald-400">Aura OS (100%)</span>
            </div>
          </div>

          <div className="grid md:grid-cols-2 divide-y md:divide-y-0 md:divide-x divide-aura-border">
            {/* Before Column */}
            <div className={`p-6 md:p-8 transition-opacity duration-300 ${sliderPos > 75 ? "opacity-40" : "opacity-100"}`}>
              <div className="flex items-center gap-2 text-red-600 mb-4">
                <XCircle className="h-5 w-5" />
                <h3 className="font-display text-xl font-bold">Traditional Manual Salon</h3>
              </div>
              <ul className="space-y-4 text-xs text-aura-text-secondary">
                <li className="flex items-start gap-2.5">
                  <span className="h-2 w-2 rounded-full bg-red-400 mt-1.5 shrink-0" />
                  <span>Paper appointment diaries & lost customer booking calls during peak hours.</span>
                </li>
                <li className="flex items-start gap-2.5">
                  <span className="h-2 w-2 rounded-full bg-red-400 mt-1.5 shrink-0" />
                  <span>Manual GST tax calculations prone to filing audit errors & penalty fines.</span>
                </li>
                <li className="flex items-start gap-2.5">
                  <span className="h-2 w-2 rounded-full bg-red-400 mt-1.5 shrink-0" />
                  <span>Staff commission arguments due to unverified paper job cards.</span>
                </li>
                <li className="flex items-start gap-2.5">
                  <span className="h-2 w-2 rounded-full bg-red-400 mt-1.5 shrink-0" />
                  <span>Stock leakages & expired product waste without recipe tracking.</span>
                </li>
              </ul>
            </div>

            {/* After Column */}
            <div className={`p-6 md:p-8 bg-emerald-50/40 transition-opacity duration-300 ${sliderPos < 25 ? "opacity-40" : "opacity-100"}`}>
              <div className="flex items-center gap-2 text-emerald-700 mb-4">
                <CheckCircle2 className="h-5 w-5" />
                <h3 className="font-display text-xl font-bold">With Aura Salon OS</h3>
              </div>
              <ul className="space-y-4 text-xs text-aura-text">
                <li className="flex items-start gap-2.5 font-medium">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" />
                  <span>24/7 WhatsApp AI booking concierge converts leads into confirmed slots instantly.</span>
                </li>
                <li className="flex items-start gap-2.5 font-medium">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" />
                  <span>Automated 18% GST billing with 1-click WhatsApp digital receipts & GSTR filing export.</span>
                </li>
                <li className="flex items-start gap-2.5 font-medium">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" />
                  <span>Transparent mobile staff app with real-time tip tracking & auto payroll calculation.</span>
                </li>
                <li className="flex items-start gap-2.5 font-medium">
                  <CheckCircle2 className="h-4 w-4 text-emerald-600 shrink-0 mt-0.5" />
                  <span>WMA inventory recipe costing prevents product waste & triggers low-stock alerts.</span>
                </li>
              </ul>
            </div>
          </div>
        </div>
      </Container>
    </section>
  );
}
