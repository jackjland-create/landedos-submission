"use client";

import { useState } from "react";

export function CopyEvidenceButton({ value }: { value: string }) {
  const [status, setStatus] = useState<"idle" | "copied" | "failed">("idle");

  return (
    <button
      className="copy-evidence-button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setStatus("copied");
        } catch {
          setStatus("failed");
        }
      }}
      type="button"
    >
      <span aria-live="polite">
        {status === "copied"
          ? "COPIED"
          : status === "failed"
            ? "COPY FAILED"
            : "COPY SIGNATURE"}
      </span>
    </button>
  );
}
