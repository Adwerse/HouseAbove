import { forwardRef, type ReactNode } from "react";

import { cn } from "./utils";
import { Button, type ButtonProps } from "./Button";

export interface IconButtonProps extends Omit<ButtonProps, "children" | "aria-label"> {
  /** Required visible-to-screen-reader label; icon-only controls must name themselves. */
  label: string;
  icon: ReactNode;
}

export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton(
  { label, icon, className, size = "md", title, ...props },
  ref,
) {
  const dimension = size === "sm" ? "w-8 px-0" : size === "lg" ? "w-12 px-0" : "w-10 px-0";

  return (
    <Button
      ref={ref}
      size={size}
      aria-label={label}
      title={title ?? label}
      className={cn(dimension, className)}
      {...props}
    >
      <span aria-hidden="true" className="inline-flex items-center justify-center">
        {icon}
      </span>
    </Button>
  );
});

IconButton.displayName = "IconButton";
