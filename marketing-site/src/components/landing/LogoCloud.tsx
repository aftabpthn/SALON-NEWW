"use client";

import { useRef } from "react";
import { motion, useInView } from "motion/react";
import { useLanguage } from "@/components/providers/LanguageProvider";

const SALON_NAMES = [
  "Owner command centre", "Front desk", "Appointment calendar", "POS & billing", "Customer 360",
  "Staff OS", "Inventory control", "Marketing automation", "Finance engine", "Multi-branch",
];
const SALON_NAMES_HI = ["मालिक कमांड सेंटर", "फ्रंट डेस्क", "अपॉइंटमेंट कैलेंडर", "POS और बिलिंग", "Customer 360", "Staff OS", "इन्वेंटरी कंट्रोल", "मार्केटिंग ऑटोमेशन", "Finance Engine", "मल्टी-ब्रांच"];

const GRADIENT_PAIRS = [
  ["from-aura-burgundy/20", "to-aura-rose/20"],
  ["from-aura-rose/20", "to-aura-amber/20"],
  ["from-aura-amber/20", "to-emerald-400/20"],
  ["from-emerald-400/20", "to-aura-burgundy/20"],
  ["from-aura-burgundy/15", "to-aura-amber/15"],
  ["from-aura-rose/15", "to-aura-burgundy/15"],
  ["from-aura-amber/15", "to-aura-rose/15"],
  ["from-emerald-400/15", "to-aura-amber/15"],
  ["from-aura-burgundy/20", "to-emerald-400/20"],
  ["from-aura-rose/20", "to-aura-burgundy/20"],
];

export function LogoCloud() {
  const { language, t } = useLanguage();
  const roleNames = language === "hi" ? SALON_NAMES_HI : SALON_NAMES;
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-50px" });

  return (
    <section ref={ref} className="py-14 md:py-18 border-y border-aura-border bg-aura-dark-elevated overflow-hidden">
      <div className="mx-auto max-w-7xl px-6 lg:px-8">
        <motion.p
          initial={{ opacity: 0, y: 10 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.5 }}
          className="text-center text-[11px] font-semibold text-white/50 mb-9 uppercase tracking-[.2em]"
        >
          {t("logos.title")}
        </motion.p>
      </div>

      {/* Infinite marquee — continuous scroll with pause on hover */}
      <div className="relative group">
        {/* Fade edges */}
        <div className="absolute left-0 top-0 bottom-0 w-16 sm:w-24 bg-gradient-to-r from-aura-dark-elevated to-transparent z-10 pointer-events-none" />
        <div className="absolute right-0 top-0 bottom-0 w-16 sm:w-24 bg-gradient-to-l from-aura-dark-elevated to-transparent z-10 pointer-events-none" />

        <motion.div
          initial={{ opacity: 0 }}
          animate={inView ? { opacity: 1 } : {}}
          transition={{ duration: 0.6, delay: 0.1 }}
          className="flex w-max animate-marquee group-hover:[animation-play-state:paused]"
        >
           {[...roleNames, ...roleNames].map((name, i) => {
            const colors = GRADIENT_PAIRS[i % GRADIENT_PAIRS.length];
            return (
              <div
                key={`${name}-${i}`}
                className="inline-flex items-center gap-2.5 px-6 py-3 mx-1.5 rounded-full border border-white/10 bg-white/[.04] transition-colors duration-300 cursor-default hover:bg-white/[.08]"
              >
                <div className={`w-8 h-8 rounded-full bg-gradient-to-br ${colors[0]} ${colors[1]} flex items-center justify-center text-xs font-bold text-aura-copper`}>
                  {name.charAt(0)}
                </div>
                <span className="text-sm font-medium text-white/70 whitespace-nowrap">
                  {name}
                </span>
              </div>
            );
          })}
        </motion.div>
      </div>
    </section>
  );
}
