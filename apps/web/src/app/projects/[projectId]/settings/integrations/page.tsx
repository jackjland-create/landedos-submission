import { notFound } from "next/navigation";
import { getProjectConversionRule } from "@landed/db";
import { z } from "zod";
import styles from "@/components/measurement-setup.module.css";
import {
  MeasurementSetup,
  type SetupRuleSummary,
} from "@/components/measurement-setup";

import {
  HeliusOperationSettings,
  type HeliusOperationalStatus,
} from "@/components/helius-operation-settings";
import type {
  TrackingDestinationApprovalDraft,
  TrackingDestinationHost,
} from "@/components/tracking-destination-settings";
import { project } from "@/lib/demo-data";
import { createClient } from "@/lib/supabase/server";

type PageProps = {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

const statusSchema = z.array(
  z.object({
    integration_id: z.uuid(),
    configured_environment: z.enum(["demo", "devnet", "mainnet"]),
    control_required: z.boolean(),
    decision: z.enum(["enabled", "disabled"]),
    version: z.number().int().positive().nullable(),
    operationally_enabled: z.boolean(),
    valid_until: z.iso.datetime({ offset: true }).nullable(),
    health_state: z.enum([
      "not_required",
      "disabled",
      "unobserved",
      "healthy",
      "degraded",
      "stale",
      "expired",
    ]),
    health_observed_at: z.iso.datetime({ offset: true }).nullable(),
    retained_delivery_count: z.number().int().nonnegative(),
    delivery_limit: z.number().int().positive(),
    retained_raw_bytes: z.number().int().nonnegative(),
    raw_byte_limit: z.number().int().positive(),
    can_manage: z.boolean(),
  }),
);

const destinationHostSchema = z.array(
  z.object({
    id: z.uuid(),
    hostname: z.string().min(1),
    reason: z.string().min(1),
    added_at: z.iso.datetime({ offset: true }),
    revoked_at: z.iso.datetime({ offset: true }).nullable(),
  }),
);

const approvalDraftSchema = z.object({
  hostname: z
    .string()
    .trim()
    .min(1)
    .max(253)
    .regex(/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/i),
  requestId: z.uuid(),
  reason: z.string().trim().min(8).max(240),
});

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export const metadata = { title: "Website & measurement" };

export default async function IntegrationSettingsPage({
  params,
  searchParams,
}: PageProps) {
  const { projectId } = await params;
  if (projectId !== project.id) notFound();

  const client = await createClient();
  const [
    statusResult,
    destinationResult,
    activeDestinationResult,
    adminResult,
  ] = await Promise.all([
    client.rpc("list_helius_integration_operational_status", {
      target_project_id: project.databaseId,
    }),
    client
      .from("project_tracking_destination_hosts")
      .select("id, hostname, reason, added_at, revoked_at")
      .eq("project_id", project.databaseId)
      .order("added_at", { ascending: false })
      .limit(20),
    client
      .from("project_tracking_destination_hosts")
      .select("id")
      .eq("project_id", project.databaseId)
      .is("revoked_at", null)
      .limit(1),
    client.rpc("is_workspace_admin", {
      target_workspace_id: project.workspaceId,
    }),
  ]);
  const { data, error } = statusResult;
  if (error?.code === "42501") {
    return (
      <section className={styles.page}>
        <p>Project settings</p>
        <h1>Website &amp; measurement is restricted.</h1>
        <p>
          Ask your workspace admin for project access to inspect these settings.
        </p>
      </section>
    );
  }
  if (error)
    throw new Error("Integration operational status could not be loaded.");

  const parsed = statusSchema.safeParse(data);
  if (!parsed.success)
    throw new Error("Integration operational status was incomplete.");

  if (destinationResult.error)
    throw new Error("Tracking destination policy could not be loaded.");
  const parsedDestinations = destinationHostSchema.safeParse(
    destinationResult.data,
  );
  if (!parsedDestinations.success)
    throw new Error("Tracking destination policy was incomplete.");

  if (activeDestinationResult.error)
    throw new Error("Active tracking destination policy could not be loaded.");
  const hasActiveDestinationPolicy =
    Array.isArray(activeDestinationResult.data) &&
    activeDestinationResult.data.length > 0;

  if (adminResult.error)
    throw new Error("Destination approval permission could not be loaded.");

  const query = await searchParams;
  const parsedDraft = approvalDraftSchema.safeParse({
    hostname: first(query.destinationHostname),
    requestId: first(query.destinationRequestId),
    reason: first(query.destinationReason),
  });
  const destinationApprovalDraft: TrackingDestinationApprovalDraft | null =
    parsedDraft.success ? parsedDraft.data : null;

  const statuses: HeliusOperationalStatus[] = parsed.data.map((status) => ({
    integrationId: status.integration_id,
    configuredEnvironment: status.configured_environment,
    controlRequired: status.control_required,
    decision: status.decision,
    version: status.version,
    operationallyEnabled: status.operationally_enabled,
    validUntil: status.valid_until,
    healthState: status.health_state,
    healthObservedAt: status.health_observed_at,
    retainedDeliveryCount: status.retained_delivery_count,
    deliveryLimit: status.delivery_limit,
    retainedRawBytes: status.retained_raw_bytes,
    rawByteLimit: status.raw_byte_limit,
    canManage: status.can_manage,
  }));

  const destinationHosts: TrackingDestinationHost[] =
    parsedDestinations.data.map((host) => ({
      id: host.id,
      hostname: host.hostname,
      reason: host.reason,
      addedAt: host.added_at,
      revokedAt: host.revoked_at,
    }));

  // Same authenticated, project-scoped reader as Success rules. A failed read
  // must not become a missing rule or prevent recovery in existing controls.
  let ruleSummary: SetupRuleSummary;
  try {
    const rule = await getProjectConversionRule(client, project.databaseId);
    const latest = rule?.versions[0];
    ruleSummary = latest
      ? {
          state: "saved",
          name: latest.name,
          version: latest.version,
          createdAt: latest.createdAt,
        }
      : { state: "missing" };
  } catch {
    ruleSummary = { state: "unavailable" };
  }

  return (
    <MeasurementSetup
      projectId={projectId}
      hasActiveWebsite={hasActiveDestinationPolicy}
      canApproveWebsite={adminResult.data === true}
      rule={ruleSummary}
      snapshotAt={new Date().toISOString()}
      operationsInitiallyOpen={destinationApprovalDraft !== null}
    >
      <HeliusOperationSettings
        canApproveDestinationHosts={adminResult.data === true}
        destinationApprovalDraft={destinationApprovalDraft}
        destinationHosts={destinationHosts}
        hasActiveDestinationPolicy={hasActiveDestinationPolicy}
        projectId={projectId}
        statuses={statuses}
      />
    </MeasurementSetup>
  );
}
