import { forwardRef, type HTMLAttributes, type ReactNode } from "react";

import { duskColors, tokens } from "../theme/tokens";
import { cn } from "./utils";

export type CardVariant = "glass" | "elevated" | "plain";

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  variant?: CardVariant;
  padding?: "none" | "sm" | "md" | "lg";
}

const paddingClasses: Record<NonNullable<CardProps["padding"]>, string> = {
  none: "",
  sm: "p-3",
  md: "p-4",
  lg: "p-6",
};

export const Card = forwardRef<HTMLDivElement, CardProps>(function Card(
  { variant = "glass", padding = "md", className, style, ...props },
  ref,
) {
  const variantStyle =
    variant === "elevated"
      ? { backgroundColor: duskColors.elevated }
      : variant === "plain"
        ? { backgroundColor: "transparent", boxShadow: "none" }
        : {
            backgroundColor: duskColors.surface,
            backdropFilter: `blur(${tokens.blur.glass})`,
            WebkitBackdropFilter: `blur(${tokens.blur.glass})`,
          };

  return (
    <div
      ref={ref}
      className={cn("rounded-[10px] border", paddingClasses[padding], className)}
      style={{
        borderColor: duskColors.border,
        boxShadow: tokens.shadow.panel,
        ...variantStyle,
        ...style,
      }}
      {...props}
    />
  );
});

Card.displayName = "Card";

export function CardHeader({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("mb-3 flex items-start justify-between gap-3", className)} {...props} />;
}

export function CardTitle({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return (
    <h3
      className={cn("text-base font-semibold leading-5", className)}
      style={{ color: duskColors.text, letterSpacing: tokens.type.headingLetterSpacing }}
      {...props}
    />
  );
}

export function CardDescription({ className, ...props }: HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn("mt-1 text-sm leading-5", className)} style={{ color: duskColors.muted }} {...props} />;
}

export function CardContent({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("min-w-0", className)} {...props} />;
}

export interface CardActionProps {
  children: ReactNode;
}
