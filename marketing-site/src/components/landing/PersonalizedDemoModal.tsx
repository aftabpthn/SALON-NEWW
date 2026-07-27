"use client";

import { useState } from "react";
import { Sparkles, ArrowRight, CheckCircle2, Store } from "lucide-react";
import { Container } from "@/components/ui/Container";
import { SectionHeading } from "@/components/ui/SectionHeading";

export function PersonalizedDemoModal() {
  const [salonName, setSalonName] = useState("");
  const [city, setCity] = useState("Mumbai");
  const [previewActive, setPreviewActive] = useState(false);

  const handleGenerate = (e: React.FormEvent) => {
    e.preventDefault();
    if (salonName.trim()) {
      setPreviewActive(true);
    }
  };

  return (
    <section className="bg-aura-surface py-20 md:py-28 overflow-hidden">
      <Container>
        <div className="mx-auto max-w-3xl rounded-3xl border border-aura-border bg-white p-6 md:p-10 shadow-2xl">
          <SectionHeading
            badge="Instant Personalized Preview"
            title="See How Aura Works for Your Salon"
            subtitle="Enter your salon name below to generate an instant interactive preview header for your brand."
            align="center"
          />

          <form onSubmit={handleGenerate} className="mt-8 flex flex-col sm:flex-row gap-3">
            <div className="flex-1 relative">
              <Store className="absolute left-3.5 top-3.5 h-5 w-5 text-aura-text-muted" />
              <input
                type="text"
                required
                placeholder="Enter your Salon Name (e.g. Jawed Habib Bandra)"
                value={salonName}
                onChange={(e) => setSalonName(e.target.value)}
                className="w-full rounded-2xl border border-aura-border bg-aura-surface-muted pl-11 pr-4 py-3 text-sm text-aura-text outline-none focus:border-aura-burgundy focus:ring-2 focus:ring-aura-rose-soft"
              />
            </div>
            <select
              value={city}
              onChange={(e) => setCity(e.target.value)}
              className="rounded-2xl border border-aura-border bg-aura-surface-muted px-4 py-3 text-sm text-aura-text outline-none focus:border-aura-burgundy"
            >
              <option value="Mumbai">Mumbai</option>
              <option value="Bengaluru">Bengaluru</option>
              <option value="Delhi NCR">Delhi NCR</option>
              <option value="Hyderabad">Hyderabad</option>
              <option value="Pune">Pune</option>
            </select>
            <button
              type="submit"
              className="inline-flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-aura-burgundy px-6 text-sm font-bold text-white shadow-md hover:bg-aura-burgundy-strong transition-colors"
            >
              <span>Preview Demo</span>
              <ArrowRight className="h-4 w-4" />
            </button>
          </form>

          {previewActive && (
            <div className="mt-8 rounded-2xl border border-aura-border bg-aura-dark p-6 text-white animate-in fade-in duration-300">
              <div className="flex items-center justify-between border-b border-white/10 pb-4">
                <div>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-aura-copper">Personalized Salon Terminal</span>
                  <h4 className="text-xl font-display font-bold text-white">{salonName} • {city}</h4>
                </div>
                <span className="rounded-full bg-emerald-500/20 px-3 py-1 text-xs font-bold text-emerald-400 flex items-center gap-1">
                  <CheckCircle2 className="h-3.5 w-3.5" /> Aura OS Ready
                </span>
              </div>
              <div className="mt-4 grid grid-cols-3 gap-3 text-center text-xs">
                <div className="rounded-xl bg-white/10 p-3">
                  <p className="text-white/60 text-[10px]">Today's Target</p>
                  <p className="text-lg font-bold text-white mt-1">₹45,000</p>
                </div>
                <div className="rounded-xl bg-white/10 p-3">
                  <p className="text-white/60 text-[10px]">WhatsApp Booking Link</p>
                  <p className="text-xs font-bold text-aura-copper mt-1.5 truncate">aura.app/{salonName.toLowerCase().replace(/\s+/g, '')}</p>
                </div>
                <div className="rounded-xl bg-white/10 p-3">
                  <p className="text-white/60 text-[10px]">GST Status</p>
                  <p className="text-xs font-bold text-emerald-400 mt-1.5">18% Enabled ✓</p>
                </div>
              </div>
            </div>
          )}
        </div>
      </Container>
    </section>
  );
}
