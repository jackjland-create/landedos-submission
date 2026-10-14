export default function Loading() {
  return (
    <div className="loading-frame" aria-label="Loading project data">
      <span className="loading-line loading-line--short" />
      <span className="loading-line loading-line--title" />
      <div className="loading-grid">
        <span className="loading-panel" />
        <span className="loading-panel" />
        <span className="loading-panel" />
        <span className="loading-panel" />
      </div>
    </div>
  );
}
