"use client";

import { motion } from "motion/react";
import { Heart, Target, Users, Lightbulb, ArrowRight, Sparkles } from "lucide-react";
import { CTA_LINKS } from "@/lib/constants";
import { Container } from "@/components/ui/Container";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { Button } from "@/components/ui/Button";
import { GridBackground } from "@/components/ui/GridBackground";
import { AnimatedCounter } from "@/components/ui/AnimatedCounter";
import { MagneticElement } from "@/components/ui/MagneticElement";
import { staggerContainer, staggerChild } from "@/lib/animations";

const values = [
  { icon: Heart, title: "Salon-First", description: "Every feature is designed for real salon operations, not generic business needs." },
  { icon: Target, title: "Simplicity", description: "Powerful doesn't mean complicated. We obsess over making complex things simple." },
  { icon: Users, title: "Indian Market", description: "Built for India — GST, UPI, WhatsApp, Indian payroll compliance, IST timezone." },
  { icon: Lightbulb, title: "AI-Powered", description: "Smart automation that learns from your data and gets better every day." },
];

const timeline = [
  { year: "2024", title: "The Spark", description: "Frustrated salon owners inspired us to build better tools." },
  { year: "2024", title: "First 50 Salons", description: "Beta launched with 50 salons in Hyderabad. Instant traction." },
  { year: "2025", title: "500+ Salons", description: "Expanded to 12 cities across India. Processing ₹50Cr+ monthly." },
  { year: "2026", title: "What's Next", description: "AI features, white-label, and franchise management launching." },
];

export default function AboutPage() {
  return (
    <>
      <section className="relative pt-28 pb-20 md:pt-36 md:pb-28 bg-gradient-to-b from-aura-bg to-white overflow-hidden">
        <GridBackground className="opacity-30" />
        <div className="absolute top-20 right-1/4 w-72 h-72 rounded-full bg-neon-violet/8 blur-[100px]" />
        <Container className="relative z-10">
          <motion.div
            initial={{ opacity: 0, y: 40 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7 }}
            className="max-w-3xl mx-auto text-center"
          >
            <span className="inline-flex items-center gap-1.5 px-3 py-1 text-xs font-semibold rounded-full bg-neon-violet/10 text-neon-violet mb-6">
              <Sparkles className="w-3 h-3" />
              Our Story
            </span>
            <h1 className="text-3xl md:text-5xl lg:text-6xl font-bold tracking-tight text-aura-text leading-[1.1]">
              We&apos;re Building the{" "}
              <span className="gradient-text">Future of Salons</span>
            </h1>
            <p className="mt-6 text-lg text-aura-text-secondary max-w-2xl mx-auto leading-relaxed">
              Aura was born from a simple frustration: salon owners deserve better tools.
              We saw talented stylists spending more time on paperwork than clients, and we decided to change that.
            </p>
          </motion.div>
        </Container>
      </section>

      <section className="py-20 md:py-28 bg-white">
        <Container>
          <div className="max-w-4xl mx-auto">
            <motion.div
              initial={{ opacity: 0, y: 32 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.7 }}
              className="text-center mb-16"
            >
              <h2 className="text-2xl md:text-3xl font-bold text-aura-text mb-4">Our Mission</h2>
              <p className="text-lg text-aura-text-secondary leading-relaxed max-w-2xl mx-auto">
                To empower every salon in India with intelligent, beautifully simple technology
                that automates the mundane and lets them focus on what matters most — their clients.
              </p>
            </motion.div>

            <motion.div
              variants={staggerContainer}
              initial="hidden"
              whileInView="visible"
              viewport={{ once: true }}
              className="grid md:grid-cols-2 gap-6"
            >
              {values.map((value) => (
                <motion.div
                  key={value.title}
                  variants={staggerChild}
                  className="glow-card rounded-2xl border border-aura-border bg-white p-8 transition-all duration-300 hover:shadow-lg hover:border-transparent"
                >
                  <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-neon-violet/15 to-aura-rose/15 flex items-center justify-center mb-4">
                    <value.icon className="w-6 h-6 text-neon-violet" />
                  </div>
                  <h3 className="text-lg font-bold text-aura-text mb-2">{value.title}</h3>
                  <p className="text-sm text-aura-text-secondary leading-relaxed">{value.description}</p>
                </motion.div>
              ))}
            </motion.div>
          </div>
        </Container>
      </section>

      <section className="py-20 bg-deep-navy overflow-hidden">
        <Container>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8 max-w-4xl mx-auto text-center">
            {[
              { value: 500, suffix: "+", label: "Salons" },
              { value: 50, suffix: "Cr+", label: "Transactions" },
              { value: 10, suffix: "K+", label: "Daily Bookings" },
              { value: 99.9, suffix: "%", label: "Uptime" },
            ].map((stat) => (
              <div key={stat.label}>
                <div className="text-3xl md:text-4xl font-bold text-white">
                  <AnimatedCounter value={stat.value} />
                  <span>{stat.suffix}</span>
                </div>
                <div className="text-sm text-white/50 mt-1">{stat.label}</div>
              </div>
            ))}
          </div>
        </Container>
      </section>

      <section className="py-20 md:py-28 bg-aura-bg">
        <Container>
          <SectionHeading badge="Timeline" title="Our Journey" subtitle="From a frustration to 500+ salons and counting." />
          <div className="mt-16 max-w-3xl mx-auto relative">
            {/* Line */}
            <div className="absolute left-8 top-0 bottom-0 w-px bg-gradient-to-b from-neon-violet/40 via-aura-rose/30 to-transparent" />

            <div className="space-y-12">
              {timeline.map((item, i) => (
                <motion.div
                  key={item.year}
                  initial={{ opacity: 0, x: -20 }}
                  whileInView={{ opacity: 1, x: 0 }}
                  viewport={{ once: true, margin: "-40px" }}
                  transition={{ duration: 0.5, delay: i * 0.1 }}
                  className="flex gap-6"
                >
                  <div className="relative z-10 flex-shrink-0 w-16 h-16 rounded-2xl bg-gradient-to-br from-neon-violet to-aura-rose flex items-center justify-center text-white text-xs font-bold shadow-lg">
                    {item.year}
                  </div>
                  <div className="pt-2">
                    <h3 className="text-lg font-bold text-aura-text mb-1">{item.title}</h3>
                    <p className="text-sm text-aura-text-secondary leading-relaxed">{item.description}</p>
                  </div>
                </motion.div>
              ))}
            </div>
          </div>
        </Container>
      </section>

      <section className="py-20 bg-white">
        <Container>
          <div className="text-center">
            <h2 className="text-2xl md:text-3xl font-bold text-aura-text mb-4">
              Want to Join Our Journey?
            </h2>
            <p className="text-aura-text-secondary mb-8 max-w-xl mx-auto">
              We&apos;re always looking for passionate people and forward-thinking salons.
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
              <MagneticElement as="a" href={CTA_LINKS.trial}>
                <Button variant="primary" size="lg">
                  Start Free Trial
                  <ArrowRight className="w-4 h-4 ml-1" />
                </Button>
              </MagneticElement>
              <a href="/contact">
                <Button variant="outline" size="lg">Contact Us</Button>
              </a>
            </div>
          </div>
        </Container>
      </section>
    </>
  );
}
