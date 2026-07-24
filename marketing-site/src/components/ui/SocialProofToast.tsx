"use client";

import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Radio } from "lucide-react";
import { useLanguage } from "@/components/providers/LanguageProvider";

export function SocialProofToast() {
  const { language } = useLanguage();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const showTimer = setTimeout(() => setVisible(true), 9000);
    const hideTimer = setTimeout(() => setVisible(false), 15000);

    return () => {
      clearTimeout(showTimer);
      clearTimeout(hideTimer);
    };
  }, []);

  return (
    <div className="fixed bottom-4 left-4 z-[45] hidden pointer-events-none sm:block" aria-live="polite">
      <AnimatePresence>
        {visible && (
          <motion.div
            initial={{ opacity: 0, y: 20, x: -20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, x: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, x: -10, scale: 0.95 }}
            transition={{ duration: .45, ease: [0.22, 1, 0.36, 1] }}
            className="flex max-w-xs items-center gap-3 rounded-full border border-aura-border bg-aura-surface/95 px-4 py-3 shadow-xl backdrop-blur-xl"
          >
            {/* Avatar */}
            <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-aura-rose-soft text-aura-burgundy">
              <Radio className="h-4 w-4" />
            </div>

            {/* Text */}
            <div className="min-w-0">
              <div className="text-sm font-semibold text-aura-text truncate">
                {language === "hi" ? "रियल-टाइम संचालन" : "Real-time operations"}
              </div>
              <div className="flex items-center gap-1 text-xs text-aura-text-muted">
                <span>{language === "hi" ? "बुकिंग, कतार और डैशबोर्ड जुड़े रहें" : "Bookings, queue and dashboards stay connected"}</span>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
