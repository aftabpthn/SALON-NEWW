"use client";

import { useRef } from "react";
import { motion, useInView } from "motion/react";
import { Container } from "@/components/ui/Container";
import { SectionHeading } from "@/components/ui/SectionHeading";
import {
  AlertTriangle, Clock, CreditCard, FileText, Users, Package,
  Zap, Calendar, BarChart3, Shield, Bot, Smartphone,
} from "lucide-react";
import { useLanguage } from "@/components/providers/LanguageProvider";

const problems = [
  { icon: FileText, text: "problem.p1" }, { icon: Clock, text: "problem.p2" }, { icon: CreditCard, text: "problem.p3" },
  { icon: Users, text: "problem.p4" }, { icon: Package, text: "problem.p5" }, { icon: AlertTriangle, text: "problem.p6" },
];

const solutions = [
  { icon: Zap, text: "problem.s1" }, { icon: Calendar, text: "problem.s2" }, { icon: BarChart3, text: "problem.s3" },
  { icon: Shield, text: "problem.s4" }, { icon: Bot, text: "problem.s5" }, { icon: Smartphone, text: "problem.s6" },
];

function ProblemItem({ item, index }: { item: typeof problems[number]; index: number }) {
  const { t } = useLanguage();
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-40px" });

  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, x: -30, clipPath: "inset(0 100% 0 0)" }}
      animate={inView ? { opacity: 1, x: 0, clipPath: "inset(0 0% 0 0)" } : {}}
      transition={{ duration: 0.5, delay: index * 0.07, ease: [0.16, 1, 0.3, 1] }}
      className="group flex min-h-16 items-center gap-4 border-b border-aura-border/70 py-3"
    >
      <div className="flex-shrink-0 w-10 h-10 rounded-xl bg-danger/10 flex items-center justify-center group-hover:bg-danger/15 group-hover:scale-110 transition-all duration-300">
        <item.icon className="w-5 h-5 text-danger" />
      </div>
      <span className="text-sm font-medium text-aura-text-secondary">{t(item.text)}</span>
    </motion.div>
  );
}

function SolutionItem({ item, index }: { item: typeof solutions[number]; index: number }) {
  const { t } = useLanguage();
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-40px" });

  return (
    <motion.div
      ref={ref}
      initial={{ opacity: 0, x: 30, clipPath: "inset(0 0 0 100%)" }}
      animate={inView ? { opacity: 1, x: 0, clipPath: "inset(0 0 0 0%)" } : {}}
      transition={{ duration: 0.5, delay: index * 0.07, ease: [0.16, 1, 0.3, 1] }}
      className="group flex min-h-16 items-center gap-4 border-b border-white/10 py-3"
    >
      <div className="flex-shrink-0 w-10 h-10 rounded-xl bg-emerald-500/10 flex items-center justify-center group-hover:bg-emerald-500/15 group-hover:scale-110 transition-all duration-300">
        <item.icon className="w-5 h-5 text-emerald-600" />
      </div>
      <span className="text-sm font-medium text-white/70">{t(item.text)}</span>
    </motion.div>
  );
}

export function ProblemSolution() {
  const { t } = useLanguage();
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-100px" });

  return (
    <section ref={ref} className="py-20 md:py-32 bg-aura-surface">
      <Container>
        <SectionHeading
          badge={t("problem.badge")}
          title={t("problem.title")}
          subtitle={t("problem.subtitle")}
          align="left"
        />

        <div className="mt-14 grid overflow-hidden rounded-[1.75rem] border border-aura-border md:grid-cols-2 max-w-6xl">
          {/* Problem Side */}
          <div className="bg-aura-bg p-6 sm:p-8 lg:p-10">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={inView ? { opacity: 1, y: 0 } : {}}
              transition={{ duration: 0.5 }}
              className="mb-6"
            >
              <span className="inline-flex items-center gap-1.5 px-3 py-1 text-xs font-semibold rounded-full bg-danger/10 text-danger mb-3">
                {t("problem.old")}
              </span>
              <h3 className="font-display text-3xl font-normal text-aura-text">{t("problem.oldTitle")}</h3>
            </motion.div>
            <div className="space-y-3">
              {problems.map((item, i) => (
                <ProblemItem key={item.text} item={item} index={i} />
              ))}
            </div>
          </div>

          {/* Solution Side */}
          <div className="bg-[#21191c] p-6 sm:p-8 lg:p-10">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={inView ? { opacity: 1, y: 0 } : {}}
              transition={{ duration: 0.5, delay: 0.15 }}
              className="mb-6"
            >
              <span className="inline-flex items-center gap-1.5 px-3 py-1 text-xs font-semibold rounded-full bg-emerald-500/10 text-emerald-600 mb-3">
                {t("problem.new")}
              </span>
              <h3 className="font-display text-3xl font-normal text-white">{t("problem.newTitle")}</h3>
            </motion.div>
            <div className="space-y-3">
              {solutions.map((item, i) => (
                <SolutionItem key={item.text} item={item} index={i} />
              ))}
            </div>
          </div>
        </div>
      </Container>
    </section>
  );
}
