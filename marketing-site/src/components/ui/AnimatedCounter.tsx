"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useInView } from "motion/react";
import { cn } from "@/lib/utils";

interface AnimatedCounterProps {
  value: number;
  suffix?: string;
  prefix?: string;
  duration?: number;
  className?: string;
}

export function AnimatedCounter({
  value,
  suffix = "",
  prefix = "",
  duration = 2000,
  className,
}: AnimatedCounterProps) {
  const [count, setCount] = useState(0);
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: "-50px" });
  const hasAnimated = useRef(false);
  const rafId = useRef<number>(0);

  const animate = useCallback(
    (startTime: number, currentTime: number) => {
      const elapsed = currentTime - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setCount(Math.round(eased * value));

      if (progress < 1) {
        rafId.current = requestAnimationFrame((t) => animate(startTime, t));
      }
    },
    [value, duration],
  );

  useEffect(() => {
    if (!inView || hasAnimated.current) return;
    hasAnimated.current = true;
    const startTime = performance.now();
    rafId.current = requestAnimationFrame((t) => animate(startTime, t));
    return () => cancelAnimationFrame(rafId.current);
  }, [inView, animate]);

  const displayValue =
    value >= 1000 && !suffix.includes("Cr") && !suffix.includes("L")
      ? count.toLocaleString("en-IN")
      : count.toString();

  return (
    <span ref={ref} className={cn("tabular-nums", className)}>
      {prefix}
      {displayValue}
      {suffix}
    </span>
  );
}
