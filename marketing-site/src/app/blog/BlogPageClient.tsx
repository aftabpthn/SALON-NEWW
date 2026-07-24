"use client";

import { useState, useMemo } from "react";
import { motion, AnimatePresence } from "motion/react";
import Link from "next/link";
import { Clock, ArrowRight, Filter } from "lucide-react";
import { BLOG_POSTS } from "@/lib/constants";
import { Container } from "@/components/ui/Container";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { GridBackground } from "@/components/ui/GridBackground";
import { staggerContainer, staggerChild } from "@/lib/animations";
import { useLanguage } from "@/components/providers/LanguageProvider";
import { BLOG_META_HI } from "@/lib/translations";

const CATEGORIES = ["All", ...Array.from(new Set(BLOG_POSTS.map((p) => p.category)))];

export default function BlogPage() {
  const { language, t } = useLanguage();
  const [activeCategory, setActiveCategory] = useState("All");

  const filtered = useMemo(
    () => activeCategory === "All" ? BLOG_POSTS : BLOG_POSTS.filter((p) => p.category === activeCategory),
    [activeCategory]
  );

  return (
    <>
      <section className="relative pt-28 pb-16 md:pt-36 md:pb-20 bg-gradient-to-b from-aura-bg to-white overflow-hidden">
        <GridBackground className="opacity-30" />
        <Container className="relative z-10">
          <SectionHeading
            badge={t("blog.badge")}
            title={t("blog.title")}
            subtitle={t("blog.body")}
          />
        </Container>
      </section>

      <section className="pb-20 md:pb-28 bg-white">
        <Container>
          {/* Category filter */}
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4 }}
            className="flex items-center justify-center gap-2 mb-12 flex-wrap"
          >
            <Filter className="w-4 h-4 text-aura-text-muted mr-1" />
            {CATEGORIES.map((cat) => (
              <button
                key={cat}
                 onClick={() => setActiveCategory(cat)}
                 aria-pressed={activeCategory === cat}
                className={`px-4 py-1.5 text-xs font-semibold rounded-full transition-all duration-300 ${
                  activeCategory === cat
                    ? "bg-neon-violet text-white shadow-md"
                    : "bg-aura-bg-warm text-aura-text-secondary hover:bg-aura-border/50"
                }`}
              >
                 {cat === "All" ? t("blog.all") : language === "hi" ? BLOG_META_HI[BLOG_POSTS.find((post) => post.category === cat)?.slug ?? ""]?.category ?? cat : cat}
              </button>
            ))}
          </motion.div>

          <AnimatePresence mode="wait">
            <motion.div
              key={activeCategory}
              variants={staggerContainer}
              initial="hidden"
              animate="visible"
              exit={{ opacity: 0 }}
              className="grid md:grid-cols-2 lg:grid-cols-3 gap-6 max-w-6xl mx-auto"
            >
               {filtered.map((post, i) => {
                 const translated = language === "hi" ? BLOG_META_HI[post.slug] : undefined;
                 return (
                 <motion.article key={post.slug} variants={staggerChild}>
                  <Link href={`/blog/${post.slug}`} className="block group">
                    <div className={`glow-card h-full rounded-2xl border border-aura-border bg-white overflow-hidden transition-all duration-300 hover:shadow-lg hover:border-transparent hover:-translate-y-1 ${
                      i === 0 && activeCategory === "All" ? "md:col-span-2 lg:col-span-2" : ""
                    }`}>
                      {/* Gradient header */}
                      <div className={`bg-gradient-to-br from-neon-violet/10 via-aura-rose/10 to-aura-amber/10 flex items-center justify-center ${
                        i === 0 && activeCategory === "All" ? "h-48" : "h-40"
                      }`}>
                        <span className={`font-bold gradient-text opacity-30 ${
                          i === 0 && activeCategory === "All" ? "text-6xl" : "text-4xl"
                         }`}>{(translated?.category ?? post.category).charAt(0)}</span>
                      </div>
                      <div className="p-6">
                        <div className="flex items-center gap-3 mb-3">
                          <span className="text-xs font-semibold text-neon-violet bg-neon-violet/10 px-2.5 py-0.5 rounded-full">
                             {translated?.category ?? post.category}
                          </span>
                          <span className="flex items-center gap-1 text-xs text-aura-text-muted">
                            <Clock className="w-3 h-3" />
                             {translated?.readTime ?? post.readTime}
                          </span>
                          {i === 0 && activeCategory === "All" && (
                            <span className="text-xs font-semibold text-aura-amber bg-aura-amber/10 px-2.5 py-0.5 rounded-full">
                               {t("blog.featured")}
                            </span>
                          )}
                        </div>
                        <h3 className={`font-bold text-aura-text mb-2 group-hover:text-neon-violet transition-colors leading-snug ${
                          i === 0 && activeCategory === "All" ? "text-lg" : "text-base"
                        }`}>
                           {translated?.title ?? post.title}
                        </h3>
                        <p className="text-sm text-aura-text-secondary leading-relaxed line-clamp-2">
                           {translated?.excerpt ?? post.excerpt}
                        </p>
                        <div className="mt-4 flex items-center gap-1 text-sm font-semibold text-neon-violet opacity-0 group-hover:opacity-100 transition-opacity">
                           {t("blog.read")} <ArrowRight className="w-3.5 h-3.5" />
                        </div>
                      </div>
                    </div>
                  </Link>
                 </motion.article>
                 );
               })}
            </motion.div>
          </AnimatePresence>

          {filtered.length === 0 && (
             <p className="text-center text-aura-text-muted py-12">{t("blog.empty")}</p>
          )}
        </Container>
      </section>
    </>
  );
}
