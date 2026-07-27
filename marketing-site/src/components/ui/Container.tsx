"use client";

import { cn } from "@/lib/utils";

interface ContainerProps {
  children: React.ReactNode;
  className?: string;
  size?: "default" | "narrow" | "wide";
}

export function Container({ children, className, size = "default" }: ContainerProps) {
  return (
    <div
      className={cn(
        "mx-auto w-full px-4 sm:px-6 lg:px-10",
        size === "narrow" && "max-w-4xl",
        size === "default" && "max-w-[82rem]",
        size === "wide" && "max-w-[90rem]",
        className
      )}
    >
      {children}
    </div>
  );
}
