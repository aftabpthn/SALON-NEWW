"use client";

import { useRef, useState, useCallback } from "react";
import { motion, useInView, useReducedMotion } from "motion/react";
import { Check } from "lucide-react";
import { PRICING_PLANS, CTA_LINKS } from "@/lib/constants";
import { Container } from "@/components/ui/Container";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { Button } from "@/components/ui/Button";
import { staggerContainer, staggerChild } from "@/lib/animations";
import Link from "next/link";
import { useLanguage } from "@/components/providers/LanguageProvider";
import { PRICING_FEATURES_HI } from "@/lib/translations";

function PricingCard({ tier, index }: { tier: typeof PRICING_PLANS[number]; index: number }) {
  const { language, t } = useLanguage();
  const features = language === "hi" ? PRICING_FEATURES_HI[index] : tier.features;
  const cardRef = useRef<HTMLDivElement>(null);
  const reducedMotion = useReducedMotion();
  const [tilt, setTilt] = useState({ rotateX: 0, rotateY: 0 });

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!cardRef.current || !tier.highlighted || reducedMotion) return;
    const rect = cardRef.current.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    setTilt({ rotateX: (0.5 - y) * 8, rotateY: (x - 0.5) * 8 });
  }, [tier.highlighted, reducedMotion]);

  const handleMouseLeave = useCallback(() => setTilt({ rotateX: 0, rotateY: 0 }), []);

  return (
    <motion.div
      ref={cardRef}
      variants={staggerChild}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      style={tier.highlighted ? {
        transform: `perspective(800px) rotateX(${tilt.rotateX}deg) rotateY(${tilt.rotateY}deg)`,
        transformStyle: "preserve-3d",
      } : undefined}
      className={`relative rounded-2xl border p-6 lg:p-8 transition-all duration-300 ${
        tier.highlighted
          ? "border-aura-burgundy/30 bg-white shadow-xl md:scale-[1.04]"
          : "border-aura-border bg-white hover:shadow-lg hover:border-aura-border-strong"
      }`}
    >
      {/* Breathing glow for highlighted */}
      {tier.highlighted && (
        <>
          <div className="absolute -inset-[1px] rounded-2xl animate-breathe pointer-events-none" />
          <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-5 py-1.5 rounded-full bg-gradient-to-r from-aura-burgundy to-aura-rose text-white text-xs font-bold shadow-lg">
             {language === "hi" ? "Growth प्लान" : "Growth plan"}
          </div>
        </>
      )}

      <div className="text-center mb-6">
        <h3 className="text-lg font-bold text-aura-text">{t(`pricing.tier.${index}.name`, tier.name)}</h3>
        <div className="mt-3">
          {tier.monthlyPrice > 0 ? (
            <div className="flex items-baseline justify-center gap-1">
              <span className="text-4xl font-bold text-aura-text">₹{tier.monthlyPrice.toLocaleString("en-IN")}</span>
               <span className="text-sm text-aura-text-muted">{t("common.month")}</span>
            </div>
          ) : (
            <div className="text-4xl font-bold text-aura-text">{t("common.custom")}</div>
          )}
        </div>
        <p className="mt-2 text-sm text-aura-text-secondary">{t(`pricing.tier.${index}.desc`, tier.description)}</p>
      </div>

      <ul className="space-y-2.5 mb-8">
        {features.slice(0, 5).map((feature) => (
          <li key={feature} className="flex items-start gap-2.5 text-sm">
            <Check className="w-4 h-4 text-emerald-500 mt-0.5 flex-shrink-0" />
            <span className="text-aura-text-secondary">{feature}</span>
          </li>
        ))}
      </ul>

      <Button
        asChild
        variant={tier.highlighted ? "primary" : "outline"}
        className="w-full"
      >
        <Link href={CTA_LINKS.trial}>
          {index === 2 ? t("pricing.sales") : t("pricing.start")}
        </Link>
      </Button>
    </motion.div>
  );
}

export function PricingPreview() {
  const { t } = useLanguage();
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-80px" });

  return (
    <section ref={ref} className="py-24 md:py-32 bg-aura-bg section-divider">
      <Container>
        <SectionHeading
          badge={t("pricing.badge")}
          title={t("pricing.title")}
          subtitle={t("pricing.subtitle")}
        />

        <motion.div
          variants={staggerContainer}
          initial="hidden"
          animate={inView ? "visible" : "hidden"}
          className="mt-16 grid md:grid-cols-3 gap-6 lg:gap-8 max-w-5xl mx-auto items-start"
        >
          {PRICING_PLANS.map((tier, i) => (
            <PricingCard key={tier.name} tier={tier} index={i} />
          ))}
        </motion.div>

        <div className="mt-12 text-center">
          <Link
            href="/pricing"
            className="inline-flex items-center gap-2 text-sm font-semibold text-aura-burgundy hover:text-aura-burgundy-strong transition-colors"
          >
            {t("pricing.all")} →
          </Link>
        </div>
      </Container>
    </section>
  );
}
