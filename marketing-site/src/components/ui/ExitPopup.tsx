"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import { X, ArrowRight } from "lucide-react";
import { useLanguage } from "@/components/providers/LanguageProvider";

export function ExitPopup() {
  const { language, t } = useLanguage();
  const [show, setShow] = useState(false);
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const handleMouse = (e: MouseEvent) => {
      if (e.clientY < 10 && !sessionStorage.getItem("exitPopupDismissed")) {
        setShow(true);
      }
    };
    document.addEventListener("mouseleave", handleMouse);
    return () => {
      document.removeEventListener("mouseleave", handleMouse);
    };
  }, []);

  useEffect(() => {
    if (!show) return;
    previousFocus.current = document.activeElement as HTMLElement;
    closeRef.current?.focus();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setShow(false);
        return;
      }
      if (event.key !== "Tab" || !dialogRef.current) return;
      const focusable = dialogRef.current.querySelectorAll<HTMLElement>('button, a[href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      previousFocus.current?.focus();
    };
  }, [show]);

  const dismiss = useCallback(() => {
    setShow(false);
    sessionStorage.setItem("exitPopupDismissed", "true");
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) return;
    setSubmitted(true);
    sessionStorage.setItem("exitPopupDismissed", "true");
  };

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
          onClick={dismiss}
          role="dialog"
          aria-modal="true"
          aria-labelledby="exit-title"
        >
          <motion.div
            ref={dialogRef}
            initial={{ opacity: 0, scale: 0.9, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 10 }}
            transition={{ type: "spring", stiffness: 300, damping: 25 }}
            className="relative w-full max-w-md bg-[#fffdf9] rounded-[1.75rem] shadow-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Close button */}
            <button
              ref={closeRef}
              onClick={dismiss}
              className="absolute top-4 right-4 z-10 w-11 h-11 rounded-full bg-white/80 flex items-center justify-center text-aura-text-muted hover:text-aura-text transition-colors"
              aria-label={t("overlay.close")}
            >
              <X className="w-4 h-4" />
            </button>

            {/* Gradient top */}
            <div className="h-1.5 bg-aura-burgundy" />

            <div className="p-8 text-center">
              {submitted ? (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                >
                  <div className="w-16 h-16 rounded-full bg-emerald-500/10 flex items-center justify-center mx-auto mb-4">
                    <span className="text-3xl">🎉</span>
                  </div>
                  <h3 id="exit-title" className="font-display text-3xl text-aura-text mb-2">{language === "hi" ? "धन्यवाद" : "Thank you"}</h3>
                  <p className="text-sm text-aura-text-secondary">
                    {language === "hi" ? "प्रोडक्ट अपडेट के लिए अपना इनबॉक्स देखें।" : "Check your inbox for product updates from Aura."}
                  </p>
                </motion.div>
              ) : (
                <>
                  <div className="w-16 h-16 rounded-full bg-aura-rose-soft flex items-center justify-center mx-auto mb-4">
                    <span className="font-display text-2xl italic text-aura-burgundy">A</span>
                  </div>
                  <h3 id="exit-title" className="font-display text-3xl font-normal text-aura-text mb-2">
                    {language === "hi" ? "Aura को करीब से जानें" : "Keep exploring Aura"}
                  </h3>
                  <p className="text-sm text-aura-text-secondary mb-6">
                    {language === "hi" ? "सैलून संचालन की गाइड और प्रोडक्ट अपडेट अपने इनबॉक्स में पाएँ।" : "Get practical salon operations guidance and thoughtful product updates in your inbox."}
                  </p>
                  <form onSubmit={handleSubmit} className="space-y-3">
                    <input
                      type="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                       placeholder={t("overlay.email")}
                       aria-label={t("overlay.email")}
                      className="w-full px-4 py-3 rounded-xl border border-aura-border bg-white text-sm text-aura-text placeholder:text-aura-text-muted focus:outline-none focus:ring-2 focus:ring-aura-burgundy/30 focus:border-aura-burgundy/50 transition-all"
                    />
                    <button
                      type="submit"
                      className="w-full inline-flex items-center justify-center gap-2 px-6 py-3 text-sm font-semibold text-white rounded-full bg-aura-burgundy shadow-md hover:bg-aura-burgundy-strong transition-all duration-300"
                    >
                      {language === "hi" ? "अपडेट पाएँ" : "Get product updates"}
                      <ArrowRight className="w-4 h-4" />
                    </button>
                  </form>
                  <p className="text-xs text-aura-text-muted mt-4">
                     {t("overlay.noSpam")}
                  </p>
                </>
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
