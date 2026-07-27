"use client";

import { useEffect, useState } from "react";

export type ViewportClass = "compact" | "medium" | "wide";

type ExperienceCapabilities = {
  reducedMotion: boolean;
  coarsePointer: boolean;
  viewport: ViewportClass;
  webgl: boolean;
  ready: boolean;
};

const initialCapabilities: ExperienceCapabilities = {
  reducedMotion: true,
  coarsePointer: true,
  viewport: "compact",
  webgl: false,
  ready: false,
};

function supportsWebGL() {
  try {
    const canvas = document.createElement("canvas");
    return Boolean(canvas.getContext("webgl2") || canvas.getContext("webgl"));
  } catch {
    return false;
  }
}

export function useExperienceCapabilities() {
  const [capabilities, setCapabilities] = useState(initialCapabilities);

  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    const coarse = window.matchMedia("(pointer: coarse)");
    const update = () => {
      const width = window.innerWidth;
      setCapabilities({
        reducedMotion: reduced.matches,
        coarsePointer: coarse.matches,
        viewport: width < 640 ? "compact" : width < 1024 ? "medium" : "wide",
        webgl: supportsWebGL(),
        ready: true,
      });
    };

    update();
    reduced.addEventListener("change", update);
    coarse.addEventListener("change", update);
    window.addEventListener("resize", update, { passive: true });
    return () => {
      reduced.removeEventListener("change", update);
      coarse.removeEventListener("change", update);
      window.removeEventListener("resize", update);
    };
  }, []);

  return capabilities;
}
