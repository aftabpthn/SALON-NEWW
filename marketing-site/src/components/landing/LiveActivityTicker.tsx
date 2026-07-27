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
    <div className="bg-aura-dark border-y border-white/10 py-2.5 text-white text-xs">
      <div className="mx-auto flex max-w-7xl items-center justify-center gap-3 px-4 text-center">
        <span className="flex items-center gap-1.5 rounded-full bg-emerald-500/20 px-2.5 py-0.5 font-bold text-emerald-400">
          <span className="h-2 w-2 rounded-full bg-emerald-400 animate-ping" />
          <Zap className="h-3 w-3" /> Live Activity
        </span>
        <div className="flex items-center gap-2 overflow-hidden">
          <span className="font-bold text-aura-copper">{current.salon} ({current.city})</span>
          <span className="text-white/70">{current.action}</span>
          <span className="text-[10px] text-white/40">• {current.time}</span>
        </div>
      </div>
    </div>
  );
}
