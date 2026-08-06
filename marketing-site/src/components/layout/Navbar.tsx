"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion, useReducedMotion } from "motion/react";
import { Menu, X, ArrowUpRight, Languages } from "lucide-react";
import { NAV_LINKS, CTA_LINKS } from "@/lib/constants";
import { cn } from "@/lib/utils";
import { MobileMenu } from "./MobileMenu";
import { useLanguage } from "@/components/providers/LanguageProvider";

function isRouteActive(pathname: string, href: string) {
  return pathname === href || (href !== "/" && pathname.startsWith(`${href}/`));
}

function navKey(href: string) {
  return `nav.${href === "/features" ? "features" : href.slice(1)}`;
}

export function Navbar() {
  const { language, setLanguage, t } = useLanguage();
  const pathname = usePathname();
  const reducedMotion = useReducedMotion();
  const [scrolled, setScrolled] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    const updateSurface = () => setScrolled(window.scrollY > 12);
    updateSurface();
    window.addEventListener("scroll", updateSurface, { passive: true });
    return () => window.removeEventListener("scroll", updateSurface);
  }, []);

  useEffect(() => {
    if (mobileOpen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => { document.body.style.overflow = ""; };
  }, [mobileOpen]);

  useEffect(() => {
    const desktop = window.matchMedia("(min-width: 1280px)");
    const closeAtDesktop = (event: MediaQueryListEvent) => {
      if (event.matches) setMobileOpen(false);
    };
    desktop.addEventListener("change", closeAtDesktop);
    return () => desktop.removeEventListener("change", closeAtDesktop);
  }, []);

  return (
    <>
      <header
        className={cn(
          "fixed inset-x-0 top-0 z-[9997] border-b pt-[env(safe-area-inset-top)] transition-[background-color,border-color,box-shadow] duration-300",
          scrolled || mobileOpen
            ? "border-white/10 bg-aura-dark/95 shadow-[0_10px_35px_rgba(6,22,52,0.2)] backdrop-blur-xl"
            : "border-white/10 bg-aura-dark/90 backdrop-blur-md"
        )}
      >
        <nav className="mx-auto max-w-[90rem] px-3 sm:px-6 xl:px-8 2xl:px-10" aria-label={t("nav.primary")}>
          <div className="flex h-16 items-center justify-between gap-3 sm:h-[4.5rem]">
            {/* Logo */}
            <Link href="/" className="group flex min-h-11 shrink-0 items-center gap-2.5 rounded-xl" aria-label={t("nav.home")}>
              <span className="grid h-10 w-10 place-items-center rounded-[.85rem] bg-aura-cta-cream font-display text-xl italic text-aura-burgundy shadow-[0_6px_18px_rgba(0,0,0,.2)] transition-transform duration-300 group-hover:scale-[1.03]" aria-hidden="true">A</span>
              <span className="leading-none">
                <span className="block font-display text-[1.35rem] tracking-[-.035em] text-white">Aura</span>
                <span className="mt-1 hidden text-[8px] font-bold uppercase tracking-[.2em] text-white/55 md:block">Salon OS</span>
              </span>
            </Link>

            {/* Desktop Nav */}
            <div className="hidden items-center gap-0.5 rounded-full border border-aura-border/75 bg-white/55 p-1 shadow-sm xl:flex">
              {NAV_LINKS.map((link) => {
                const active = isRouteActive(pathname, link.href);
                return (
                  <Link
                    key={link.href}
                    href={link.href}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "relative flex min-h-11 items-center rounded-full px-3.5 text-[13px] font-semibold transition-colors",
                      active ? "text-aura-burgundy" : "text-aura-text-secondary hover:bg-aura-bg-warm/70 hover:text-aura-text"
                    )}
                  >
                    {active && (
                      <motion.span
                        layoutId="desktop-nav-active"
                        className="absolute inset-0 rounded-full border border-aura-border bg-aura-surface shadow-sm"
                        transition={reducedMotion ? { duration: 0 } : { duration: 0.35, ease: "easeOut" }}
                        aria-hidden="true"
                      />
                    )}
                    <span className="relative z-10 whitespace-nowrap">{t(navKey(link.href))}</span>
                  </Link>
                );
              })}
            </div>

            {/* Desktop CTA */}
            <div className="hidden shrink-0 items-center gap-2 xl:flex">
              <div className="flex items-center rounded-full border border-aura-border/80 bg-white/55 p-1" role="group" aria-label={t("nav.language")}>
                <Languages className="ml-2 mr-1 h-4 w-4 text-aura-text-muted" aria-hidden="true" />
                {(["en", "hi"] as const).map((option) => (
                  <button key={option} type="button" onClick={() => setLanguage(option)} aria-pressed={language === option} className={cn("grid h-11 min-w-11 place-items-center rounded-full px-2 text-xs font-bold transition-colors", language === option ? "bg-aura-burgundy text-white shadow-sm" : "text-aura-text-muted hover:bg-aura-bg-warm hover:text-aura-text")}>
                    {option === "en" ? "EN" : "हिं"}
                  </button>
                ))}
              </div>
              <Link
                href={CTA_LINKS.login}
                className="inline-flex min-h-11 items-center rounded-full px-3 text-sm font-semibold text-white/75 transition-colors hover:bg-white/10 hover:text-white"
              >
                {t("nav.login")}
              </Link>
              <Link
                href={CTA_LINKS.trial}
                className="group inline-flex min-h-11 items-center gap-2 whitespace-nowrap rounded-full bg-aura-cta-cream px-5 text-sm font-semibold text-aura-burgundy shadow-[0_8px_20px_rgba(0,0,0,.2)] transition-[background-color,box-shadow] duration-300 hover:bg-white hover:shadow-[0_10px_25px_rgba(0,0,0,.25)]"
              >
                {t("nav.trial")}
                <ArrowUpRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" aria-hidden="true" />
              </Link>
            </div>

            <div className="ml-auto flex shrink-0 items-center gap-2 xl:hidden">
              <Link href={CTA_LINKS.trial} className="hidden min-h-11 items-center whitespace-nowrap rounded-full bg-aura-cta-cream px-4 text-sm font-semibold text-aura-burgundy shadow-sm sm:inline-flex">
                {t("nav.trial")}
              </Link>
              <button
                type="button"
                onClick={() => setMobileOpen((open) => !open)}
                className={cn("relative z-50 grid h-11 w-11 place-items-center rounded-[.85rem] border transition-colors", mobileOpen ? "border-white/20 bg-white text-aura-burgundy" : "border-white/20 bg-white/10 text-white hover:bg-white/20")}
                aria-label={mobileOpen ? t("nav.close") : t("nav.open")}
                aria-expanded={mobileOpen}
                aria-controls="mobile-navigation"
              >
                {mobileOpen ? <X className="h-5 w-5" aria-hidden="true" /> : <Menu className="h-5 w-5" aria-hidden="true" />}
              </button>
            </div>
          </div>
        </nav>
      </header>

      <MobileMenu
        open={mobileOpen}
        onClose={() => setMobileOpen(false)}
        links={NAV_LINKS}
        ctaLinks={CTA_LINKS}
        pathname={pathname}
      />
    </>
  );
}
