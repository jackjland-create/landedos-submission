"use client";

export default function PilotReadinessError({ reset }: { reset: () => void }) {
  return (
    <section className="pilot-readiness pilot-readiness--state">
      <span className="eyebrow">PILOT READINESS / ERROR</span>
      <h1>The rehearsal decision could not be loaded.</h1>
      <p>No readiness answer or live-data control was changed.</p>
      <button className="action-button" onClick={reset} type="button">
        RETRY READINESS
      </button>
    </section>
  );
}
