"use client";

import { useState } from "react";
import { CheckCircle2, CircleDot, MoreHorizontal, Sparkles, Receipt, Calendar, UserCheck, ShieldCheck, Zap, ArrowRight, MessageSquare } from "lucide-react";
import type { EcosystemRole } from "@/lib/ecosystem-content";
import { ECOSYSTEM_CONTENT } from "@/lib/ecosystem-content";
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

export function ProductShell({ role, label, eyebrow, title, body, points, note, disclosure }: ProductShellProps) {
  const { language } = useLanguage();
  const copy = ECOSYSTEM_CONTENT[language];
  const [activeTab, setActiveTab] = useState<"overview" | "preview">("preview");

  return (
    <div className="min-w-0" data-media-slot="">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-[10px] font-bold uppercase tracking-[.12em] text-white/45">
        <span>{disclosure}</span>
        <div className="flex items-center gap-2">
          <button 
            type="button"
            onClick={() => setActiveTab("preview")} 
            className={`rounded-full px-2.5 py-0.5 transition-colors ${activeTab === "preview" ? "bg-white/20 text-white" : "hover:text-white/80"}`}
          >
            Live UI Preview
          </button>
          <button 
            type="button"
            onClick={() => setActiveTab("overview")} 
            className={`rounded-full px-2.5 py-0.5 transition-colors ${activeTab === "overview" ? "bg-white/20 text-white" : "hover:text-white/80"}`}
          >
            Features
          </button>
        </div>
      </div>
      <div className="overflow-hidden rounded-[1.5rem] border border-white/10 bg-aura-bg p-3 text-aura-text shadow-2xl sm:p-5">
        <div className="flex items-center justify-between border-b border-aura-border pb-3">
          <div className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full bg-aura-burgundy animate-pulse" />
            <span className="text-xs font-semibold">Aura OS · {eyebrow}</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="rounded-full bg-aura-burgundy/10 px-2 py-0.5 text-[10px] font-bold text-aura-burgundy">v2.4 Active</span>
            <MoreHorizontal className="h-4 w-4 text-aura-text-muted" aria-hidden="true" />
          </div>
        </div>

        {activeTab === "preview" ? (
          <div className="mt-4 grid gap-4 lg:grid-cols-[1.1fr_.9fr]">
            {/* Live Visual Simulation Panel */}
            <div className="rounded-2xl border border-aura-border bg-white p-5 shadow-sm">
              {role === "owner" && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between border-b border-aura-border pb-3">
                    <div className="flex items-center gap-2">
                      <Receipt className="h-4 w-4 text-aura-burgundy" />
                      <span className="text-xs font-bold uppercase tracking-wider text-aura-text">Express Billing Terminal</span>
                    </div>
                    <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-800">GST Compliant (18%)</span>
                  </div>
                  <div className="space-y-2">
                    <div className="flex justify-between text-xs py-1.5 border-b border-aura-border/50">
                      <span className="font-medium text-aura-text">Signature Hair Spa + Keratin Gloss</span>
                      <span className="font-bold text-aura-text">₹2,800</span>
                    </div>
                    <div className="flex justify-between text-xs py-1.5 border-b border-aura-border/50">
                      <span className="font-medium text-aura-text">Olaplex Hair Treatment (Add-on)</span>
                      <span className="font-bold text-aura-text">₹1,200</span>
                    </div>
                    <div className="flex justify-between text-xs py-1.5 text-aura-text-secondary">
                      <span>Subtotal</span>
                      <span>₹4,000</span>
                    </div>
                    <div className="flex justify-between text-xs text-aura-text-secondary">
                      <span>CGST (9%) + SGST (9%)</span>
                      <span>₹720</span>
                    </div>
                    <div className="flex justify-between text-sm font-bold text-aura-burgundy border-t border-aura-border pt-2">
                      <span>Total Payable</span>
                      <span>₹4,720</span>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2 pt-2">
                    <div className="rounded-xl bg-emerald-50 border border-emerald-200 p-2.5 text-center">
                      <p className="text-[10px] text-emerald-700 font-semibold">WhatsApp Invoice</p>
                      <p className="text-xs font-bold text-emerald-900 mt-0.5">Auto-sent ✓</p>
                    </div>
                    <div className="rounded-xl bg-purple-50 border border-purple-200 p-2.5 text-center">
                      <p className="text-[10px] text-purple-700 font-semibold">Stylist Commission</p>
                      <p className="text-xs font-bold text-purple-900 mt-0.5">₹480 Added</p>
                    </div>
                  </div>
                </div>
              )}

              {role === "customer" && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between border-b border-aura-border pb-3">
                    <div className="flex items-center gap-2">
                      <Calendar className="h-4 w-4 text-aura-burgundy" />
                      <span className="text-xs font-bold uppercase tracking-wider text-aura-text">24/7 Self-Booking Portal</span>
                    </div>
                    <span className="rounded-full bg-aura-burgundy/10 px-2 py-0.5 text-[10px] font-semibold text-aura-burgundy">Live Availability</span>
                  </div>
                  <div className="rounded-xl bg-aura-surface-muted p-3 space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="h-8 w-8 rounded-full bg-aura-burgundy text-white grid place-items-center text-xs font-bold">AK</div>
                        <div>
                          <p className="text-xs font-bold text-aura-text">Ananya K.</p>
                          <p className="text-[10px] text-aura-text-secondary">Senior Stylist · 4.9★</p>
                        </div>
                      </div>
                      <span className="text-xs font-semibold text-emerald-600">Selected</span>
                    </div>
                    <div className="grid grid-cols-3 gap-1.5 text-center">
                      <div className="rounded-lg bg-white border border-aura-border p-2 text-xs font-medium text-aura-text">11:00 AM</div>
                      <div className="rounded-lg bg-aura-burgundy text-white p-2 text-xs font-bold shadow-sm">02:30 PM</div>
                      <div className="rounded-lg bg-white border border-aura-border p-2 text-xs font-medium text-aura-text">05:00 PM</div>
                    </div>
                  </div>
                  <div className="rounded-xl border border-aura-border bg-white p-3 flex items-center justify-between">
                    <div>
                      <p className="text-[10px] font-bold text-aura-burgundy uppercase">Loyalty Pass applied</p>
                      <p className="text-xs font-semibold text-aura-text">250 Aura Points Balance</p>
                    </div>
                    <span className="text-xs font-bold text-emerald-600">-₹250 Off</span>
                  </div>
                </div>
              )}

              {role === "staff" && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between border-b border-aura-border pb-3">
                    <div className="flex items-center gap-2">
                      <UserCheck className="h-4 w-4 text-aura-burgundy" />
                      <span className="text-xs font-bold uppercase tracking-wider text-aura-text">Staff Mobile Sync Hub</span>
                    </div>
                    <span className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-semibold text-blue-800">Checked In (9:30 AM)</span>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="rounded-xl bg-aura-surface-muted p-3 border border-aura-border">
                      <p className="text-[10px] font-semibold text-aura-text-secondary">Today's Appointments</p>
                      <p className="text-lg font-bold text-aura-text mt-1">7 Clients</p>
                      <p className="text-[10px] text-emerald-600 font-medium">3 Completed · 4 Upcoming</p>
                    </div>
                    <div className="rounded-xl bg-aura-surface-muted p-3 border border-aura-border">
                      <p className="text-[10px] font-semibold text-aura-text-secondary">Today's Commission</p>
                      <p className="text-lg font-bold text-aura-burgundy mt-1">₹1,840</p>
                      <p className="text-[10px] text-purple-600 font-medium">+₹420 Tips earned</p>
                    </div>
                  </div>
                  <div className="rounded-xl border border-aura-border bg-white p-3 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <MessageSquare className="h-4 w-4 text-aura-burgundy" />
                      <div>
                        <p className="text-xs font-bold text-aura-text">Client Notes Alert</p>
                        <p className="text-[10px] text-aura-text-secondary">Pooja S. prefers extra conditioning treatment</p>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {role === "flow" && (
                <div className="space-y-4">
                  <div className="flex items-center justify-between border-b border-aura-border pb-3">
                    <div className="flex items-center gap-2">
                      <Zap className="h-4 w-4 text-aura-burgundy" />
                      <span className="text-xs font-bold uppercase tracking-wider text-aura-text">360° Realtime Ecosystem Architecture</span>
                    </div>
                    <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold text-emerald-800">Zero-Latency Sync</span>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-center text-xs">
                    <div className="rounded-xl bg-aura-surface-muted border border-aura-border p-2.5">
                      <p className="font-bold text-aura-text">Customer App</p>
                      <p className="text-[10px] text-aura-text-secondary mt-1">Self Booking</p>
                    </div>
                    <div className="grid place-items-center">
                      <ArrowRight className="h-4 w-4 text-aura-burgundy animate-pulse" />
                    </div>
                    <div className="rounded-xl bg-aura-burgundy text-white p-2.5">
                      <p className="font-bold">POS & CRM</p>
                      <p className="text-[10px] text-white/80 mt-1">Realtime Ledger</p>
                    </div>
                  </div>
                  <div className="rounded-xl bg-aura-dark p-3 text-white text-xs flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <ShieldCheck className="h-4 w-4 text-aura-copper" />
                      <span>Multi-Tenant Branch Architecture Enabled</span>
                    </div>
                    <span className="text-[10px] text-white/60">IST Synchronized</span>
                  </div>
                </div>
              )}
            </div>

            {/* Content Context Side */}
            <aside className="rounded-2xl bg-aura-dark-elevated p-5 text-white flex flex-col justify-between">
              <div>
                <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[.12em] text-white/40">
                  <CircleDot className="h-3.5 w-3.5 text-aura-copper" aria-hidden="true" />
                  {copy.common.qualification}
                </div>
                <h3 className="mt-2 font-display text-2xl font-normal leading-tight text-white">{title}</h3>
                <p className="mt-2 text-xs leading-5 text-white/70">{body}</p>
                <ul className="mt-4 space-y-2.5 border-t border-white/10 pt-4">
                  {points.slice(0, 3).map((point) => (
                    <li key={point} className="flex items-start gap-2 text-xs leading-5 text-white/80">
                      <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-aura-copper" aria-hidden="true" />
                      <span>{point}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <p className="mt-4 border-t border-white/10 pt-3 text-[11px] leading-5 text-white/40">{note}</p>
            </aside>
          </div>
        ) : (
          <div className={`mt-4 grid gap-3 ${role === "customer" || role === "staff" ? "md:grid-cols-[.72fr_1.28fr]" : "md:grid-cols-[1.25fr_.75fr]"}`}>
            <section className="rounded-2xl border border-aura-border bg-white p-5">
              <p className="text-[10px] font-bold uppercase tracking-[.14em] text-aura-burgundy">{eyebrow}</p>
              <h3 className="mt-3 font-display text-3xl leading-tight text-aura-text">{title}</h3>
              <p className="mt-3 text-sm leading-6 text-aura-text-secondary">{body}</p>
              <div className="mt-6 grid gap-2">
                {points.slice(0, 4).map((point, index) => (
                  <div key={point} className="flex min-h-11 items-center gap-3 rounded-xl bg-aura-surface-muted px-3 text-xs text-aura-text-secondary">
                    <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-white font-semibold text-aura-burgundy">{index + 1}</span>
                    {point}
                  </div>
                ))}
              </div>
            </section>
            <aside className="rounded-2xl bg-aura-dark-elevated p-5 text-white">
              <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[.12em] text-white/40">
                <CircleDot className="h-3.5 w-3.5 text-aura-copper" aria-hidden="true" />
                {copy.common.qualification}
              </div>
              <ul className="mt-5 space-y-3">
                {points.slice(0, 4).map((point) => (
                  <li key={point} className="flex items-start gap-2 border-b border-white/10 pb-3 text-xs leading-5 text-white/65">
                    <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-aura-copper" aria-hidden="true" />
                    {point}
                  </li>
                ))}
              </ul>
              <p className="mt-5 text-[11px] leading-5 text-white/40">{note}</p>
            </aside>
          </div>
        )}
      </div>
    </div>
  );
}

