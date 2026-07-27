"use client";

import { useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import { motion, AnimatePresence, useReducedMotion } from "motion/react";
import { ArrowUpRight, ChevronRight, Languages } from "lucide-react";
import type { NavLink } from "@/lib/types";
import { useLanguage } from "@/components/providers/LanguageProvider";
import { cn } from "@/lib/utils";

interface MobileMenuProps {
  open: boolean;
  onClose: () => void;
  links: NavLink[];
  ctaLinks: { login: string; trial: string };
  pathname: string;
}

function isRouteActive(pathname: string, href: string) {
  return pathname === href || (href !== "/" && pathname.startsWith(`${href}/`));
}

export function MobileMenu({ open, onClose, links, ctaLinks, pathname }: MobileMenuProps) {
  const { language, setLanguage, t } = useLanguage();
  const reducedMotion = useReducedMotion();
  const panelRef = useRef<HTMLDivElement>(null);
  const firstFocusable = useRef<HTMLAnchorElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);

  // Focus trap
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === "Escape") {
      onClose();
      return;
    }
    if (e.key !== "Tab" || !panelRef.current) return;

    const focusables = panelRef.current.querySelectorAll<HTMLElement>(
      'a[href], button, select, [tabindex]:not([tabindex="-1"])'
    );
    if (focusables.length === 0) return;

    const first = focusables[0];
    const last = focusables[focusables.length - 1];

    if (e.shiftKey) {
      if (document.activeElement === first) {
        e.preventDefault();
        last.focus();
      }
    } else {
      if (document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  }, [onClose]);

  useEffect(() => {
    let focusTimer: ReturnType<typeof setTimeout> | undefined;
    if (open) {
      previousFocus.current = document.activeElement as HTMLElement;
      focusTimer = setTimeout(() => firstFocusable.current?.focus(), reducedMotion ? 0 : 180);
      document.addEventListener("keydown", handleKeyDown);
    } else {
      document.removeEventListener("keydown", handleKeyDown);
      previousFocus.current?.focus();
    }
    return () => {
      if (focusTimer) clearTimeout(focusTimer);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open, handleKeyDown, reducedMotion]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={reducedMotion ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: reducedMotion ? 0 : 0.2 }}
          id="mobile-navigation"
          className="fixed inset-0 z-[9996] xl:hidden"
          role="dialog"
          aria-modal="true"
          aria-label={t("nav.primary")}
        >
          {/* Backdrop */}
           <div className="absolute inset-0 bg-aura-dark/45 backdrop-blur-[3px]" onClick={onClose} aria-hidden="true" />

          {/* Menu Panel */}
          <motion.div
            ref={panelRef}
            initial={reducedMotion ? false : { x: "100%" }}
            animate={{ x: 0 }}
            exit={reducedMotion ? { opacity: 0 } : { x: "100%" }}
            transition={{ duration: reducedMotion ? 0 : 0.35, ease: [0.22, 1, 0.36, 1] }}
            className="absolute bottom-0 right-0 top-0 w-full max-w-[30rem] border-l border-aura-border bg-aura-surface shadow-2xl"
          >
            <div className="flex h-full flex-col overflow-y-auto px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:px-7" style={{ paddingTop: "calc(5.25rem + env(safe-area-inset-top))" }}>
              <div className="mb-5 flex flex-wrap items-center justify-between gap-3 border-b border-aura-border pb-5">
                <p className="font-display text-2xl leading-none text-aura-text">Aura <em className="text-aura-burgundy">Salon OS</em></p>
                <div className="flex shrink-0 items-center rounded-full border border-aura-border bg-aura-surface-muted p-1" role="group" aria-label={t("nav.language")}>
                  <Languages className="ml-2 mr-1 h-4 w-4 text-aura-text-muted" aria-hidden="true" />
                  {(["en", "hi"] as const).map((option) => (
                    <button key={option} type="button" onClick={() => setLanguage(option)} aria-pressed={language === option} className={cn("grid h-11 min-w-12 place-items-center rounded-full px-2 text-xs font-bold transition-colors", language === option ? "bg-aura-burgundy text-white" : "text-aura-text-muted hover:bg-white hover:text-aura-text")}>
                      {option === "en" ? "EN" : "हिं"}
                    </button>
                  ))}
                </div>
              </div>
              {/* Navigation Links */}
              <nav className="flex flex-col gap-1" aria-label={t("nav.primary")}>
                {links.map((link, i) => {
                  const active = isRouteActive(pathname, link.href);
                  return (
                    <motion.div key={link.href} initial={reducedMotion ? false : { opacity: 0, x: 14 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: reducedMotion ? 0 : 0.05 + i * 0.035, duration: reducedMotion ? 0 : 0.3 }}>
                      <Link
                        ref={i === 0 ? firstFocusable : undefined}
                        href={link.href}
                        onClick={onClose}
                        aria-current={active ? "page" : undefined}
                        className={cn("flex min-h-14 items-center justify-between gap-4 rounded-xl px-3 py-3 font-display text-[clamp(1.25rem,6vw,1.65rem)] leading-tight transition-colors", active ? "bg-aura-rose-soft text-aura-burgundy" : "text-aura-text hover:bg-aura-surface-muted hover:text-aura-burgundy")}
                      >
                        <span>{t(`nav.${link.href === "/features" ? "features" : link.href.slice(1)}`)}</span>
                        <ChevronRight className={cn("h-4 w-4 shrink-0", active ? "text-aura-burgundy" : "text-aura-text-muted")} aria-hidden="true" />
                      </Link>
                    </motion.div>
                  );
                })}
              </nav>

              {/* Divider */}
              <div className="my-6 h-px bg-aura-border" />

              {/* CTA Buttons */}
              <div className="mt-auto flex flex-col gap-3 pt-2">
                <motion.div
                  initial={reducedMotion ? false : { opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: reducedMotion ? 0 : 0.2, duration: reducedMotion ? 0 : 0.3 }}
                >
                  <a
                    href={ctaLinks.login}
                    className="flex min-h-12 w-full items-center justify-center rounded-xl border border-aura-border px-5 py-3 text-sm font-semibold text-aura-text transition-colors hover:bg-aura-bg-warm focus-visible:outline-2 focus-visible:outline-neon-violet focus-visible:outline-offset-2"
                  >
                    {t("nav.login")}
                  </a>
                </motion.div>
                <motion.div
                  initial={reducedMotion ? false : { opacity: 0, y: 16 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: reducedMotion ? 0 : 0.24, duration: reducedMotion ? 0 : 0.3 }}
                >
                  <a
                    href={ctaLinks.trial}
                    className="flex min-h-12 w-full items-center justify-center rounded-full bg-aura-burgundy px-5 py-3 text-sm font-semibold text-white transition-colors hover:bg-aura-burgundy-strong focus-visible:outline-2 focus-visible:outline-neon-violet focus-visible:outline-offset-2"
                  >
                    {t("nav.trial")}
                    <ArrowUpRight className="ml-1 h-4 w-4" aria-hidden="true" />
                  </a>
                </motion.div>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
