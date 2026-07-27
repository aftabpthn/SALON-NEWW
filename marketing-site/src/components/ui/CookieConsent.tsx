"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import { X, Cookie } from "lucide-react";
import { useLanguage } from "@/components/providers/LanguageProvider";

const CONSENT_KEY = "aura_cookie_consent";

export function CookieConsent() {
  const { language } = useLanguage();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    try {
      const consent = localStorage.getItem(CONSENT_KEY);
      if (!consent) setVisible(true);
    } catch {
      // localStorage unavailable — show banner
      setVisible(true);
    }
  }, []);

  const accept = () => {
    try {
      localStorage.setItem(CONSENT_KEY, "accepted");
    } catch { /* noop */ }
    setVisible(false);
  };

  const dismiss = () => {
    try {
      localStorage.setItem(CONSENT_KEY, "dismissed");
    } catch { /* noop */ }
    setVisible(false);
  };

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ y: 80, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 80, opacity: 0 }}
          transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
          role="dialog"
          aria-label={language === "hi" ? "कुकी सहमति" : "Cookie consent"}
          className="fixed bottom-0 inset-x-0 z-[9980] p-4 sm:p-6 pointer-events-none"
        >
          <div className="mx-auto max-w-2xl rounded-2xl border border-aura-border bg-white/95 backdrop-blur-xl shadow-[var(--aura-shadow-xl)] p-5 sm:p-6 pointer-events-auto">
            <div className="flex items-start gap-4">
              <div className="hidden sm:flex shrink-0 h-10 w-10 items-center justify-center rounded-xl bg-aura-surface-muted">
                <Cookie className="h-5 w-5 text-aura-burgundy" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-aura-text mb-1">
                  {language === "hi" ? "हम कुकीज़ का उपयोग करते हैं" : "We use cookies"}
                </p>
                <p className="text-xs text-aura-text-secondary leading-relaxed">
                  {language === "hi"
                    ? "हम आवश्यक, प्राथमिकता और विश्लेषणात्मक कुकीज़ का उपयोग करते हैं ताकि आपको बेहतर अनुभव मिले। अधिक जानकारी के लिए हमारी कुकी नीति देखें।"
                    : "We use essential, preference and analytics cookies to improve your experience. See our cookie policy for details."}
                </p>
                <div className="mt-3 flex items-center gap-2">
                  <button
                    type="button"
                    onClick={accept}
                    className="rounded-lg bg-aura-burgundy px-4 py-2 text-xs font-medium text-white transition-all hover:bg-aura-burgundy-strong hover:shadow-md"
                  >
                    {language === "hi" ? "स्वीकार करें" : "Accept"}
                  </button>
                  <button
                    type="button"
                    onClick={dismiss}
                    className="rounded-lg border border-aura-border px-4 py-2 text-xs font-medium text-aura-text-secondary transition-all hover:bg-aura-surface-muted"
                  >
                    {language === "hi" ? "अस्वीकार" : "Decline"}
                  </button>
                  <a
                    href="/cookies"
                    className="text-[11px] text-aura-text-muted underline underline-offset-2 hover:text-aura-text transition-colors ml-1"
                  >
                    {language === "hi" ? "नीति" : "Policy"}
                  </a>
                </div>
              </div>
              <button
                type="button"
                onClick={dismiss}
                aria-label={language === "hi" ? "बंद करें" : "Close"}
                className="shrink-0 flex h-7 w-7 items-center justify-center rounded-lg text-aura-text-muted hover:text-aura-text hover:bg-aura-surface-muted transition-colors"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
