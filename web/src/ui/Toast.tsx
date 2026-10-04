import { useEffect, type HTMLAttributes, type ReactNode } from "react";

import { duskColors, tokens } from "../theme/tokens";
import { cn, focusRingClass, usePrefersReducedMotion, withAlpha } from "./utils";

export type ToastTone = "info" | "success" | "warning" | "error";

export interface ToastProps extends Omit<HTMLAttributes<HTMLDivElement>, "title"> {
  title?: ReactNode;
  description?: ReactNode;
  tone?: ToastTone;
  onDismiss?: () => void;
  duration?: number | false;
  dismissLabel?: string;
}

const toastTone = {
  info: duskColors.primary,
  success: "#5EE0A1",
  warning: "#FFB020",
  error: "#FF5A4E",
} as const;

/**
 * A lightweight controlled toast. Pass `duration={false}` for notices which
 * should remain until a person explicitly dismisses them.
 */
export function Toast({
  title,
  description,
  tone = "info",
  onDismiss,
  duration = 5000,
  dismissLabel = "Dismiss notification",
  className,
  children,
  style,
  ...props
}: ToastProps) {
  const reducedMotion = usePrefersReducedMotion();

  useEffect(() => {
    if (!onDismiss || duration === false) return;
    const timer = window.setTimeout(onDismiss, duration);
    return () => window.clearTimeout(timer);
  }, [duration, onDismiss]);

  const accent = toastTone[tone];
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={cn("flex w-full items-start gap-3 rounded-[10px] border p-3", className)}
      style={{
        color: duskColors.text,
        backgroundColor: duskColors.surface,
        borderColor: withAlpha(accent, "66"),
        boxShadow: tokens.shadow.panel,
        backdropFilter: `blur(${tokens.blur.glass})`,
        WebkitBackdropFilter: `blur(${tokens.blur.glass})`,
        transition: reducedMotion ? "none" : `opacity ${tokens.motion.fast} ${tokens.motion.easing}`,
        ...style,
      }}
      {...props}
    >
      <span
        aria-hidden="true"
        className="mt-1 inline-block h-2.5 w-2.5 shrink-0 rounded-full"
        style={{ backgroundColor: accent }}
      />
      <div className="min-w-0 flex-1">
        {title ? <div className="text-sm font-semibold leading-5">{title}</div> : null}
        {description ? <div className={cn("text-sm leading-5", Boolean(title) && "mt-0.5")} style={{ color: duskColors.muted }}>{description}</div> : null}
        {children}
      </div>
      {onDismiss ? (
        <button
          type="button"
          aria-label={dismissLabel}
          title={dismissLabel}
          onClick={onDismiss}
          className={cn(
            "inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-base leading-none",
            "hover:bg-white/10 active:translate-y-px",
            focusRingClass,
          )}
          style={{ color: duskColors.muted }}
        >
          <span aria-hidden="true">×</span>
        </button>
      ) : null}
    </div>
  );
}

export interface ToastItem extends ToastProps {
  id: string;
}

export interface ToastViewportProps {
  toasts: ToastItem[];
  onDismiss?: (id: string) => void;
  className?: string;
}

export function ToastViewport({ toasts, onDismiss, className }: ToastViewportProps) {
  return (
    <div
      aria-label="Notifications"
      className={cn("pointer-events-none fixed right-4 top-4 z-[60] flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2", className)}
    >
      {toasts.map(({ id, onDismiss: itemDismiss, ...toast }) => (
        <div key={id} className="pointer-events-auto">
          <Toast {...toast} onDismiss={itemDismiss ?? (onDismiss ? () => onDismiss(id) : undefined)} />
        </div>
      ))}
    </div>
  );
}
