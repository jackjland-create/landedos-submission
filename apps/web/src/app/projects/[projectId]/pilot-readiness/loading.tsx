export default function PilotReadinessLoading() {
  return (
    <section
      aria-busy="true"
      aria-label="Loading pilot readiness"
      className="pilot-readiness pilot-readiness--state"
    >
      <span className="eyebrow">PILOT READINESS</span>
      <h1>Loading the rehearsal decision…</h1>
      <div className="pilot-readiness__skeleton" />
    </section>
  );
}
