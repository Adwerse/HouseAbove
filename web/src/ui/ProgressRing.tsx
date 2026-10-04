import { type CSSProperties, type ReactNode } from "react";

import { duskColors, numericStyle } from "../theme/tokens";
import { cn } from "./utils";

export interface ProgressRingProps {
  value: number;
  max?: number;
  size?: number;
  strokeWidth?: number;
  label?: string;
  valueLabel?: ReactNode;
  color?: string;
  trackColor?: string;
  className?: string;
  style?: CSSProperties;
  children?: ReactNode;
}

export function ProgressRing({
  value,
  max = 100,
  size = 48,
  strokeWidth = 5,
  label = "Progress",
  valueLabel,
  color = duskColors.primary,
  trackColor = "rgba(255, 255, 255, 0.10)",
  className,
  style,
  children,
}: ProgressRingProps) {
  const safeMax = Math.max(max, 1);
  const safeValue = Math.min(Math.max(value, 0), safeMax);
  const percentage = (safeValue / safeMax) * 100;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference - (percentage / 100) * circumference;

  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={safeMax}
      aria-valuenow={safeValue}
      aria-valuetext={`${Math.round(percentage)}%`}
      className={cn("relative inline-grid shrink-0 place-items-center", className)}
      style={{ width: size, height: size, ...style }}
    >
      <svg aria-hidden="true" width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={trackColor}
          strokeWidth={strokeWidth}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
        />
      </svg>
      {children ?? (
        <span className="absolute text-xs font-semibold" style={{ ...numericStyle, color: duskColors.text }}>
          {valueLabel ?? `${Math.round(percentage)}%`}
        </span>
      )}
    </div>
  );
}
