import { type CSSProperties, type HTMLAttributes, type ReactNode } from "react";

import { duskColors, statusColors, type DuskStatus, tokens } from "../theme/tokens";
import { cn, withAlpha } from "./utils";

export type ChipTone = "neutral" | "primary" | "warm" | DuskStatus;

export interface ChipProps extends HTMLAttributes<HTMLSpanElement> {
  /** Contract display status. Providing it guarantees a visible text label. */
  status?: DuskStatus;
  tone?: ChipTone;
  label?: ReactNode;
  icon?: ReactNode;
}

const statusLabels: Record<DuskStatus, string> = {
  likely_underused: "Likely underused",
  review: "Needs review",
  unclear: "Unclear",
  likely_used: "Likely used",
  confirmed: "Confirmed candidate",
  home: "Returned to use as homes",
};

const statusSymbols: Record<DuskStatus, string> = {
  likely_underused: "↑",
  review: "!",
  unclear: "?",
  likely_used: "–",
  confirmed: "✓",
  home: "⌂",
};

function styleForTone(tone: ChipTone): CSSProperties {
  if (tone in statusColors) {
    const colour = statusColors[tone as DuskStatus];
    return {
      color: colour,
      backgroundColor: withAlpha(colour, "22"),
      borderColor: withAlpha(colour, "55"),
    };
  }

  if (tone === "primary") {
    return {
      color: duskColors.primary,
      backgroundColor: withAlpha(duskColors.primary, "20"),
      borderColor: withAlpha(duskColors.primary, "50"),
    };
  }

  if (tone === "warm") {
    return {
      color: duskColors.warm,
      backgroundColor: withAlpha(duskColors.warm, "20"),
      borderColor: withAlpha(duskColors.warm, "50"),
    };
  }

  return {
    color: duskColors.muted,
    backgroundColor: "rgba(255, 255, 255, 0.05)",
    borderColor: duskColors.border,
  };
}

/**
 * A compact semantic label. Status chips always pair their colour with an icon
 * and words so status never relies on colour alone.
 */
export function Chip({
  status,
  tone = status ?? "neutral",
  label,
  icon,
  children,
  className,
  style,
  ...props
}: ChipProps) {
  const content = children ?? label ?? (status ? statusLabels[status] : null);
  const marker = icon ?? (status ? statusSymbols[status] : null);

  return (
    <span
      className={cn(
        "inline-flex min-h-6 items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-semibold leading-4",
        className,
      )}
      style={{
        ...styleForTone(tone),
        fontFamily: tokens.font.ui,
        ...style,
      }}
      {...props}
    >
      {marker ? (
        <span aria-hidden="true" className="inline-flex min-w-3 justify-center font-bold">
          {marker}
        </span>
      ) : null}
      {content}
    </span>
  );
}

export { statusLabels as STATUS_LABELS };
