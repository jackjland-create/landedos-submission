import "server-only";

import { trackedLinkDestinationSchema } from "@landed/contracts";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { readWalletMeasurementRuleContext } from "./measurement-context.server";

const scope = z.object({
  workspace_id: z.uuid(),
  project_id: z.uuid(),
  campaign_id: z.uuid(),
  creator_id: z.uuid(),
  content_asset_id: z.uuid(),
});
const sessionSchema = scope.extend({
  id: z.uuid(),
  tracked_link_id: z.uuid(),
  expires_at: z.iso.datetime({ offset: true }),
});
const linkSchema = scope.extend({
  id: z.uuid(),
  destination_host_id: z.uuid(),
  destination_url: trackedLinkDestinationSchema,
  expires_at: z.iso.datetime({ offset: true }),
  revoked_at: z.string().nullable(),
});
const hostSchema = z.object({
  id: z.uuid(),
  workspace_id: z.uuid(),
  project_id: z.uuid(),
  hostname: z.string().min(1),
  revoked_at: z.string().nullable(),
});

/** WAL-01 / TRK-01 / SEC-02: read-only, session-bound onward navigation.
 * Never take a destination or session identifier from browser query parameters.
 * This is not a new click, consent, conversion, or measurement-ready assertion.
 */
export async function readHostedContinuation(
  client: SupabaseClient,
  sessionId: string,
  applicationOrigin: string,
  now = Date.now(),
): Promise<{ url: string; hostname: string } | null> {
  if (!z.uuid().safeParse(sessionId).success) return null;
  // Reuses the exact qualified-session, live campaign, retained rule, devnet
  // receiver and measurement-window boundary. No latest-project-rule fallback.
  if (!(await readWalletMeasurementRuleContext(client, sessionId))) return null;
  const sessionResult = await client
    .from("anonymous_sessions")
    .select(
      "id, workspace_id, project_id, campaign_id, creator_id, content_asset_id, tracked_link_id, expires_at",
    )
    .eq("id", sessionId)
    .maybeSingle();
  if (sessionResult.error)
    throw new Error("Continuation session could not be read.");
  const parsedSession = sessionSchema.safeParse(sessionResult.data);
  if (!parsedSession.success) return null;
  const session = parsedSession.data;
  if (session.id !== sessionId || new Date(session.expires_at).getTime() <= now)
    return null;

  const linkResult = await client
    .from("tracked_links")
    .select(
      "id, workspace_id, project_id, campaign_id, creator_id, content_asset_id, destination_host_id, destination_url, expires_at, revoked_at",
    )
    .eq("id", session.tracked_link_id)
    .eq("workspace_id", session.workspace_id)
    .eq("project_id", session.project_id)
    .eq("campaign_id", session.campaign_id)
    .eq("creator_id", session.creator_id)
    .eq("content_asset_id", session.content_asset_id)
    .maybeSingle();
  if (linkResult.error) throw new Error("Continuation link could not be read.");
  const parsedLink = linkSchema.safeParse(linkResult.data);
  if (!parsedLink.success) return null;
  const link = parsedLink.data;
  if (
    link.id !== session.tracked_link_id ||
    link.revoked_at !== null ||
    new Date(link.expires_at).getTime() <= now ||
    Object.keys(scope.shape).some(
      (key) =>
        link[key as keyof typeof scope.shape] !==
        session[key as keyof typeof scope.shape],
    )
  )
    return null;

  const hostResult = await client
    .from("project_tracking_destination_hosts")
    .select("id, workspace_id, project_id, hostname, revoked_at")
    .eq("id", link.destination_host_id)
    .eq("workspace_id", session.workspace_id)
    .eq("project_id", session.project_id)
    .maybeSingle();
  if (hostResult.error)
    throw new Error("Continuation website approval could not be read.");
  const parsedHost = hostSchema.safeParse(hostResult.data);
  if (!parsedHost.success) return null;
  const host = parsedHost.data;
  if (
    host.id !== link.destination_host_id ||
    host.workspace_id !== session.workspace_id ||
    host.project_id !== session.project_id ||
    host.revoked_at !== null
  )
    return null;

  const destination = new URL(link.destination_url);
  const application = new URL(applicationOrigin);
  if (
    destination.protocol !== "https:" ||
    destination.username ||
    destination.password ||
    /[\\\u0000-\u0020\u007f]/.test(link.destination_url) ||
    link.destination_url.length > 2048 ||
    destination.hostname !== host.hostname ||
    destination.hostname === application.hostname
  )
    return null;
  // No appended click, wallet, proof, consent, or session identifiers.
  return { url: destination.toString(), hostname: destination.hostname };
}
