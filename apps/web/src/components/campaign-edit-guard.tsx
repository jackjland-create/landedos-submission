"use client";
import { useEffect, useRef, type ReactNode } from "react";

export const campaignEditSavedEvent = "landed:campaign-edit-saved";

/** Page-level views must not silently discard unsaved brief/content input. */
export function CampaignEditGuard({ children }: { children: ReactNode }) {
  const dirty = useRef(false);
  useEffect(() => {
    const unload = (event: BeforeUnloadEvent) => {
      if (dirty.current) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    const navigate = (event: MouseEvent) => {
      const link =
        event.target instanceof Element ? event.target.closest("a") : null;
      if (
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey ||
        !dirty.current ||
        !link ||
        link.target === "_blank" ||
        link.getAttribute("href")?.startsWith("#")
      )
        return;
      if (
        !window.confirm("Leave this view? Unsaved campaign edits will be lost.")
      ) {
        event.preventDefault();
        event.stopPropagation();
      } else dirty.current = false;
    };
    const saved = () => {
      dirty.current = false;
    };
    window.addEventListener("beforeunload", unload);
    document.addEventListener("click", navigate, true);
    document.addEventListener(campaignEditSavedEvent, saved);
    return () => {
      window.removeEventListener("beforeunload", unload);
      document.removeEventListener("click", navigate, true);
      document.removeEventListener(campaignEditSavedEvent, saved);
    };
  }, []);
  return (
    <div
      onChangeCapture={(event) => {
        if (event.target instanceof Element && event.target.closest("form"))
          dirty.current = true;
      }}
    >
      {children}
    </div>
  );
}
