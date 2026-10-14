import { Eyebrow } from "@landed/ui";

export default function CampaignLoading() {
  return (
    <section className="loading-frame" aria-busy="true">
      <Eyebrow>CAMPAIGN WORKSPACE</Eyebrow>
      <span className="loading-line loading-line--title" />
      <div className="loading-grid campaign-loading-grid">
        <span className="loading-panel" />
        <span className="loading-panel" />
      </div>
      <span className="loading-panel campaign-loading-timeline" />
      <span className="sr-only">
        Loading campaign decisions, timeline and evidence.
      </span>
    </section>
  );
}
