"use client";

import { motion } from "motion/react";
import {
  Calendar, CreditCard, Users, Package, Megaphone,
  TrendingUp, ShieldCheck, Palette, Check, ArrowRight,
} from "lucide-react";
import { Container } from "@/components/ui/Container";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { Button } from "@/components/ui/Button";
import { GridBackground } from "@/components/ui/GridBackground";
import { CTA_LINKS } from "@/lib/constants";
import { fadeInUp, staggerContainer, staggerChild } from "@/lib/animations";
import type { FeaturePageData } from "@/lib/types";

const CAPABILITY_ICONS = [
  Calendar, CreditCard, Users, Package, Megaphone,
  TrendingUp, ShieldCheck, Palette, Check,
];

interface FeaturePageTemplateProps {
  data: FeaturePageData;
}

export function FeaturePageTemplate({ data }: FeaturePageTemplateProps) {
  return (
    <>
      <section className="relative pt-28 pb-20 md:pt-36 md:pb-28 bg-gradient-to-b from-aura-bg to-white overflow-hidden">
        <GridBackground className="opacity-30" />
        <div className="absolute top-20 left-1/4 w-72 h-72 rounded-full bg-neon-violet/8 blur-[100px]" />
        <div className="absolute bottom-10 right-1/4 w-72 h-72 rounded-full bg-aura-rose/8 blur-[100px]" />

        <Container className="relative z-10">
          <motion.div
            initial={{ opacity: 0, y: 40 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
            className="max-w-3xl mx-auto text-center"
          >
            <span className="inline-flex items-center gap-1.5 px-3 py-1 text-xs font-semibold rounded-full bg-neon-violet/10 text-neon-violet mb-6">
              Feature Spotlight
            </span>
            <h1 className="text-3xl md:text-5xl lg:text-6xl font-bold tracking-tight text-aura-text leading-[1.1]">
              {data.title}
            </h1>
            <p className="mt-4 text-lg md:text-xl text-aura-text-secondary max-w-2xl mx-auto leading-relaxed">
              {data.subtitle}
            </p>
          </motion.div>
        </Container>
      </section>

      {data.stats && (
        <section className="py-12 bg-white border-y border-aura-border">
          <Container>
            <div className="grid grid-cols-3 gap-8 max-w-3xl mx-auto">
              {data.stats.map((stat, i) => (
                <motion.div
                  key={stat.label}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.3 + i * 0.1, duration: 0.5 }}
                  className="text-center"
                >
                  <div className="text-2xl md:text-3xl font-bold gradient-text">{stat.value}</div>
                  <div className="text-sm text-aura-text-muted mt-1">{stat.label}</div>
                </motion.div>
              ))}
            </div>
          </Container>
        </section>
      )}

      <section className="py-20 md:py-28 bg-aura-bg">
        <Container>
          <SectionHeading
            badge="Capabilities"
            title="What You Get"
            subtitle="Powerful features designed specifically for salon operations."
          />
          <motion.div
            variants={staggerContainer}
            initial="hidden"
            whileInView="visible"
            viewport={{ once: true, margin: "-80px" }}
            className="mt-16 grid md:grid-cols-2 gap-6 max-w-5xl mx-auto"
          >
            {data.capabilities.map((cap, i) => {
              const Icon = CAPABILITY_ICONS[i % CAPABILITY_ICONS.length];
              return (
                <motion.div
                  key={cap.title}
                  variants={staggerChild}
                  className="glow-card rounded-2xl border border-aura-border bg-white p-8 transition-all duration-300 hover:shadow-lg hover:border-transparent group"
                >
                  <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-neon-violet/15 to-aura-rose/15 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform duration-300">
                    <Icon className="w-5 h-5 text-neon-violet" />
                  </div>
                  <h3 className="text-lg font-bold text-aura-text mb-2">{cap.title}</h3>
                  <p className="text-sm text-aura-text-secondary leading-relaxed">{cap.description}</p>
                </motion.div>
              );
            })}
          </motion.div>
        </Container>
      </section>

      <section className="py-20 bg-white">
        <Container>
          <motion.div
            initial={{ opacity: 0, y: 40 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.7 }}
            className="text-center"
          >
            <h2 className="text-2xl md:text-3xl font-bold text-aura-text mb-4">
              Experience {data.title} in Action
            </h2>
            <p className="text-aura-text-secondary mb-8 max-w-xl mx-auto">
              Start your free trial and see how {data.title.toLowerCase()} can transform your salon operations.
            </p>
            <a href={CTA_LINKS.trial}>
              <Button variant="primary" size="lg">
                Start Free Trial
                <ArrowRight className="w-4 h-4 ml-1" />
              </Button>
            </a>
          </motion.div>
        </Container>
      </section>
    </>
  );
}
