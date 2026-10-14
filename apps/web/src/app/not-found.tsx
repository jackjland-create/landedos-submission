import Link from "next/link";

export default function NotFound() {
  return (
    <main className="system-state">
      <span className="eyebrow">404 / ROUTE NOT FOUND</span>
      <h1>This evidence path does not exist.</h1>
      <p>Return to the project overview and continue from a verified route.</p>
      <Link className="action-link" href="/projects/helios/overview">
        OPEN OVERVIEW
      </Link>
    </main>
  );
}
