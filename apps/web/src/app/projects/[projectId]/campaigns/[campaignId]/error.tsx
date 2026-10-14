"use client";

import { ActionButton, Eyebrow } from "@landed/ui";

export default function CampaignError({ reset }: { reset: () => void }) {
  return (
    <section className="directory-state" role="alert">
      <Eyebrow>CAMPAIGN WORKSPACE</Eyebrow>
      <h2>The campaign could not be prepared.</h2>
      <p>No commercial or roster record was changed.</p>
      <ActionButton onClick={reset} type="button">
        TRY AGAIN
      </ActionButton>
    </section>
  );
}
