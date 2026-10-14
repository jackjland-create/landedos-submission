"use client";

import { ActionButton, Eyebrow } from "@landed/ui";

export default function BasketError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="loading-frame">
      <section className="directory-state" aria-labelledby="basket-error-title">
        <Eyebrow>RECOVERABLE ERROR</Eyebrow>
        <h1 id="basket-error-title">Basket setup could not be prepared.</h1>
        <p>Your saved scenario structure has not been changed.</p>
        <ActionButton onClick={reset} type="button">
          TRY AGAIN
        </ActionButton>
      </section>
    </main>
  );
}
