"use client";

import { useRef } from "react";
import { motion, useInView, useReducedMotion } from "motion/react";
import { Star, Quote } from "lucide-react";
import { Container } from "@/components/ui/Container";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { TESTIMONIALS } from "@/lib/constants";
import { staggerContainer, staggerChild } from "@/lib/animations";
import { useLanguage } from "@/components/providers/LanguageProvider";

function StarRating({ count }: { count: number }) {
  return (
    <div className="flex gap-0.5" aria-label={`${count} out of 5 stars`}>
      {Array.from({ length: count }, (_, i) => (
        <Star
          key={i}
          className="h-3.5 w-3.5 fill-aura-amber text-aura-amber"
          aria-hidden="true"
        />
      ))}
    </div>
  );
}

function TestimonialCard({
  testimonial,
}: {
  testimonial: (typeof TESTIMONIALS)[number];
}) {
  const { t } = useLanguage();
  const initials = testimonial.name
    .split(" ")
    .map((w) => w[0])
    .join("");

  return (
    <motion.article
      variants={staggerChild}
      className="group relative flex flex-col rounded-2xl border border-aura-border bg-white p-6 transition-[box-shadow,border-color] duration-300 hover:border-aura-border-strong hover:shadow-lg lg:p-7"
    >
      <Quote
        className="absolute top-5 right-5 h-8 w-8 text-aura-burgundy/10 transition-colors group-hover:text-aura-burgundy/15"
        aria-hidden="true"
      />

      <StarRating count={testimonial.rating} />

      <blockquote className="mt-4 flex-1 text-[15px] leading-relaxed text-aura-text-secondary">
        &ldquo;{testimonial.quote}&rdquo;
      </blockquote>

      <div className="mt-6 flex items-center gap-3 border-t border-aura-border pt-5">
        <div
          className="grid h-10 w-10 place-items-center rounded-full bg-aura-rose-soft text-xs font-bold text-aura-burgundy"
          aria-hidden="true"
        >
          {initials}
        </div>
        <div>
          <p className="text-sm font-semibold text-aura-text">
            {testimonial.name}
          </p>
          <p className="text-xs text-aura-text-muted">
            {testimonial.role},{" "}
            {t(`testimonials.${testimonial.salon.toLowerCase().replace(/\s+/g, "")}`) ?? testimonial.salon}
            , {testimonial.city}
          </p>
        </div>
      </div>
    </motion.article>
  );
}

export function Testimonials() {
  const { t } = useLanguage();
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: "-80px" });
  const reducedMotion = useReducedMotion();

  return (
    <section ref={ref} className="bg-white py-20 md:py-28">
      <Container>
        <SectionHeading
          badge={t("proof.badge")}
          title={t("proof.title")}
          subtitle={t("proof.body")}
        />
        <motion.div
          variants={staggerContainer}
          initial={reducedMotion ? false : "hidden"}
          animate={inView ? "visible" : reducedMotion ? "hidden" : "hidden"}
          className="mx-auto mt-12 grid max-w-6xl gap-5 sm:grid-cols-2 lg:grid-cols-3"
        >
          {TESTIMONIALS.map((testimonial) => (
            <TestimonialCard
              key={testimonial.name}
              testimonial={testimonial}
            />
          ))}
        </motion.div>
      </Container>
    </section>
  );
}
