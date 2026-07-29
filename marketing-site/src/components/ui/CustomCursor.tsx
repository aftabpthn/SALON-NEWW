"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { motion, useMotionValue, useSpring, AnimatePresence } from "motion/react";

const HOVER_LABELS = new WeakMap<Element, string>();

function getLabel(el: Element): string | null {
  // Walk up to find data-cursor-label
  let node: Element | null = el;
  while (node && node !== document.body) {
    if (node.hasAttribute("data-cursor-label")) {
      return node.getAttribute("data-cursor-label");
    }
    node = node.parentElement;
  }
  return null;
}

export function CustomCursor() {
  const cursorX = useMotionValue(-100);
  const cursorY = useMotionValue(-100);
  const [hovering, setHovering] = useState(false);
  const [hidden, setHidden] = useState(true);
  const [label, setLabel] = useState<string | null>(null);
  const trackedElements = useRef(new WeakSet<Element>());
  const cleanupFns = useRef<Array<() => void>>([]);

  const springConfig = { damping: 25, stiffness: 300, mass: 0.5 };
  const cursorXSpring = useSpring(cursorX, springConfig);
  const cursorYSpring = useSpring(cursorY, springConfig);

  const glowXSpring = useSpring(cursorX, { damping: 35, stiffness: 200, mass: 0.8 });
  const glowYSpring = useSpring(cursorY, { damping: 35, stiffness: 200, mass: 0.8 });

  const handleEnter = useCallback((el: Element) => () => {
    setHovering(true);
    const lbl = getLabel(el);
    if (lbl) setLabel(lbl);
  }, []);

  const handleLeave = useCallback(() => {
    setHovering(false);
    setLabel(null);
  }, []);

  const trackElement = useCallback((el: Element) => {
    if (trackedElements.current.has(el)) return;
    trackedElements.current.add(el);

    const enter = handleEnter(el);
    const leave = handleLeave;

    el.addEventListener("mouseenter", enter);
    el.addEventListener("mouseleave", leave);

    cleanupFns.current.push(() => {
      el.removeEventListener("mouseenter", enter);
      el.removeEventListener("mouseleave", leave);
    });
  }, [handleEnter, handleLeave]);

  useEffect(() => {
    const isMobile = window.matchMedia("(pointer: coarse)").matches;
    if (isMobile) return;

    const handleMove = (e: MouseEvent) => {
      cursorX.set(e.clientX);
      cursorY.set(e.clientY);
      setHidden(false);
    };

    window.addEventListener("mousemove", handleMove);

    // Track all current interactive elements
    const selector = "a, button, [data-cursor-hover]";
    document.querySelectorAll(selector).forEach(trackElement);

    // Observe DOM changes for new elements
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node instanceof Element) {
            if (node.matches?.(selector)) trackElement(node);
            node.querySelectorAll?.(selector).forEach(trackElement);
          }
        }
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });

    return () => {
      window.removeEventListener("mousemove", handleMove);
      observer.disconnect();
      cleanupFns.current.forEach((fn) => fn());
      cleanupFns.current = [];
      trackedElements.current = new WeakSet();
    };
  }, [cursorX, cursorY, trackElement]);

  // Hide on mobile
  const [isMobile, setIsMobile] = useState(true);
  useEffect(() => {
    setIsMobile(window.matchMedia("(pointer: coarse)").matches);
  }, []);

  if (isMobile) return null;

  return (
    <>
      {/* Main cursor dot */}
      <motion.div
        className="fixed top-0 left-0 z-[9999] pointer-events-none mix-blend-difference"
        style={{
          x: cursorXSpring,
          y: cursorYSpring,
          translateX: "-50%",
          translateY: "-50%",
        }}
      >
        <motion.div
          animate={{
            scale: hovering ? 2.5 : 1,
            opacity: hidden ? 0 : 1,
          }}
          transition={{ type: "spring", stiffness: 300, damping: 20 }}
          className="w-3 h-3 rounded-full bg-white"
        />

        {/* Hover label */}
        <AnimatePresence>
          {hovering && label && (
            <motion.span
              initial={{ opacity: 0, y: 8, scale: 0.8 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 4, scale: 0.9 }}
              transition={{ duration: 0.2 }}
              className="absolute top-6 left-1/2 -translate-x-1/2 whitespace-nowrap text-[10px] font-semibold text-white bg-white/10 backdrop-blur-sm px-2 py-0.5 rounded-md pointer-events-none"
            >
              {label}
            </motion.span>
          )}
        </AnimatePresence>
      </motion.div>

      {/* Glow trail */}
      <motion.div
        className="fixed top-0 left-0 z-[9998] pointer-events-none"
        style={{
          x: glowXSpring,
          y: glowYSpring,
          translateX: "-50%",
          translateY: "-50%",
        }}
      >
        <motion.div
          animate={{
            scale: hovering ? 4 : 1,
            opacity: hidden ? 0 : hovering ? 0.15 : 0.08,
          }}
          transition={{ type: "spring", stiffness: 200, damping: 25 }}
          className="w-3 h-3 rounded-full"
          style={{
            background: "radial-gradient(circle, rgba(75,166,190,0.58), rgba(18,63,92,0.28), transparent 70%)",
          }}
        />
      </motion.div>
    </>
  );
}
