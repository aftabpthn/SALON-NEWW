"use client";

import { useState } from "react";
import { motion } from "motion/react";
import { CheckCircle } from "lucide-react";
import { useLanguage } from "@/components/providers/LanguageProvider";

export function Newsletter() {
  const { t } = useLanguage();
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) return;
    setSubmitted(true);
    setEmail("");
  };

  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-6">
      <h3 className="text-sm font-bold text-white mb-2">{t("newsletter.title")}</h3>
      <p className="text-xs text-white/50 mb-4">
        {t("newsletter.body")}
      </p>
      {submitted ? (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-center gap-2 text-sm text-emerald-400"
        >
          <CheckCircle className="w-4 h-4" />
          {t("newsletter.done")}
        </motion.div>
      ) : (
        <form onSubmit={handleSubmit} className="flex gap-2">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@salon.com"
            aria-label={t("newsletter.email")}
            required
            className="flex-1 px-3 py-2 rounded-lg bg-white/10 border border-white/10 text-sm text-white placeholder:text-white/45 focus:outline-none focus:ring-1 focus:ring-aura-burgundy/50"
          />
          <button
            type="submit"
            className="px-4 py-2 rounded-lg bg-aura-burgundy text-white text-xs font-semibold hover:bg-aura-burgundy-strong transition-colors"
          >
            {t("newsletter.join")}
          </button>
        </form>
      )}
    </div>
  );
}
