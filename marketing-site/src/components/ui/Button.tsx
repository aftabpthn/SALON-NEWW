"use client";

import { forwardRef } from "react";
import { Slot } from "@radix-ui/react-slot";
import { cn } from "@/lib/utils";
import type { ButtonHTMLAttributes, ReactNode } from "react";

type ButtonVariant = "primary" | "secondary" | "ghost" | "outline";
type ButtonSize = "sm" | "md" | "lg";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  asChild?: boolean;
  isLoading?: boolean;
}

const variantStyles: Record<ButtonVariant, string> = {
  primary:
    "bg-aura-burgundy text-white shadow-md hover:bg-aura-burgundy-strong hover:shadow-lg active:scale-[0.98] focus-visible:ring-aura-burgundy/40",
  secondary:
    "bg-aura-text text-white hover:bg-aura-text/90 shadow-md hover:shadow-lg hover:scale-[1.02] active:scale-[0.98] focus-visible:ring-aura-text/30",
  ghost:
    "text-aura-text-secondary hover:text-aura-text hover:bg-black/[0.04] focus-visible:ring-aura-text/20",
  outline:
    "border border-aura-border text-aura-text hover:bg-aura-bg-warm hover:border-aura-border-strong focus-visible:ring-aura-border-strong/40",
};

const sizeStyles: Record<ButtonSize, string> = {
  sm: "min-h-11 px-4 py-2 text-sm rounded-full gap-1.5",
  md: "min-h-11 px-5 py-2.5 text-sm rounded-full gap-2",
  lg: "min-h-12 px-7 py-3.5 text-base rounded-full gap-2",
};

function LoadingSpinner() {
  return (
    <svg
      className="h-4 w-4 animate-spin"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <circle
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        className="opacity-25"
      />
      <path
        d="M12 2a10 10 0 0 1 10 10"
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
      />
    </svg>
  );
}

function getButtonClasses(
  variant: ButtonVariant,
  size: ButtonSize,
  isDisabled: boolean,
  className?: string,
) {
  return cn(
    "inline-flex items-center justify-center font-semibold transition-all duration-300 cursor-pointer",
    "focus-visible:outline-2 focus-visible:outline-offset-2",
    variantStyles[variant],
    sizeStyles[size],
    isDisabled && "pointer-events-none opacity-50",
    className,
  );
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      variant = "primary",
      size = "md",
      asChild = false,
      isLoading = false,
      disabled,
      className,
      children,
      ...props
    },
    ref,
  ) => {
    const isDisabled = disabled || isLoading;

    // Slot (asChild) expects exactly one child element — pass children through directly
    if (asChild) {
      return (
        <Slot
          ref={ref}
          aria-disabled={isDisabled || undefined}
          aria-busy={isLoading || undefined}
          className={getButtonClasses(variant, size, isDisabled, className)}
          {...props}
        >
          {children as ReactNode}
        </Slot>
      );
    }

    return (
      <button
        ref={ref}
        disabled={isDisabled}
        aria-disabled={isDisabled || undefined}
        aria-busy={isLoading || undefined}
        className={getButtonClasses(variant, size, isDisabled, className)}
        {...props}
      >
        {isLoading && <LoadingSpinner />}
        {isLoading ? (
          <span className="sr-only">Loading…</span>
        ) : (
          children
        )}
      </button>
    );
  },
);
Button.displayName = "Button";
