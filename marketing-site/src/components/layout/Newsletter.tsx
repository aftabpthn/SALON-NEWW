"use client";

import { useState } from "react";
import { motion } from "motion/react";
import { CheckCircle } from "lucide-react";

export function Newsletter() {
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
      <h3 className="text-sm font-bold text-white mb-2">Stay Updated</h3>
      <p className="text-xs text-white/40 mb-4">
        Get salon growth tips and product updates. No spam.
      </p>
      {submitted ? (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex items-center gap-2 text-sm text-emerald-400"
        >
          <CheckCircle className="w-4 h-4" />
          You&apos;re subscribed!
        </motion.div>
      ) : (
        <form onSubmit={handleSubmit} className="flex gap-2">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@salon.com"
            required
            className="flex-1 px-3 py-2 rounded-lg bg-white/10 border border-white/10 text-sm text-white placeholder:text-white/30 focus:outline-none focus:ring-1 focus:ring-neon-violet/50"
          />
          <button
            type="submit"
            className="px-4 py-2 rounded-lg bg-neon-violet text-white text-xs font-semibold hover:bg-neon-violet/80 transition-colors"
          >
            Join
          </button>
        </form>
      )}
    </div>
  );
}
