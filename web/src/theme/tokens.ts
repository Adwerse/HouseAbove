/**
 * HomesAbove "Fresh air" design tokens: a fitness-app palette of paper white,
 * ink black and greens. Plain values, so React, MapLibre paint expressions and
 * deck.gl layers all read the same source of truth.
 */

export const palette = {
  paper: "#F3F5F0",
  surface: "#FFFFFF",
  surfaceAlt: "#F7F8F5",
  line: "rgba(11, 16, 13, 0.08)",
  lineStrong: "rgba(11, 16, 13, 0.14)",
  ink: "#0B100D",
  ink2: "#161E19",
  ink3: "#222C26",
  muted: "#66716A",
  faint: "#9AA49E",
  green: "#17B26A",
  green600: "#0E9C5A",
  green700: "#0A7D47",
  forest: "#0E4D33",
  mint: "#E3F6EA",
  volt: "#C6F36B",
  teal: "#5CD6C0",
  amber: "#F5A524",
  gold: "#FFC94A",
  red: "#E5484D",
  water: "#CFE3E9",
  park: "#D8EBD2",
} as const;

/** What each display status looks like on the map and in chips. */
export const statusColors = {
  likely_underused: "#17B26A",
  review: "#F5A524",
  unclear: "#C7D0CA",
  likely_used: "#98A69E",
  confirmed: "#0E4D33",
  home: "#FFC94A",
} as const;

/** Map-only building states outside the officer's status palette. */
export const mapStateColors = {
  base: "#FFFFFF",
  captured: "#3DD68C",
  pending: "#E3F6EA",
} as const;

export const serviceColors = {
  bus: "#2E90FA",
  grocery: "#17B26A",
  school: "#9E77ED",
  gp_or_pharmacy: "#F04438",
  park: "#66C61C",
} as const;

export const ringColors = {
  distance: palette.volt,
  facades: palette.green,
  streets: palette.teal,
} as const;

export const tierColors = {
  bronze: "#D39B6A",
  silver: "#C9D2CC",
  gold: "#FFC94A",
  civic: "#3DD68C",
} as const;

export function hexToRgb(hex: string, alpha = 255): [number, number, number, number] {
  const n = Number.parseInt(hex.replace("#", ""), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, alpha];
}

export const motionTokens = {
  spring: { type: "spring", stiffness: 340, damping: 32, mass: 0.9 },
  soft: { type: "spring", stiffness: 180, damping: 26 },
  ease: [0.22, 1, 0.36, 1],
} as const;

/**
 * Compatibility for the shared ui/ components and the walker app (owned by B):
 * the old "dusk" names, now mapped onto the dark side of the fitness palette:
 * ink black surfaces, white text, green and volt accents.
 */
export const duskColors = {
  background: palette.ink,
  surface: "rgba(22, 30, 25, 0.78)",
  elevated: palette.ink2,
  text: "#F4F7F2",
  muted: "#9AA49E",
  primary: "#3DD68C",
  warm: palette.volt,
  border: "rgba(255, 255, 255, 0.08)",
  overlay: "rgba(5, 8, 6, 0.7)",
  focus: palette.volt,
} as const;

export const tokens = {
  color: { ...duskColors, status: statusColors },
  font: {
    ui: '"Inter", ui-sans-serif, system-ui, sans-serif',
    mono: '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace',
  },
  type: {
    xs: "0.75rem",
    sm: "0.875rem",
    base: "1rem",
    lg: "1.25rem",
    xl: "1.75rem",
    display: "2.5rem",
    headingLetterSpacing: "-0.02em",
    numericFeatureSettings: '"tnum" 1, "lnum" 1',
  },
  space: { 1: "0.25rem", 2: "0.5rem", 3: "0.75rem", 4: "1rem", 5: "1.25rem", 6: "1.5rem", 8: "2rem", 10: "2.5rem", 12: "3rem" },
  radius: { panel: "1.375rem", card: "1rem", chip: "999px" },
  shadow: { panel: "0 18px 48px -12px rgba(0, 0, 0, 0.45)" },
  blur: { glass: "18px" },
  motion: { fast: "180ms", normal: "220ms", easing: "cubic-bezier(0.22, 1, 0.36, 1)" },
} as const;

export const numericStyle = {
  fontVariantNumeric: "tabular-nums lining-nums",
  fontFeatureSettings: tokens.type.numericFeatureSettings,
} as const;

export type DuskStatus = keyof typeof statusColors;
