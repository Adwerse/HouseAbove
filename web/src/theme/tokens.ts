/**
 * HomesAbove's shared visual language.  Keep these values framework-neutral so
 * that components, MapLibre overlays, and the Tailwind theme can all use the
 * same source of truth.
 */

export const duskColors = {
  background: "#0A0F1E",
  surface: "rgba(18, 25, 51, 0.72)",
  elevated: "#151D3B",
  text: "#E7EAF3",
  muted: "#8B93A9",
  primary: "#7C9CFF",
  warm: "#FFD166",
  border: "rgba(255, 255, 255, 0.07)",
  overlay: "rgba(3, 7, 18, 0.64)",
  focus: "#A8BEFF",
} as const;

/** Display-status colours are contract values and must not be changed locally. */
export const statusColors = {
  likely_underused: "#FF5A4E",
  review: "#FFB020",
  unclear: "#94A3B8",
  likely_used: "#475569",
  confirmed: "#8B5CF6",
  home: "#FFD166",
} as const;

export type DuskStatus = keyof typeof statusColors;

export const tokens = {
  color: {
    ...duskColors,
    status: statusColors,
  },
  font: {
    ui: '"Inter", ui-sans-serif, system-ui, sans-serif',
    mono: '"JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace',
  },
  type: {
    xs: "0.75rem", // 12px
    sm: "0.875rem", // 14px
    base: "1rem", // 16px
    lg: "1.25rem", // 20px
    xl: "1.75rem", // 28px
    display: "2.5rem", // 40px
    headingLetterSpacing: "-0.01em",
    numericFeatureSettings: '"tnum" 1, "lnum" 1',
  },
  space: {
    1: "0.25rem",
    2: "0.5rem",
    3: "0.75rem",
    4: "1rem",
    5: "1.25rem",
    6: "1.5rem",
    8: "2rem",
    10: "2.5rem",
    12: "3rem",
  },
  radius: {
    panel: "0.875rem", // 14px
    card: "0.625rem", // 10px
    chip: "999px",
  },
  shadow: {
    panel: "0 8px 30px rgba(0, 0, 0, 0.35)",
  },
  blur: {
    glass: "14px",
  },
  motion: {
    fast: "180ms",
    normal: "220ms",
    easing: "ease-out",
  },
} as const;

/**
 * Handy when creating a root style object. CSS custom properties also make the
 * tokens available to plain MapLibre controls, which do not consume Tailwind.
 */
export const duskCssVariables = {
  "--ha-background": duskColors.background,
  "--ha-surface": duskColors.surface,
  "--ha-elevated": duskColors.elevated,
  "--ha-text": duskColors.text,
  "--ha-muted": duskColors.muted,
  "--ha-primary": duskColors.primary,
  "--ha-warm": duskColors.warm,
  "--ha-border": duskColors.border,
  "--ha-status-likely-underused": statusColors.likely_underused,
  "--ha-status-review": statusColors.review,
  "--ha-status-unclear": statusColors.unclear,
  "--ha-status-likely-used": statusColors.likely_used,
  "--ha-status-confirmed": statusColors.confirmed,
  "--ha-status-home": statusColors.home,
} as const;

/**
 * This is deliberately a plain object so `tailwind.config.*` can spread it
 * into `theme.extend` without duplicating any visual values.
 */
export const tailwindTheme = {
  colors: {
    dusk: duskColors,
    status: statusColors,
  },
  fontFamily: {
    sans: ["Inter", "ui-sans-serif", "system-ui", "sans-serif"],
    mono: ["JetBrains Mono", "ui-monospace", "SFMono-Regular", "monospace"],
  },
  borderRadius: tokens.radius,
  boxShadow: tokens.shadow,
  transitionDuration: {
    fast: tokens.motion.fast,
    normal: tokens.motion.normal,
  },
} as const;

export const numericStyle = {
  fontVariantNumeric: "tabular-nums lining-nums",
  fontFeatureSettings: tokens.type.numericFeatureSettings,
} as const;
