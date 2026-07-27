"use client";

import { useRef } from "react";
import { motion, useInView } from "motion/react";
import { cn } from "@/lib/utils";

interface SectionHeadingProps {
  badge?: string;
  title: string;
  subtitle?: string;
  align?: "center" | "left";
  className?: string;
  gradient?: boolean;
}

function WordByWordReveal({ text, className }: { text: string; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: "-60px" });
  const words = text.split(" ");

  return (
    <span ref={ref} className={cn("inline-block", className)} aria-label={text}>
      {words.map((word, i) => (
        <span key={i} className="inline-block overflow-hidden mr-[0.3em]">
          <motion.span
            initial={{ y: "110%", opacity: 0 }}
            animate={inView ? { y: "0%", opacity: 1 } : {}}
            transition={{
              duration: 0.6,
              delay: i * 0.06,
              ease: [0.16, 1, 0.3, 1],
            }}
            className="inline-block"
          >
            {word}
          </motion.span>
        </span>
      ))}
    </span>
  );
}

export function SectionHeading({
  badge,
  title,
  subtitle,
  align = "center",
  className,
  gradient = false,
}: SectionHeadingProps) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-80px" });

  return (
    <div
      ref={ref}
      className={cn(
        "max-w-3xl",
        align === "center" && "mx-auto text-center",
        className
      )}
    >
      {/* Badge */}
      {badge && (
        <motion.span
          initial={{ opacity: 0, y: 10, scale: 0.95 }}
          animate={inView ? { opacity: 1, y: 0, scale: 1 } : {}}
          transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
          className="inline-flex items-center gap-2 text-[11px] font-bold uppercase tracking-[.18em] text-aura-burgundy mb-5 before:h-px before:w-6 before:bg-aura-amber"
        >
          {badge}
        </motion.span>
      )}

      {/* Title — word-by-word reveal */}
      <h2
        className={cn(
          "font-display text-[clamp(2.2rem,5vw,4.75rem)] font-normal tracking-[-.035em] text-aura-text leading-[1.02] text-balance",
          gradient && "gradient-text"
        )}
      >
        <WordByWordReveal text={title} />
      </h2>

      {/* Subtitle */}
      {subtitle && (
        <motion.p
          initial={{ opacity: 0, y: 16 }}
          animate={inView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.5, delay: 0.25, ease: [0.16, 1, 0.3, 1] }}
          className="mt-6 text-base md:text-lg text-aura-text-secondary leading-relaxed max-w-2xl mx-auto text-pretty"
        >
          {subtitle}
        </motion.p>
      )}
    </div>
  );
}
