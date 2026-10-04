import {
  useEffect,
  useId,
  useRef,
  type CSSProperties,
  type ReactNode,
} from "react";

import { duskColors, tokens } from "../theme/tokens";
import { cn, focusRingClass, usePrefersReducedMotion } from "./utils";

export type SheetSide = "bottom" | "right" | "left";

export interface SheetProps {
  open: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Convenience callback for existing controlled sheets. */
  onClose?: () => void;
  side?: SheetSide;
  /** Alias retained for intuitive use in page code. */
  placement?: SheetSide;
  title?: ReactNode;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
  contentClassName?: string;
  closeLabel?: string;
  showClose?: boolean;
  closeOnOverlayClick?: boolean;
  ariaLabel?: string;
}

function focusableChildren(container: HTMLElement) {
  return Array.from(
    container.querySelectorAll<HTMLElement>(
      'a[href], area[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ),
  ).filter((element) => !element.hasAttribute("aria-hidden"));
}

/** A controlled, keyboard-accessible bottom sheet or side drawer. */
export function Sheet({
  open,
  onOpenChange,
  onClose,
  side,
  placement,
  title,
  description,
  children,
  footer,
  className,
  contentClassName,
  closeLabel = "Close panel",
  showClose = true,
  closeOnOverlayClick = true,
  ariaLabel,
}: SheetProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const reducedMotion = usePrefersReducedMotion();
  const resolvedSide = placement ?? side ?? "bottom";

  const requestClose = () => {
    onClose?.();
    onOpenChange?.(false);
  };

  useEffect(() => {
    if (!open) return;

    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusTimer = window.setTimeout(() => panelRef.current?.focus(), 0);

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        requestClose();
        return;
      }

      if (event.key !== "Tab" || !panelRef.current) return;
      const focusable = focusableChildren(panelRef.current);
      if (focusable.length === 0) {
        event.preventDefault();
        panelRef.current.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => {
      window.clearTimeout(focusTimer);
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
      previousFocus?.focus();
    };
  }, [open, onClose, onOpenChange]);

  if (!open) return null;

  const sideStyle: CSSProperties =
    resolvedSide === "bottom"
      ? {
          insetInline: 0,
          bottom: 0,
          width: "min(100%, 46rem)",
          maxHeight: "min(82dvh, 48rem)",
          marginInline: "auto",
          borderTopLeftRadius: tokens.radius.panel,
          borderTopRightRadius: tokens.radius.panel,
          borderTopWidth: 1,
        }
      : resolvedSide === "left"
        ? {
            top: 0,
            bottom: 0,
            left: 0,
            width: "min(26rem, 92vw)",
            borderTopRightRadius: tokens.radius.panel,
            borderBottomRightRadius: tokens.radius.panel,
            borderRightWidth: 1,
          }
        : {
            top: 0,
            right: 0,
            bottom: 0,
            width: "min(26rem, 92vw)",
            borderTopLeftRadius: tokens.radius.panel,
            borderBottomLeftRadius: tokens.radius.panel,
            borderLeftWidth: 1,
          };

  return (
    <div className="fixed inset-0 z-50" aria-hidden={false}>
      <div
        aria-hidden="true"
        className="absolute inset-0"
        style={{
          backgroundColor: duskColors.overlay,
          transition: reducedMotion ? "none" : `opacity ${tokens.motion.fast} ${tokens.motion.easing}`,
        }}
        onMouseDown={closeOnOverlayClick ? requestClose : undefined}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={ariaLabel ?? (title ? undefined : "Panel")}
        aria-labelledby={title ? titleId : undefined}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        className={cn("absolute flex min-h-0 flex-col overflow-hidden border", className)}
        style={{
          ...sideStyle,
          color: duskColors.text,
          backgroundColor: duskColors.surface,
          borderColor: duskColors.border,
          boxShadow: tokens.shadow.panel,
          backdropFilter: `blur(${tokens.blur.glass})`,
          WebkitBackdropFilter: `blur(${tokens.blur.glass})`,
          transition: reducedMotion
            ? "none"
            : `transform ${tokens.motion.normal} ${tokens.motion.easing}, opacity ${tokens.motion.normal} ${tokens.motion.easing}`,
        }}
      >
        {resolvedSide === "bottom" ? <div aria-hidden="true" className="mx-auto mt-2 h-1 w-10 rounded-full bg-white/20" /> : null}
        {title || description || showClose ? (
          <header className="flex shrink-0 items-start gap-3 px-4 pb-3 pt-4">
            <div className="min-w-0 flex-1">
              {title ? (
                <h2
                  id={titleId}
                  className="text-lg font-semibold leading-6"
                  style={{ letterSpacing: tokens.type.headingLetterSpacing }}
                >
                  {title}
                </h2>
              ) : null}
              {description ? (
                <p id={descriptionId} className="mt-1 text-sm leading-5" style={{ color: duskColors.muted }}>
                  {description}
                </p>
              ) : null}
            </div>
            {showClose ? (
              <button
                type="button"
                aria-label={closeLabel}
                title={closeLabel}
                className={cn(
                  "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] border text-lg leading-none",
                  "hover:bg-white/10 active:translate-y-px",
                  focusRingClass,
                )}
                style={{
                  color: duskColors.text,
                  borderColor: duskColors.border,
                  backgroundColor: "rgba(255, 255, 255, 0.03)",
                }}
                onClick={requestClose}
              >
                <span aria-hidden="true">×</span>
              </button>
            ) : null}
          </header>
        ) : null}
        <div className={cn("min-h-0 flex-1 overflow-y-auto px-4 pb-4", contentClassName)}>{children}</div>
        {footer ? <footer className="shrink-0 border-t px-4 py-3" style={{ borderColor: duskColors.border }}>{footer}</footer> : null}
      </div>
    </div>
  );
}
