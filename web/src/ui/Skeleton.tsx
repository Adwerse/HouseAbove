import { type CSSProperties, type HTMLAttributes } from "react";

import { cn, usePrefersReducedMotion } from "./utils";

export interface SkeletonProps extends HTMLAttributes<HTMLDivElement> {
  /** Supply a label only when this placeholder needs to be announced. */
  label?: string;
  shape?: "line" | "circle" | "rect";
  animate?: boolean;
}

export function Skeleton({
  label,
  shape = "line",
  animate = true,
  className,
  style,
  ...props
}: SkeletonProps) {
  const reducedMotion = usePrefersReducedMotion();
  const shapeClasses =
    shape === "circle" ? "rounded-full" : shape === "rect" ? "rounded-[10px]" : "h-3 w-full rounded-full";

  return (
    <div
      aria-hidden={label ? undefined : true}
      role={label ? "status" : undefined}
      aria-label={label}
      className={cn("block", shapeClasses, animate && !reducedMotion && "animate-pulse", className)}
      style={{
        backgroundColor: "rgba(255, 255, 255, 0.09)",
        ...style,
      } as CSSProperties}
      {...props}
    />
  );
}
