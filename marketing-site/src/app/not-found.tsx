"use client";

import Link from "next/link";
import { useRef } from "react";
import { motion, useInView } from "motion/react";
import { ArrowRight, Home, Search, ArrowLeft } from "lucide-react";
import { Container } from "@/components/ui/Container";
import { FloatingGeometry } from "@/components/three/FloatingGeometry";
import { useLanguage } from "@/components/providers/LanguageProvider";

const suggestedLinks = [
  { label: "Home", href: "/", icon: Home },
  { label: "Features", href: "/features", icon: Search },
  { label: "Pricing", href: "/pricing", icon: ArrowRight },
];

export default function NotFound() {
  const { t } = useLanguage();
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-80px" });

  return (
    <section className="relative min-h-[85vh] flex items-center justify-center bg-deep-navy overflow-hidden">
      {/* Three.js background */}
      <div className="absolute inset-0 opacity-30">
        <FloatingGeometry variant="minimal" />
      </div>

      {/* Gradient orbs */}
      <div className="absolute top-1/4 left-1/4 w-80 h-80 rounded-full bg-neon-violet/10 blur-[120px] animate-float" />
      <div className="absolute bottom-1/4 right-1/4 w-72 h-72 rounded-full bg-aura-rose/8 blur-[100px] animate-float" style={{ animationDelay: "3s" }} />

      <Container className="relative z-10">
        <motion.div
          ref={ref}
          initial={{ opacity: 0, y: 40 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
          className="text-center"
        >
          {/* Giant 404 with gradient */}
          <motion.div
            initial={{ scale: 0.8, opacity: 0 }}
            animate={inView ? { scale: 1, opacity: 1 } : {}}
            transition={{ duration: 0.6, type: "spring", stiffness: 200 }}
            className="relative inline-block mb-8"
          >
            <span className="text-[8rem] md:text-[12rem] font-black leading-none bg-gradient-to-r from-neon-violet via-aura-rose to-aura-amber bg-clip-text text-transparent select-none">
              404
            </span>
            {/* Glow behind 404 */}
            <div className="absolute inset-0 -m-8 bg-gradient-to-r from-neon-violet/20 via-aura-rose/15 to-aura-amber/10 blur-3xl -z-10" />
          </motion.div>

          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={inView ? { opacity: 1, y: 0 } : {}}
            transition={{ duration: 0.5, delay: 0.2 }}
            className="text-2xl md:text-3xl font-bold text-white mb-3"
          >
             {t("notFound.title")}
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 20 }}
            animate={inView ? { opacity: 1, y: 0 } : {}}
            transition={{ duration: 0.5, delay: 0.3 }}
            className="text-white/50 mb-10 max-w-md mx-auto"
          >
             {t("notFound.body")}
          </motion.p>

          {/* Suggested links */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={inView ? { opacity: 1, y: 0 } : {}}
            transition={{ duration: 0.5, delay: 0.4 }}
            className="flex flex-wrap items-center justify-center gap-3 mb-8"
          >
            {suggestedLinks.map((link) => (
              <Link
                key={link.label}
                href={link.href}
                className="group inline-flex items-center gap-2 px-5 py-2.5 text-sm font-medium text-white/60 border border-white/10 rounded-xl hover:bg-white/5 hover:border-white/20 hover:text-white transition-all duration-300"
              >
                <link.icon className="w-4 h-4" />
                 {link.href === "/" ? t("notFound.home") : link.href === "/features" ? t("notFound.features") : t("notFound.pricing")}
              </Link>
            ))}
          </motion.div>

          {/* Back button */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={inView ? { opacity: 1 } : {}}
            transition={{ delay: 0.5 }}
          >
            <button
              onClick={() => window.history.back()}
              className="inline-flex items-center gap-2 text-sm text-white/30 hover:text-white/60 transition-colors"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
               {t("notFound.back")}
            </button>
          </motion.div>
        </motion.div>
      </Container>
    </section>
  );
}
