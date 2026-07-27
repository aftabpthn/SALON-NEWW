"use client";

import type { Variants, Transition } from "motion/react";

/* ===== EASING CURVES ===== */
const smooth: Transition = {
  duration: 0.8,
  ease: [0.16, 1, 0.3, 1],
};

const spring: Transition = {
  type: "spring",
  stiffness: 300,
  damping: 30,
  mass: 0.8,
};

const heavySpring: Transition = {
  type: "spring",
  stiffness: 100,
  damping: 20,
  mass: 1.2,
};

/* ===== FADE UP ===== */
export const fadeInUp: Variants = {
  hidden: { opacity: 0, y: 48 },
  visible: {
    opacity: 1,
    y: 0,
    transition: smooth,
  },
};

/* ===== CLIP PATH REVEAL (diagonal wipe) ===== */
export const clipPathReveal: Variants = {
  hidden: { clipPath: "inset(100% 0% 0% 0%)" },
  visible: {
    clipPath: "inset(0% 0% 0% 0%)",
    transition: { duration: 0.9, ease: [0.16, 1, 0.3, 1] },
  },
};

export const clipPathRevealLeft: Variants = {
  hidden: { clipPath: "inset(0% 100% 0% 0%)" },
  visible: {
    clipPath: "inset(0% 0% 0% 0%)",
    transition: { duration: 0.9, ease: [0.16, 1, 0.3, 1] },
  },
};

/* ===== SCALE REVEAL ===== */
export const scaleReveal: Variants = {
  hidden: { opacity: 0, scale: 0.88 },
  visible: {
    opacity: 1,
    scale: 1,
    transition: { duration: 0.8, ease: [0.16, 1, 0.3, 1] },
  },
};

/* ===== TEXT SLIDE UP (for words) ===== */
export const textSlideUp: Variants = {
  hidden: { y: "110%", rotateX: -80 },
  visible: (i: number) => ({
    y: 0,
    rotateX: 0,
    transition: {
      duration: 0.7,
      delay: i * 0.06,
      ease: [0.16, 1, 0.3, 1],
    },
  }),
};

/* ===== STAGGER ===== */
export const staggerContainer: Variants = {
  hidden: {},
  visible: {
    transition: {
      staggerChildren: 0.08,
      delayChildren: 0.1,
    },
  },
};

export const staggerContainerSlow: Variants = {
  hidden: {},
  visible: {
    transition: {
      staggerChildren: 0.15,
      delayChildren: 0.15,
    },
  },
};

export const staggerChild: Variants = {
  hidden: { opacity: 0, y: 32, scale: 0.97 },
  visible: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: spring,
  },
};

/* ===== 3D CARD TILT ===== */
export const card3DHover = {
  rest: {
    rotateX: 0,
    rotateY: 0,
    scale: 1,
    z: 0,
  },
  hover: {
    rotateX: 0,
    rotateY: 0,
    scale: 1.03,
    z: 20,
    transition: { type: "spring", stiffness: 400, damping: 25 },
  },
};

/* ===== SPRING HOVER ===== */
export const springHover = {
  rest: { scale: 1 },
  hover: {
    scale: 1.04,
    transition: spring,
  },
  tap: { scale: 0.97 },
};

/* ===== PARALLAX DEPTH ===== */
export const parallaxDepth = (speed: number): Variants => ({
  hidden: { opacity: 0, y: 60 * speed },
  visible: {
    opacity: 1,
    y: 0,
    transition: { duration: 1, ease: [0.16, 1, 0.3, 1] },
  },
});

/* ===== FLOATING ORB ===== */
export const floatingOrb = (delay: number, duration: number): Variants => ({
  animate: {
    y: [0, -25, 0],
    x: [0, 15, -8, 0],
    scale: [1, 1.08, 0.96, 1],
    transition: {
      duration,
      delay,
      repeat: Infinity,
      ease: "easeInOut",
    },
  },
});

/* ===== BREATHING GLOW ===== */
export const breathingGlow: Variants = {
  animate: {
    boxShadow: [
      "0 0 20px rgba(104,31,55,0.08)",
      "0 0 50px rgba(104,31,55,0.2)",
      "0 0 20px rgba(104,31,55,0.08)",
    ],
    transition: {
      duration: 3,
      repeat: Infinity,
      ease: "easeInOut",
    },
  },
};

/* ===== PAGE TRANSITION ===== */
export const pageTransition: Variants = {
  initial: { opacity: 0, y: 30 },
  animate: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.6, ease: [0.22, 1, 0.36, 1] },
  },
  exit: {
    opacity: 0,
    y: -30,
    transition: { duration: 0.3 },
  },
};
