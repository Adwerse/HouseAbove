import { type HTMLAttributes, type ReactNode } from "react";

import { duskColors, numericStyle, tokens } from "../theme/tokens";
import { cn } from "./utils";

export interface StatProps extends HTMLAttributes<HTMLDivElement> {
  label: ReactNode;
  value: ReactNode;
  detail?: ReactNode;
  trend?: ReactNode;
  icon?: ReactNode;
  compact?: boolean;
}

/** A labelled, tabular-number metric suitable for dashboard scan paths. */
export function Stat({
  label,
  value,
  detail,
  trend,
  icon,
  compact = false,
  className,
  style,
  ...props
}: StatProps) {
  return (
    <div className={cn("min-w-0", compact ? "space-y-0.5" : "space-y-1", className)} style={style} {...props}>
      <div className="flex items-center gap-1.5 text-xs font-medium" style={{ color: duskColors.muted }}>
        {icon ? <span aria-hidden="true" className="inline-flex shrink-0">{icon}</span> : null}
        <span>{label}</span>
      </div>
      <div
        className={cn("font-semibold leading-none", compact ? "text-xl" : "text-[28px]")}
        style={{
          ...numericStyle,
          color: duskColors.text,
          letterSpacing: tokens.type.headingLetterSpacing,
        }}
      >
        {value}
      </div>
      {detail || trend ? (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs" style={{ color: duskColors.muted }}>
          {detail ? <span>{detail}</span> : null}
          {trend ? <span style={{ color: duskColors.primary }}>{trend}</span> : null}
        </div>
      ) : null}
    </div>
  );
}
