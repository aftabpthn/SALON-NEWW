"use client";

import { useEffect, useState } from "react";
import { Zap, CheckCircle2 } from "lucide-react";

type Activity = {
  id: string;
  salon: string;
  city: string;
  action: string;
  time: string;
};

const ACTIVITIES: Activity[] = [
  { id: "1", salon: "Jawed Habib Unisex", city: "Mumbai", action: "processed a ₹4,800 GST Invoice", time: "Just now" },
  { id: "2", salon: "Bodycraft Salon & Spa", city: "Bengaluru", action: "auto-booked Keratin Spa via WhatsApp", time: "1m ago" },
  { id: "3", salon: "Enrich Hair & Skin", city: "Pune", action: "auto-calculated ₹12,400 staff commissions", time: "2m ago" },
  { id: "4", salon: "Geetanjali Salon", city: "New Delhi", action: "redeemed 350 Aura Loyalty points", time: "3m ago" },
  { id: "5", salon: "BBlunt Luxury Salon", city: "Hyderabad", action: "checked-in 5 stylists via Mobile App", time: "4m ago" },
];

export function LiveActivityTicker() {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setIndex((prev) => (prev + 1) % ACTIVITIES.length);
    }, 4000);
    return () => clearInterval(timer);
  }, []);

  const current = ACTIVITIES[index];

  return (
    <div className="mt-[calc(4rem+env(safe-area-inset-top))] border-y border-white/10 bg-aura-dark py-2.5 text-xs text-white sm:mt-[calc(4.5rem+env(safe-area-inset-top))]">
      <div className="mx-auto flex min-w-0 max-w-7xl items-center justify-center gap-2 px-3 text-center sm:gap-3 sm:px-4">
        <span className="flex shrink-0 items-center gap-1.5 rounded-full bg-emerald-500/20 px-2.5 py-0.5 font-bold text-emerald-400">
          <span className="h-2 w-2 rounded-full bg-emerald-400 animate-ping" />
          <Zap className="h-3 w-3" /> Live Activity
        </span>
        <div className="flex min-w-0 items-center gap-2 overflow-hidden">
          <span className="truncate font-bold text-aura-copper">{current.salon} ({current.city})</span>
          <span className="hidden text-white/70 sm:inline">{current.action}</span>
          <span className="hidden shrink-0 text-[10px] text-white/40 md:inline">• {current.time}</span>
        </div>
      </div>
    </div>
  );
}
