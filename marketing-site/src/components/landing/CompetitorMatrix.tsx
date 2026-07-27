"use client";

import { Check, X, Sparkles } from "lucide-react";
import { Container } from "@/components/ui/Container";
import { SectionHeading } from "@/components/ui/SectionHeading";

type FeatureRow = {
  name: string;
  aura: boolean | string;
  legacy: boolean | string;
  paper: boolean | string;
};

const COMPARISON_DATA: FeatureRow[] = [
  { name: "Indian GST Billing (18% CGST/SGST)", aura: true, legacy: "Extra Paid Add-on", paper: false },
  { name: "24/7 WhatsApp AI Booking Assistant", aura: true, legacy: false, paper: false },
  { name: "3-Tier Ecosystem (Owner POS + Customer App + Staff App)", aura: true, legacy: false, paper: false },
  { name: "WMA Inventory Recipe Costing (Grams per Service)", aura: true, legacy: "Enterprise Tier Only", paper: false },
  { name: "Realtime Mobile Staff Attendance & Tip Sync", aura: true, legacy: false, paper: false },
  { name: "Zero Platform Booking Commission Fee", aura: true, legacy: "15-20% per booking", paper: true },
  { name: "Multi-Branch IST Realtime Aggregation", aura: true, legacy: true, paper: false },
];

export function CompetitorMatrix() {
  return (
    <section className="bg-aura-dark py-20 text-white md:py-28 overflow-hidden">
      <Container>
        <SectionHeading
          badge="Why Salons Choose Aura"
          title="Designed Specifically for Indian Salons"
          subtitle="Stop paying heavy commissions to legacy software. Aura gives you total control with zero commission fees."
          align="center"
          className="[&_h2]:text-white [&_p]:text-white/60 [&>span]:text-aura-copper"
        />

        <div className="mt-10 overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse text-left text-xs">
            <thead>
              <tr className="border-b border-white/15 text-white/50 uppercase tracking-wider">
                <th className="py-4 px-4 font-bold">Platform Feature</th>
                <th className="py-4 px-4 font-bold text-aura-copper bg-white/5 rounded-t-xl">
                  <div className="flex items-center gap-1.5 text-sm text-white">
                    <Sparkles className="h-4 w-4 text-aura-copper" /> Aura Salon OS
                  </div>
                </th>
                <th className="py-4 px-4 font-bold">Legacy Foreign Software</th>
                <th className="py-4 px-4 font-bold">Paper / Registers</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/10">
              {COMPARISON_DATA.map((row, idx) => (
                <tr key={idx} className="hover:bg-white/5 transition-colors">
                  <td className="py-4 px-4 font-semibold text-white/90">{row.name}</td>
                  <td className="py-4 px-4 bg-white/5 font-bold text-emerald-400">
                    {typeof row.aura === "boolean" ? (
                      row.aura ? <Check className="h-5 w-5 text-emerald-400" /> : <X className="h-5 w-5 text-red-400" />
                    ) : (
                      row.aura
                    )}
                  </td>
                  <td className="py-4 px-4 text-white/60">
                    {typeof row.legacy === "boolean" ? (
                      row.legacy ? <Check className="h-4 w-4 text-white/60" /> : <X className="h-4 w-4 text-red-400" />
                    ) : (
                      row.legacy
                    )}
                  </td>
                  <td className="py-4 px-4 text-white/40">
                    {typeof row.paper === "boolean" ? (
                      row.paper ? <Check className="h-4 w-4 text-white/40" /> : <X className="h-4 w-4 text-red-400" />
                    ) : (
                      row.paper
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Container>
    </section>
  );
}
