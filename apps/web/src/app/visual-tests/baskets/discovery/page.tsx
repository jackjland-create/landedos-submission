import { notFound } from "next/navigation";
import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { BasketDiscovery } from "@/components/basket-discovery";
import { basketTimingEnabled } from "@/lib/baskets/timing-enabled";
import { createClient } from "@/lib/supabase/server";
import { project } from "@/lib/demo-data";
import { browserCampaignEnabled } from "@/lib/baskets/browser-campaign-runtime.server";

/** BSK-08: isolated rehearsal entry only, never a customer rollout. */
export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ template?: string | string[] }>;
}) {
  if (
    !basketTimingEnabled(process.env) ||
    process.env.ENABLE_TIMING_REHEARSAL !== "1"
  )
    notFound();
  const query = await searchParams;
  if (Array.isArray(query.template)) notFound();
  let canManage = false;
  let message = "";
  try {
    const client = await createClient();
    const { data, error } = await client.auth.getUser();
    if (error || !data.user)
      message =
        "Sign in to your local preview account to rehearse this journey.";
    else {
      const permission = await client.rpc("can_manage_project", {
        target_project_id: project.databaseId,
        target_workspace_id: project.workspaceId,
      });
      if (permission.error)
        message =
          "We could not confirm basket access. Reload this page to try again.";
      else canManage = permission.data === true;
    }
  } catch {
    message =
      "We could not confirm basket access. Reload this page to try again.";
  }
  return (
    <AppShell activeSection="baskets" projectId={project.id}>
      <header className="page-header">
        <div>
          <h1>Basket journey rehearsal</h1>
          <p>
            {browserCampaignEnabled()
              ? "Local synthetic rehearsal. Build a plan, review its creator commitments and explicitly approve it. Live activation remains unavailable."
              : "Local test data only. Draft creation is available; approval and campaign activation remain unavailable."}
          </p>
          <Link href={`/projects/${project.id}/baskets`}>
            Continue your saved work
          </Link>
        </div>
      </header>
      {message && (
        <p role="alert">
          {message} <Link href="/login">Open login</Link>
        </p>
      )}
      <BasketDiscovery
        key={query.template ?? "library"}
        projectId={project.id}
        templateKey={query.template}
        canManage={canManage}
        rehearsalPath="/visual-tests/baskets/discovery"
      />
    </AppShell>
  );
}
