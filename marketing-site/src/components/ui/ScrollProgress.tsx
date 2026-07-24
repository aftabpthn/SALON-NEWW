"use client";

import { motion, useScroll, useSpring } from "motion/react";

export function ScrollProgress() {
  const { scrollYProgress } = useScroll();
  const scaleX = useSpring(scrollYProgress, {
    stiffness: 100,
    damping: 30,
    restDelta: 0.001,
  });

  return (
    <motion.div
      style={{ scaleX }}
      role="progressbar"
      aria-label="Scroll progress"
      className="fixed top-0 left-0 right-0 h-[3px] z-[9998] origin-left bg-gradient-to-r from-neon-violet via-aura-rose to-aura-amber"
    />
  );
}
