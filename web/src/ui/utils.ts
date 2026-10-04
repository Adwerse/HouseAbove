import { useEffect, useState } from "react";

export function cn(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

/** A small SSR-safe media-query hook shared by the interactive primitives. */
export function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  return reduced;
}

export function withAlpha(hex: string, alpha: string) {
  return /^#[\dA-Fa-f]{6}$/.test(hex) ? `${hex}${alpha}` : hex;
}

export const focusRingClass =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#A8BEFF] focus-visible:ring-offset-2 focus-visible:ring-offset-[#0A0F1E]";
