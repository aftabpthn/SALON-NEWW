"use client";

import { useState } from "react";
import { Calculator, Check, ArrowRight, Share2, Sparkles, Building, Users } from "lucide-react";
import { Container } from "@/components/ui/Container";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { soundEngine } from "@/components/ui/SoundEffects";

export function InstantQuotationModal() {
  const [chairs, setChairs] = useState(6);
  const [branches, setBranches] = useState(1);
  const [whatsappAddon, setWhatsappAddon] = useState(true);
  const [copied, setCopied] = useState(false);

  // Price Calculation: Base ₹1,499 per branch/mo + ₹199 per chair
  const baseMonthly = branches * 1499 + chairs * 199 + (whatsappAddon ? 499 : 0);
  const annualTotal = baseMonthly * 12 * 0.8; // 20% annual discount

  const handleShareQuote = () => {
    soundEngine.playSuccess();
    const text = `Hi Aura Team! I configured a plan for ${branches} branch(es), ${chairs} styling chairs. Estimated Monthly: ₹${Math.round(baseMonthly)}. Please send official onboarding details.`;
    window.location.href = `/contact?subject=${encodeURIComponent(text)}`;
  };

  return (
    <section className="bg-aura-dark py-20 text-white md:py-28 overflow-hidden">
      <Container>
        <SectionHeading
          badge="Transparent Pricing Calculator"
          title="Instant Plan & Quotation Generator"
          subtitle="Configure your salon seats and branches below to receive a custom zero-hidden-fee instant price estimate."
          align="center"
          className="[&_h2]:text-white [&_p]:text-white/60 [&>span]:text-aura-copper"
        />

        <div className="mt-10 mx-auto max-w-4xl rounded-3xl border border-white/15 bg-aura-bg p-6 md:p-8 text-aura-text shadow-2xl">
          <div className="grid md:grid-cols-2 gap-8 items-center">
            {/* Configuration Inputs */}
            <div className="space-y-6">
              <div>
                <label className="flex items-center justify-between text-xs font-bold text-aura-text mb-2">
                  <span className="flex items-center gap-1.5"><Building className="h-4 w-4 text-aura-burgundy" /> Number of Salon Outlets</span>
                  <span className="text-aura-burgundy text-sm">{branches} {branches === 1 ? "Branch" : "Branches"}</span>
                </label>
                <input
                  type="range"
                  min="1"
                  max="10"
                  value={branches}
                  onChange={(e) => { setBranches(Number(e.target.value)); soundEngine.playClick(); }}
                  className="w-full h-2 rounded-lg bg-aura-border appearance-none cursor-pointer accent-aura-burgundy"
                />
              </div>

              <div>
                <label className="flex items-center justify-between text-xs font-bold text-aura-text mb-2">
                  <span className="flex items-center gap-1.5"><Users className="h-4 w-4 text-aura-burgundy" /> Styling Chairs / Stations</span>
                  <span className="text-aura-burgundy text-sm">{chairs} Chairs</span>
                </label>
                <input
                  type="range"
                  min="2"
                  max="40"
                  value={chairs}
                  onChange={(e) => { setChairs(Number(e.target.value)); soundEngine.playClick(); }}
                  className="w-full h-2 rounded-lg bg-aura-border appearance-none cursor-pointer accent-aura-burgundy"
                />
              </div>

              <div className="pt-2">
                <label className="flex items-center justify-between p-3 rounded-2xl border border-aura-border bg-white cursor-pointer shadow-sm">
                  <div className="flex items-center gap-2.5">
                    <input
                      type="checkbox"
                      checked={whatsappAddon}
                      onChange={(e) => { setWhatsappAddon(e.target.checked); soundEngine.playClick(); }}
                      className="rounded border-aura-border text-aura-burgundy focus:ring-aura-burgundy"
                    />
                    <div>
                      <p className="text-xs font-bold text-aura-text">WhatsApp Unlimited AI Booking Bot</p>
                      <p className="text-[10px] text-aura-text-secondary">Auto confirmations, reminders & marketing</p>
                    </div>
                  </div>
                  <span className="text-xs font-bold text-aura-burgundy">+₹499/mo</span>
                </label>
              </div>
            </div>

            {/* Calculated Plan Output */}
            <div className="rounded-2xl bg-aura-dark-elevated p-6 text-white space-y-4 shadow-xl">
              <div className="flex items-center justify-between border-b border-white/10 pb-3">
                <span className="text-xs font-bold text-white/50 uppercase tracking-wider">Custom Plan Estimate</span>
                <span className="rounded-full bg-emerald-500/20 px-2.5 py-0.5 text-[10px] font-bold text-emerald-400">Save 20% Annual</span>
              </div>

              <div>
                <p className="text-xs text-white/60">Estimated Monthly Subscription</p>
                <div className="mt-1 flex items-baseline gap-2">
                  <span className="font-display text-4xl font-bold text-white">₹{Math.round(baseMonthly).toLocaleString('en-IN')}</span>
                  <span className="text-xs text-white/50">/ month + GST</span>
                </div>
                <p className="mt-1 text-[11px] text-aura-copper font-medium">Billed Annually at ₹{Math.round(annualTotal).toLocaleString('en-IN')}/yr</p>
              </div>

              <ul className="space-y-2 border-t border-white/10 pt-4 text-xs text-white/80">
                <li className="flex items-center gap-2"><Check className="h-3.5 w-3.5 text-emerald-400" /> Unlimited GST Bills & Receipts</li>
                <li className="flex items-center gap-2"><Check className="h-3.5 w-3.5 text-emerald-400" /> Full POS + Customer App + Staff Mobile Sync</li>
                <li className="flex items-center gap-2"><Check className="h-3.5 w-3.5 text-emerald-400" /> Free Data Migration & Staff Onboarding Training</li>
              </ul>

              <button
                type="button"
                onClick={handleShareQuote}
                className="w-full flex items-center justify-center gap-2 rounded-xl bg-aura-cta-cream py-3 text-xs font-bold text-aura-burgundy shadow-lg transition-transform hover:scale-[1.02] active:scale-98"
              >
                <Share2 className="h-4 w-4" />
                <span>Share Quote via WhatsApp</span>
              </button>
            </div>
          </div>
        </div>
      </Container>
    </section>
  );
}
