import { notFound } from "next/navigation";
import { AppShell } from "@/components/app-shell";
import { PrivateLinkStrategyFixture } from "./private-link-strategy-fixture";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Private-link strategy visual fixture",
  robots: { index: false, follow: false },
};

/** Layout-only fixture. It never reads or writes an actual basket. */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ state?: string }>;
}) {
  if (process.env.NODE_ENV !== "development" || process.env.VERCEL) notFound();
  const { state } = await searchParams;
  return (
    <AppShell activeSection="baskets" projectId="helios" showGuidedDemo={false}>
      <header className="page-header">
        <div>
          <h1>Internal devnet response proof</h1>
          <p>One creator · one private link · no planned channel spend</p>
        </div>
      </header>
      <PrivateLinkStrategyFixture
        state={state === "permission" || state === "error" ? state : "ready"}
      />
    </AppShell>
  );
}
