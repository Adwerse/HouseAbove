import {
  forwardRef,
  type ButtonHTMLAttributes,
  type CSSProperties,
  type ReactNode,
} from "react";

import { duskColors, numericStyle, tokens } from "../theme/tokens";
import { cn, focusRingClass, usePrefersReducedMotion } from "./utils";

export type ButtonVariant = "primary" | "secondary" | "ghost" | "warm" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  leadingIcon?: ReactNode;
  trailingIcon?: ReactNode;
  fullWidth?: boolean;
}

const variantStyles: Record<ButtonVariant, CSSProperties> = {
  primary: {
    backgroundColor: duskColors.primary,
    borderColor: duskColors.primary,
    color: duskColors.background,
  },
  secondary: {
    backgroundColor: duskColors.elevated,
    borderColor: duskColors.border,
    color: duskColors.text,
  },
  ghost: {
    backgroundColor: "transparent",
    borderColor: "transparent",
    color: duskColors.text,
  },
  warm: {
    backgroundColor: duskColors.warm,
    borderColor: duskColors.warm,
    color: duskColors.background,
  },
  danger: {
    backgroundColor: "#FF5A4E",
    borderColor: "#FF5A4E",
    color: duskColors.background,
  },
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: "min-h-8 px-3 text-xs",
  md: "min-h-10 px-4 text-sm",
  lg: "min-h-12 px-5 text-base",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  {
    variant = "primary",
    size = "md",
    loading = false,
    leadingIcon,
    trailingIcon,
    fullWidth = false,
    disabled,
    className,
    style,
    type = "button",
    children,
    ...props
  },
  ref,
) {
  const reducedMotion = usePrefersReducedMotion();
  const isDisabled = disabled || loading;

  return (
    <button
      ref={ref}
      type={type}
      disabled={isDisabled}
      aria-busy={loading || undefined}
      className={cn(
        "inline-flex select-none items-center justify-center gap-2 rounded-[10px] border font-semibold",
        "disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50",
        "hover:brightness-110 active:translate-y-px",
        focusRingClass,
        sizeClasses[size],
        fullWidth && "w-full",
        className,
      )}
      style={{
        ...numericStyle,
        ...variantStyles[variant],
        transition: reducedMotion
          ? "none"
          : `background-color ${tokens.motion.fast} ${tokens.motion.easing}, border-color ${tokens.motion.fast} ${tokens.motion.easing}, color ${tokens.motion.fast} ${tokens.motion.easing}, transform ${tokens.motion.fast} ${tokens.motion.easing}, filter ${tokens.motion.fast} ${tokens.motion.easing}`,
        ...style,
      }}
      {...props}
    >
      {loading ? (
        <span
          aria-hidden="true"
          className={cn(
            "inline-block h-3.5 w-3.5 rounded-full border-2 border-current border-r-transparent",
            !reducedMotion && "animate-spin",
          )}
        />
      ) : leadingIcon ? (
        <span aria-hidden="true" className="inline-flex shrink-0 items-center">
          {leadingIcon}
        </span>
      ) : null}
      <span>{children}</span>
      {!loading && trailingIcon ? (
        <span aria-hidden="true" className="inline-flex shrink-0 items-center">
          {trailingIcon}
        </span>
      ) : null}
    </button>
  );
});

Button.displayName = "Button";
