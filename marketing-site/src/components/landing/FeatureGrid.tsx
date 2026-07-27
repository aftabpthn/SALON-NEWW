"use client";

import { useRef, useState, useCallback } from "react";
import { motion, useInView, useReducedMotion } from "motion/react";
import Link from "next/link";
import {
  Calendar, CreditCard, Users, UserCheck, Package, Megaphone, TrendingUp, ShieldCheck,
} from "lucide-react";
import { FEATURES } from "@/lib/constants";
import { Container } from "@/components/ui/Container";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { staggerContainer } from "@/lib/animations";
import { useLanguage } from "@/components/providers/LanguageProvider";
import { FEATURE_OVERVIEW_HI } from "@/lib/translations";

const iconMap: Record<string, React.ComponentType<{ className?: string; style?: React.CSSProperties }>> = {
  calendar: Calendar,
  "credit-card": CreditCard,
  users: Users,
  "user-check": UserCheck,
  package: Package,
  megaphone: Megaphone,
  "trending-up": TrendingUp,
  "shield-check": ShieldCheck,
};

function TiltCard({ feature, index }: { feature: typeof FEATURES[number]; index: number }) {
  const { language } = useLanguage();
  const translated = language === "hi" ? FEATURE_OVERVIEW_HI[index] : undefined;
  const cardRef = useRef<HTMLDivElement>(null);
  const reducedMotion = useReducedMotion();
  const [tilt, setTilt] = useState({ rotateX: 0, rotateY: 0, glowX: 50, glowY: 50 });
  const [isHovered, setIsHovered] = useState(false);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!cardRef.current || reducedMotion) return;
    const rect = cardRef.current.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    setTilt({
      rotateX: (0.5 - y) * 4,
      rotateY: (x - 0.5) * 4,
      glowX: x * 100,
      glowY: y * 100,
    });
  }, [reducedMotion]);

  const handleMouseLeave = useCallback(() => {
    setTilt({ rotateX: 0, rotateY: 0, glowX: 50, glowY: 50 });
    setIsHovered(false);
  }, []);

  const Icon = iconMap[feature.icon] || Calendar;

  return (
    <Link href={feature.href} className="block h-full">
      <motion.div
        ref={cardRef}
        onMouseMove={handleMouseMove}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={handleMouseLeave}
        style={{
          transform: `perspective(800px) rotateX(${tilt.rotateX}deg) rotateY(${tilt.rotateY}deg)`,
          transformStyle: "preserve-3d",
        }}
        initial={{ opacity: 0, y: 40, scale: 0.95 }}
        whileInView={{ opacity: 1, y: 0, scale: 1 }}
        viewport={{ once: true, margin: "-50px" }}
        transition={{ type: "spring", stiffness: 200, damping: 20 }}
        className="relative rounded-2xl border border-aura-border bg-aura-surface p-6 sm:p-7 h-full min-h-64 transition-shadow duration-300 cursor-pointer"
        data-cursor-hover
      >
        {/* Glow overlay */}
        <div
          className="absolute inset-0 rounded-2xl opacity-0 transition-opacity duration-500 pointer-events-none"
          style={{
            opacity: isHovered ? 1 : 0,
            background: `radial-gradient(circle 250px at ${tilt.glowX}% ${tilt.glowY}%, ${feature.color}18, transparent 70%)`,
          }}
        />

        {/* Border glow on hover */}
        <div
          className="absolute inset-0 rounded-2xl pointer-events-none transition-opacity duration-500"
          style={{
            opacity: isHovered ? 1 : 0,
            boxShadow: `0 0 0 1px ${feature.color}30, 0 8px 32px ${feature.color}15`,
          }}
        />

        <div className="relative z-10">
          <div
            className="w-11 h-11 rounded-full flex items-center justify-center mb-8 transition-transform duration-300"
            style={{
              backgroundColor: `${feature.color}12`,
              transform: `translateZ(20px) ${isHovered ? "scale(1.1)" : "scale(1)"}`,
            }}
          >
            <Icon className="w-6 h-6" style={{ color: feature.color }} />
          </div>
          <h3
            className="font-display text-2xl font-normal text-aura-text mb-3 transition-colors duration-300"
            style={{ transform: "translateZ(15px)", color: isHovered ? feature.color : undefined }}
          >
            {translated?.title ?? feature.title}
          </h3>
          <p className="max-w-md text-sm text-aura-text-secondary leading-relaxed" style={{ transform: "translateZ(10px)" }}>
            {translated?.description ?? feature.description}
          </p>
        </div>
      </motion.div>
    </Link>
  );
}

export function FeatureGrid() {
  const { t } = useLanguage();
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-80px" });

  return (
    <section ref={ref} className="py-24 md:py-32 bg-aura-bg section-divider">
      <Container>
        <SectionHeading
          badge={t("features.badge")}
          title={t("features.title")}
          subtitle={t("features.subtitle")}
          align="left"
        />

        <motion.div
          variants={staggerContainer}
          initial="hidden"
          animate={inView ? "visible" : "hidden"}
          className="feature-editorial-grid mt-16 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-12 gap-4"
        >
          {FEATURES.map((feature, index) => (
            <TiltCard key={feature.title} feature={feature} index={index} />
          ))}
        </motion.div>

        <div className="mt-12 text-center">
          <Link
            href="/features"
            className="inline-flex items-center gap-2 text-sm font-semibold text-aura-burgundy hover:text-aura-burgundy-strong transition-colors"
          >
            {t("features.all")} →
          </Link>
        </div>
      </Container>
    </section>
  );
}
