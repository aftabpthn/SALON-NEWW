"use client";

import { useState } from "react";
import { Search, HelpCircle, ChevronDown, Sparkles } from "lucide-react";
import { Container } from "@/components/ui/Container";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { PRICING_FAQ } from "@/lib/constants";
import { soundEngine } from "@/components/ui/SoundEffects";

export function InteractiveFAQ() {
  const [query, setQuery] = useState("");
  const [openIndex, setOpenIndex] = useState<number | null>(0);

  const filteredFaqs = PRICING_FAQ.filter(
    (faq) =>
      faq.question.toLowerCase().includes(query.toLowerCase()) ||
      faq.answer.toLowerCase().includes(query.toLowerCase())
  );

  const toggle = (idx: number) => {
    soundEngine.playClick();
    setOpenIndex(openIndex === idx ? null : idx);
  };

  return (
    <section className="bg-aura-surface py-20 md:py-28 overflow-hidden">
      <Container>
        <SectionHeading
          badge="Frequently Asked Questions"
          title="Everything You Need to Know About Aura"
          subtitle="Instant answers to questions salon owners ask before getting started."
        />

        {/* Real-time Search Input */}
        <div className="mt-8 mx-auto max-w-xl relative">
          <Search className="absolute left-4 top-3.5 h-5 w-5 text-aura-text-muted" />
          <input
            type="text"
            placeholder="Search questions (e.g. GST, WhatsApp, Hardware, Trial)..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full rounded-2xl border border-aura-border bg-aura-surface-muted pl-12 pr-4 py-3 text-sm text-aura-text outline-none focus:border-aura-burgundy focus:ring-2 focus:ring-aura-rose-soft"
          />
        </div>

        {/* Accordion List */}
        <div className="mt-10 mx-auto max-w-3xl space-y-3">
          {filteredFaqs.length === 0 ? (
            <p className="text-center py-8 text-xs text-aura-text-muted">No questions found matching "{query}". Contact us for instant help!</p>
          ) : (
            filteredFaqs.map((faq, idx) => {
              const isOpen = openIndex === idx;
              return (
                <div
                  key={idx}
                  className="rounded-2xl border border-aura-border bg-white overflow-hidden shadow-sm transition-all"
                >
                  <button
                    type="button"
                    onClick={() => toggle(idx)}
                    className="w-full flex items-center justify-between p-5 text-left text-sm font-bold text-aura-text hover:bg-aura-surface-muted transition-colors"
                  >
                    <span className="flex items-center gap-2">
                      <HelpCircle className="h-4 w-4 text-aura-burgundy shrink-0" />
                      {faq.question}
                    </span>
                    <ChevronDown className={`h-4 w-4 text-aura-text-muted transition-transform duration-200 ${isOpen ? "rotate-180 text-aura-burgundy" : ""}`} />
                  </button>
                  {isOpen && (
                    <div className="px-5 pb-5 text-xs leading-6 text-aura-text-secondary border-t border-aura-border/50 pt-3 animate-in fade-in">
                      {faq.answer}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </Container>
    </section>
  );
}
