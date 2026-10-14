"use client";

import { useEffect, useRef, type ReactNode } from "react";

export function ShellDisclosure({
  children,
  summary,
  label,
  className,
  defaultOpen = false,
}: {
  children: ReactNode;
  summary: ReactNode;
  label: string;
  className: string;
  defaultOpen?: boolean;
}) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node))
        ref.current.open = false;
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, []);
  return (
    <details
      className={className}
      open={defaultOpen || undefined}
      ref={ref}
      // Document-capture unsaved-edit guard runs first; Next Link intercepts
      // successful navigation later, so bubbling defaultPrevented is ambiguous.
      onClickCapture={(event) => {
        if (
          !event.defaultPrevented &&
          (event.target as Element).closest("a[href]")
        ) {
          event.currentTarget.open = false;
        }
      }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          event.currentTarget.open = false;
        }
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          event.currentTarget.open = false;
          event.currentTarget.querySelector("summary")?.focus();
        }
      }}
    >
      <summary aria-label={label}>{summary}</summary>
      {children}
    </details>
  );
}

export function ShellMobileMenu({ children }: { children: ReactNode }) {
  return (
    <ShellDisclosure
      className="mobile-menu"
      label="Open project navigation"
      summary="Menu"
    >
      {children}
    </ShellDisclosure>
  );
}
