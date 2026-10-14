import "server-only";

import { createHash } from "node:crypto";
import {
  retainedReportInstantSchema,
  retainedReportMicros,
  timedCampaignReportReviewSchema,
} from "@landed/analytics";
import {
  heliusEnhancedTransactionSchema,
  normalizeHeliusEnhancedTransaction,
  canonicalSolanaTransferSchema,
} from "@landed/solana";
import { z } from "zod";
import { conversionRuleVersionRecordSchema } from "@landed/contracts";
import {
  attributionTouchCandidateSchema,
  conversionWalletContextSchema,
  evaluateConversion,
  evaluateLastTouchAttribution,
  exactInstant,
  evaluateConversionV2,
  evaluateLastTouchAttributionV2,
  conversionWalletContextV2Schema,
  attributionTouchCandidateV2Schema,
} from "@landed/attribution";

const rowSchema = z.record(z.string(), z.unknown());
type Row = z.infer<typeof rowSchema>;
const bundleSchema = z.strictObject({
  protocol: z.literal("landed:timed-report-evidence:1"),
  sourceHash: z.string().regex(/^[0-9a-f]{64}$/),
  hashEncoding: z.literal("postgres-jsonb-text-utf8-sha256"),
  checkedAt: z.string(),
  evidence: rowSchema,
  completeness: z.literal("not_established"),
  issuance: z.literal("blocked"),
  localDevnetBoundary: z
    .strictObject({
      protocol: z.literal("landed:local-devnet-report-boundary:1"),
      workspaceId: z.uuid(),
      projectId: z.uuid(),
      campaignId: z.uuid(),
      executionId: z.uuid(),
    })
    .optional(),
});
const text = (r: Row, k: string) => z.string().parse(r[k]);
const number = (r: Row, k: string) =>
  z.number().int().nonnegative().safe().parse(r[k]);
const id = (r: Row, k = "id") => z.uuid().parse(r[k]);
const instant = (value: unknown) => {
  const input = z.string().parse(value);
  // PostgreSQL JSON uses offsets; preserve exact microseconds for comparisons.
  const fraction = /\.(\d+)(?:Z|[+-]\d\d:\d\d)$/.exec(input)?.[1] ?? "";
  if (fraction.length > 6 || !/^0*$/.test(fraction.slice(3)))
    throw new Error(
      "Retained evidence precision is unsupported by evaluator V1.",
    );
  return new Date(input).toISOString();
};
const same = (left: unknown, right: unknown): boolean => {
  if (Array.isArray(left) || Array.isArray(right))
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((v, i) => same(v, right[i]))
    );
  if (left && right && typeof left === "object" && typeof right === "object") {
    const a = Object.entries(left),
      b = Object.entries(right);
    return (
      a.length === b.length &&
      a.every(([k, v]) => Object.hasOwn(right, k) && same(v, (right as Row)[k]))
    );
  }
  return left === right;
};
function requireEvidence(
  condition: boolean,
  message: string,
): asserts condition {
  if (!condition) throw new Error(message);
}

/** Private trusted-calculator input only. SQL hash is an opaque source binding,
 * not authentication of arbitrary caller JSON. Never serialize the input to UI.
 * This checks bounded retained acquisition and reconstructs conversion results,
 * not provider-wide exhaustion. It cannot authorize issuance.
 */
export function inspectRetainedReportCoverage(rawBundle: unknown) {
  const bundle = bundleSchema.parse(rawBundle);
  const e = bundle.evidence;
  requireEvidence(
    e.protocol === bundle.protocol &&
      e.sourceScope === "project_retained_evidence",
    "Unknown evidence protocol.",
  );
  const bridge = rowSchema.parse(e.executionReview);
  const review = timedCampaignReportReviewSchema.parse(bridge.reportReview);
  const s = review.reportSources;
  if (bundle.localDevnetBoundary) {
    const boundary = bundle.localDevnetBoundary;
    const execution = z
      .object({ approvalId: z.uuid() })
      .parse(bridge.execution);
    requireEvidence(
      boundary.workspaceId === s.workspaceId &&
        boundary.projectId === s.projectId &&
        boundary.campaignId === s.campaignId &&
        boundary.executionId === execution.approvalId,
      "Local devnet report boundary does not match retained evidence.",
    );
  }
  const checkedAt = retainedReportInstantSchema.parse(bundle.checkedAt);
  requireEvidence(
    retainedReportMicros(s.measurementWindow.endedAt) <=
      retainedReportMicros(checkedAt),
    "Final reporting requires a closed measurement interval.",
  );
  const rows = (name: string) => {
    const values = z.array(rowSchema).max(10000).parse(e[name]);
    for (const r of values)
      requireEvidence(
        r.workspace_id === s.workspaceId && r.project_id === s.projectId,
        "Retained source scope does not match.",
      );
    const identities = values.map((r) => r.id).filter((v) => v !== undefined);
    requireEvidence(
      new Set(identities).size === identities.length,
      "Duplicate retained source identity.",
    );
    return values;
  };
  const raw = rows("raw_chain_events"),
    deliveries = rows("raw_chain_event_deliveries");
  const canonical = rows("canonical_chain_events"),
    links = rows("canonical_chain_event_sources");
  const finality = rows("solana_finality_observations");
  const jobs = rows("solana_reconciliation_jobs"),
    jobEvents = rows("solana_reconciliation_job_events");
  const jobDeliveries = rows("solana_reconciliation_job_deliveries");
  const mappings = rows("protected_wallet_mappings");
  const byId = (values: Row[], target: unknown) => {
    const found = values.filter((r) => r.id === target);
    requireEvidence(
      found.length === 1,
      "Missing or ambiguous retained evidence.",
    );
    return found[0]!;
  };
  const normalizedCounts = new Map<string, number>();
  for (const delivery of deliveries) {
    const payload = z
      .array(heliusEnhancedTransactionSchema)
      .max(100)
      .parse(delivery.raw_payload);
    const body = text(delivery, "raw_body");
    requireEvidence(
      createHash("sha256").update(body, "utf8").digest("hex") ===
        delivery.payload_sha256 &&
        same(JSON.parse(body), delivery.raw_payload) &&
        payload.length === number(delivery, "event_count"),
      "Retained delivery payload is inconsistent.",
    );
    const events = raw
      .filter((r) => r.delivery_id === delivery.id)
      .sort(
        (a, b) =>
          number(a, "provider_event_index") - number(b, "provider_event_index"),
      );
    requireEvidence(
      events.length === payload.length,
      "Retained delivery is missing raw transactions.",
    );
    events.forEach((r, i) =>
      requireEvidence(
        number(r, "provider_event_index") === i &&
          same(r.raw_payload, (delivery.raw_payload as unknown[])[i]),
        "Retained raw transaction does not match its delivery position.",
      ),
    );
  }
  for (const r of raw) {
    const delivery = byId(deliveries, r.delivery_id);
    const transaction = heliusEnhancedTransactionSchema.parse(r.raw_payload);
    requireEvidence(
      transaction.signature === r.transaction_signature &&
        String(transaction.slot) === r.slot &&
        String(transaction.timestamp) === r.provider_timestamp &&
        r.integration_id === delivery.integration_id &&
        r.configured_environment === delivery.configured_environment &&
        r.acquisition_source === delivery.acquisition_source,
      "Retained raw transaction identity is inconsistent.",
    );
    const normalized = normalizeHeliusEnhancedTransaction(transaction, {
      workspaceId: s.workspaceId,
      projectId: s.projectId,
      rawEvidenceId: id(r),
      sourceEventId: id(r),
      source: z
        .enum(["helius_webhook", "helius_backfill"])
        .parse(r.acquisition_source),
      ingestedAt: retainedReportInstantSchema.parse(r.received_at),
    });
    requireEvidence(
      normalized.issues.length === 0,
      "Retained transaction normalization is unresolved.",
    );
    normalizedCounts.set(id(r), normalized.events.length);
    const sourceLinks = links.filter((l) => l.raw_chain_event_id === r.id);
    requireEvidence(
      sourceLinks.length === normalized.events.length,
      "Normalized transfer evidence is incomplete.",
    );
    const used = new Set<string>();
    for (const event of normalized.events) {
      const matched = sourceLinks.filter((l) => {
        const c = byId(canonical, l.canonical_chain_event_id);
        return (
          c.source_transfer_kind === event.sourceTransferKind &&
          c.source_transfer_index === event.sourceTransferIndex
        );
      });
      requireEvidence(
        matched.length === 1,
        "Normalized transfer source is missing or ambiguous.",
      );
      const l = matched[0]!,
        c = byId(canonical, l.canonical_chain_event_id),
        f = byId(finality, l.finality_observation_id);
      requireEvidence(
        !used.has(id(c)),
        "Duplicate normalized transfer source.",
      );
      used.add(id(c));
      const actual = canonicalSolanaTransferSchema.parse(c.payload);
      const semantic = (v: typeof actual) => {
        const {
          id: _id,
          rawEvidenceId: _raw,
          sourceEventId: _sourceId,
          source: _source,
          ingestedAt: _time,
          ...rest
        } = v;
        void _id;
        void _raw;
        void _sourceId;
        void _source;
        void _time;
        return { ...rest, eventTime: instant(rest.eventTime) };
      };
      requireEvidence(
        same(semantic(actual), semantic(event)) &&
          c.finality === "finalized" &&
          f.raw_chain_event_id === r.id &&
          f.transaction_signature === transaction.signature &&
          f.transaction_slot === String(transaction.slot) &&
          f.confirmation_status === "finalized" &&
          f.transaction_error === null &&
          f.confirmations === null &&
          f.method === "getSignatureStatuses" &&
          l.transaction_signature === f.transaction_signature &&
          l.transaction_slot === f.transaction_slot &&
          l.integration_id === r.integration_id &&
          f.integration_id === r.integration_id &&
          l.configured_environment === r.configured_environment &&
          f.configured_environment === r.configured_environment,
        "Canonical transfer or finality disagrees with retained raw evidence.",
      );
      const rpc = z
        .object({
          jsonrpc: z.literal("2.0"),
          result: z.object({
            context: z.object({ slot: z.number().int().safe() }),
            value: z.tuple([
              z.object({
                slot: z.number().int().safe(),
                confirmationStatus: z.literal("finalized"),
                confirmations: z.null(),
                err: z.null(),
              }),
            ]),
          }),
        })
        .parse(f.rpc_response);
      requireEvidence(
        String(rpc.result.context.slot) === f.observed_context_slot &&
          String(rpc.result.value[0].slot) === f.transaction_slot &&
          rpc.result.context.slot >= rpc.result.value[0].slot,
        "Finality response identity is inconsistent.",
      );
    }
  }
  for (const c of canonical)
    requireEvidence(
      links.some(
        (l) =>
          l.canonical_chain_event_id === c.id &&
          l.raw_chain_event_id === c.raw_chain_event_id &&
          l.finality_observation_id === c.finality_observation_id,
      ),
      "Canonical transfer has no retained primary source.",
    );
  for (const l of links) {
    byId(raw, l.raw_chain_event_id);
    byId(canonical, l.canonical_chain_event_id);
  }

  const at = (value: unknown) =>
    retainedReportMicros(retainedReportInstantSchema.parse(value));
  const snapshotRule = s.commercialPlanSnapshot.strategyBinding.conversionRule;
  // Older immutable commercial snapshots omit the destination tuple, but bind
  // its immutable rule-version ID. Reconstruct from that exact retained row;
  // never guess a network/destination or alter the commercial snapshot.
  const retainedRule = byId(rows("conversion_rule_versions"), snapshotRule.id);
  for (const [key, value] of Object.entries(snapshotRule)) {
    if (value === undefined) continue;
    const column = key.replace(
      /[A-Z]/g,
      (letter) => `_${letter.toLowerCase()}`,
    );
    const retained = retainedRule[column];
    requireEvidence(
      ["createdAt", "effectiveFrom", "effectiveUntil"].includes(key) &&
        value !== null
        ? at(value) === at(retained)
        : key === "nativeAmountLamports" && value !== null
          ? String(retained) === value
          : retained === value,
      "Retained immutable rule disagrees with the commercial binding.",
    );
  }
  const rule = {
    ...snapshotRule,
    ...(retainedRule.configured_environment == null
      ? {}
      : {
          configuredEnvironment: retainedRule.configured_environment,
          destinationAddress: retainedRule.destination_address,
          nativeAmountLamports: String(retainedRule.native_amount_lamports),
        }),
  };
  const minimum = (values: bigint[]) =>
    values.reduce((a, b) => (a < b ? a : b));
  const maximum = (values: bigint[]) =>
    values.reduce((a, b) => (a > b ? a : b));
  const requiredMappings = mappings
    .filter((m) => m.campaign_id === s.campaignId)
    .map((m) => ({
      mapping: m,
      from: maximum([at(m.active_from), at(rule.effectiveFrom)]),
      to: minimum([
        at(m.monitoring_ends_at),
        at(s.measurementWindow.endedAt),
        ...(m.unlinked_at === null ? [] : [at(m.unlinked_at)]),
        ...(rule.effectiveUntil === null ? [] : [at(rule.effectiveUntil)]),
      ]),
    }))
    .filter(
      (v) =>
        v.from < v.to &&
        v.from < at(s.measurementWindow.endedAt) &&
        v.to > at(s.measurementWindow.startedAt),
    );
  requireEvidence(
    requiredMappings.length === review.historyReadiness.mappings.length &&
      requiredMappings.every((v) =>
        review.historyReadiness.mappings.some(
          (h) =>
            h.mappingId === v.mapping.id &&
            at(h.requiredHistory.startedAt) === v.from &&
            at(h.requiredHistory.endedAt) === v.to,
        ),
      ),
    "History diagnostics omit or alter a required consented mapping.",
  );
  const mappingProofs = review.historyReadiness.mappings.map((h) => {
    const m = byId(mappings, h.mappingId);
    requireEvidence(
      m.campaign_id === s.campaignId &&
        m.creator_id === h.creatorId &&
        m.content_asset_id === h.contentAssetId,
      "History mapping scope is inconsistent.",
    );
    requireEvidence(
      h.matchingJob !== null,
      "Required consented history is not reconciled.",
    );
    const job = byId(jobs, h.matchingJob.id);
    requireEvidence(
      job.mapping_id === m.id &&
        job.consent_id === m.consent_id &&
        job.wallet_address === m.wallet_address &&
        job.campaign_id === s.campaignId &&
        job.status === "completed" &&
        job.next_before_signature === null &&
        number(job, "normalization_issue_count") === 0 &&
        at(job.completed_at) === at(h.matchingJob.completedAt) &&
        at(job.completed_at) <= at(checkedAt) &&
        at(job.range_ended_at) <= at(job.created_at) &&
        at(job.created_at) <= at(job.started_at) &&
        at(job.started_at) <= at(job.completed_at) &&
        job.failed_at === null &&
        job.failure_code === null &&
        at(job.range_started_at) <= at(h.requiredHistory.startedAt) &&
        at(job.range_ended_at) >= at(h.requiredHistory.endedAt),
      "History reconciliation does not cover the required interval.",
    );
    const events = jobEvents.filter((v) => v.job_id === job.id);
    for (const linked of [
      ...events,
      ...jobDeliveries.filter((v) => v.job_id === job.id),
    ])
      for (const key of [
        "mapping_id",
        "integration_id",
        "configured_environment",
      ])
        requireEvidence(
          linked[key] === job[key],
          "Reconciliation linkage scope disagrees.",
        );
    for (const key of ["creator_id", "content_asset_id", "tracked_link_id"])
      requireEvidence(
        job[key] === m[key],
        "Reconciliation campaign linkage disagrees.",
      );
    requireEvidence(
      events.every((v) => v.kind !== "failed") &&
        events.filter(
          (v) =>
            v.kind === "queued" && at(v.occurred_at) === at(job.created_at),
        ).length === 1,
      "Reconciliation lifecycle is inconsistent.",
    );
    const pages = events
      .filter((v) => v.kind === "page_completed")
      .sort((a, b) => number(a, "page_number") - number(b, "page_number"));
    requireEvidence(
      pages.length > 0 &&
        pages.length === number(job, "page_count") &&
        events.filter(
          (v) =>
            v.kind === "completed" &&
            at(v.occurred_at) === at(job.completed_at),
        ).length === 1,
      "Reconciliation page/completion evidence is missing.",
    );
    pages.forEach((p, i) =>
      requireEvidence(
        number(p, "page_number") === i + 1 &&
          p.cursor_before === (i === 0 ? null : pages[i - 1]!.cursor_after) &&
          (i === pages.length - 1
            ? p.cursor_after === null
            : typeof p.cursor_after === "string") &&
          (i === pages.length - 1
            ? number(p, "raw_event_count") < 100
            : number(p, "raw_event_count") === 100) &&
          at(p.occurred_at) >=
            (i === 0 ? at(job.started_at) : at(pages[i - 1]!.occurred_at)) &&
          at(p.occurred_at) <= at(job.completed_at) &&
          number(p, "normalization_issue_count") === 0,
        "Reconciliation page continuity is invalid.",
      ),
    );
    for (const counter of [
      "raw_event_count",
      "canonical_event_count",
      "duplicate_event_count",
      "normalization_issue_count",
    ])
      requireEvidence(
        pages.reduce((n, p) => n + number(p, counter), 0) ===
          number(job, counter),
        "Reconciliation counters disagree.",
      );
    const retainedDeliveries = jobDeliveries
      .filter((v) => v.job_id === job.id)
      .map((l) => byId(deliveries, l.delivery_id));
    for (const d of retainedDeliveries)
      requireEvidence(
        d.integration_id === job.integration_id &&
          d.configured_environment === job.configured_environment &&
          d.acquisition_source === "helius_backfill",
        "Reconciliation delivery scope disagrees.",
      );
    requireEvidence(
      new Set(retainedDeliveries.map((d) => d.id)).size ===
        retainedDeliveries.length,
      "Duplicate job delivery.",
    );
    const retainedRaw = raw.filter((r) =>
      retainedDeliveries.some((d) => d.id === r.delivery_id),
    );
    requireEvidence(
      retainedRaw.length === number(job, "raw_event_count") &&
        retainedRaw.reduce((n, r) => n + normalizedCounts.get(id(r))!, 0) ===
          number(job, "canonical_event_count") +
            number(job, "duplicate_event_count"),
      "Reconciliation totals do not match retained transactions.",
    );
    // No page-to-delivery foreign key exists yet. Only unambiguous single-data-
    // page histories qualify here, optionally followed by an empty terminal page.
    requireEvidence(
      pages.filter((p) => number(p, "raw_event_count") > 0).length <= 1 &&
        retainedDeliveries.length <= 1,
      "Multi-page delivery ownership requires additional retained evidence.",
    );
    if (pages.length > 1) {
      const ordered = [...retainedRaw].sort(
        (a, b) =>
          number(a, "provider_event_index") - number(b, "provider_event_index"),
      );
      requireEvidence(
        pages[0]!.cursor_after === ordered.at(-1)?.transaction_signature,
        "Continuation cursor does not match retained page.",
      );
    }
    return {
      mappingId: h.mappingId,
      jobId: id(job),
      requiredHistory: h.requiredHistory,
      pageCount: pages.length,
      rawTransactionCount: retainedRaw.length,
    };
  });
  const sessions = rows("anonymous_sessions"),
    sessionClicks = rows("anonymous_session_clicks"),
    clicks = rows("click_events"),
    qualities = rows("click_quality_assessments");
  const proofs = rows("wallet_session_proofs"),
    consents = rows("wallet_measurement_consents");
  const conversions = rows("conversion_facts"),
    attributions = rows("attribution_facts");
  // Never reinterpret retained V1 facts with V2 semantics. A mixed execution
  // requires a separate version-aware report path and fails closed here.
  const executionConversions = conversions.filter(
    (c) =>
      c.campaign_id === s.campaignId && c.rule_version_id === s.ruleVersionId,
  );
  const executionAttributions = attributions.filter(
    (a) =>
      a.campaign_id === s.campaignId && a.rule_version_id === s.ruleVersionId,
  );
  const evaluatorVersion = executionConversions.some(
    (c) => c.evaluator_version === 2,
  )
    ? 2
    : 1;
  requireEvidence(
    executionConversions.every(
      (c) => c.evaluator_version === evaluatorVersion,
    ) &&
      executionAttributions.every(
        (a) => a.attribution_evaluator_version === evaluatorVersion,
      ) &&
      (evaluatorVersion === 1 ||
        (rule.configuredEnvironment === "devnet" &&
          rule.templateCode === "first_qualifying_transaction" &&
          rule.destinationAddress != null &&
          rule.nativeAmountLamports === "1")),
    "Retained evaluator versions or rule scope disagree.",
  );
  const evaluationInstant = evaluatorVersion === 2 ? exactInstant : instant;
  const walletSchema =
    evaluatorVersion === 2
      ? conversionWalletContextV2Schema
      : conversionWalletContextSchema;
  const touchSchema =
    evaluatorVersion === 2
      ? attributionTouchCandidateV2Schema
      : attributionTouchCandidateSchema;
  const ruleVersion = conversionRuleVersionRecordSchema.parse({
    ...rule,
    effectiveFrom: evaluationInstant(rule.effectiveFrom),
    effectiveUntil:
      rule.effectiveUntil === null
        ? null
        : evaluationInstant(rule.effectiveUntil),
    // Audit metadata is not an evaluator boundary. Preserve its exact supported
    // microseconds; effective times and attribution inputs still use V1 checks.
    createdAt: retainedReportInstantSchema.parse(rule.createdAt),
  });
  const wallet = (m: Row) =>
    walletSchema.parse({
      protectedWalletMappingId: id(m),
      anonymousSessionId: id(m, "anonymous_session_id"),
      workspaceId: s.workspaceId,
      projectId: s.projectId,
      walletAddress: text(m, "wallet_address"),
      activeFrom: evaluationInstant(m.active_from as string),
      monitoringEndsAt: evaluationInstant(m.monitoring_ends_at as string),
      unlinkedAt:
        m.unlinked_at === null
          ? null
          : evaluationInstant(m.unlinked_at as string),
    });
  const touches = mappings.map((m) => {
    const session = byId(sessions, m.anonymous_session_id),
      click = byId(clicks, session.qualified_click_event_id),
      quality = byId(qualities, session.qualified_assessment_id);
    const proof = byId(proofs, m.proof_id),
      consent = byId(consents, m.consent_id);
    for (const r of [session, click, quality, proof, consent])
      for (const key of [
        "campaign_id",
        "creator_id",
        "content_asset_id",
        "tracked_link_id",
      ])
        requireEvidence(
          r[key] === m[key],
          "Retained touch scope is inconsistent.",
        );
    requireEvidence(
      proof.anonymous_session_id === session.id &&
        consent.anonymous_session_id === session.id &&
        consent.proof_id === proof.id &&
        proof.wallet_address === m.wallet_address &&
        consent.wallet_address === m.wallet_address &&
        at(proof.verified_at) <= at(consent.accepted_at) &&
        at(consent.accepted_at) === at(m.active_from) &&
        at(consent.monitoring_ends_at) === at(m.monitoring_ends_at) &&
        quality.click_event_id === click.id &&
        click.signature_valid === true &&
        quality.outcome === "qualified" &&
        quality.reason === "passed_declared_checks",
      "Retained wallet touch proof/consent is inconsistent.",
    );
    const bound = sessionClicks.filter(
      (v) =>
        v.session_id === session.id &&
        v.click_event_id === click.id &&
        v.assessment_id === quality.id &&
        v.kind === "originating",
    );
    requireEvidence(
      bound.length === 1,
      "Originating qualified touch is missing.",
    );
    return touchSchema.parse({
      id: id(m),
      workspaceId: s.workspaceId,
      projectId: s.projectId,
      campaignId: id(m, "campaign_id"),
      creatorId: id(m, "creator_id"),
      contentAssetId: id(m, "content_asset_id"),
      trackedLinkId: id(m, "tracked_link_id"),
      clickEventId: id(click),
      clickQualityAssessmentId: id(quality),
      anonymousSessionId: id(session),
      walletProofId: id(proof),
      measurementConsentId: id(consent),
      protectedWalletMappingId: id(m),
      walletAddress: text(m, "wallet_address"),
      touchTime: evaluationInstant(session.created_at as string),
      sessionExpiresAt: evaluationInstant(session.expires_at as string),
      mappingActiveFrom: evaluationInstant(m.active_from as string),
      mappingMonitoringEndsAt: evaluationInstant(
        m.monitoring_ends_at as string,
      ),
      mappingUnlinkedAt:
        m.unlinked_at === null
          ? null
          : evaluationInstant(m.unlinked_at as string),
      linkEligibility: click.eligibility,
      clickQualityOutcome: quality.outcome,
      clickQualityReason: quality.reason,
      sessionClickKind: "originating",
    });
  });
  const expectedIds: string[] = [];
  const exclusions: { mappingId: string; reason: string }[] = [];
  const ordering = (a: Row, b: Row) => {
    for (const [x, y] of [
      [at(a.event_time), at(b.event_time)],
      [
        BigInt(text(a, "transaction_slot")),
        BigInt(text(b, "transaction_slot")),
      ],
    ] as const)
      if (x !== y) return x < y ? -1 : 1;
    // Base58 ordering must match PostgreSQL's bytewise text order, not locale.
    if (a.transaction_signature !== b.transaction_signature)
      return text(a, "transaction_signature") < text(b, "transaction_signature")
        ? -1
        : 1;
    return (
      number(a, "source_transfer_index") - number(b, "source_transfer_index") ||
      (id(a) < id(b) ? -1 : id(a) > id(b) ? 1 : 0)
    );
  };
  for (const { mapping: m } of requiredMappings) {
    const context = wallet(m);
    const candidates = canonical
      .filter((c) => c.from_address === m.wallet_address)
      .sort(ordering);
    const first = candidates
      .map((c) => ({
        c,
        result: (evaluatorVersion === 2
          ? evaluateConversionV2
          : evaluateConversion)({
          ruleVersion,
          wallet: context,
          evidence: {
            kind: "solana_transfer",
            canonicalChainEventId: id(c),
            finality: "finalized",
            configuredEnvironment: z
              .enum(["demo", "devnet", "mainnet"])
              .parse(c.configured_environment),
            event: canonicalSolanaTransferSchema.parse(c.payload),
          },
          priorConversion: null,
        }),
      }))
      .find((v) => v.result.outcome === "match");
    if (!first || first.result.outcome !== "match") {
      exclusions.push({
        mappingId: id(m),
        reason: "no_retained_qualifying_transfer",
      });
      continue;
    }
    if (
      at(first.result.conversionTime) < at(s.measurementWindow.startedAt) ||
      at(first.result.conversionTime) >= at(s.measurementWindow.endedAt)
    ) {
      exclusions.push({
        mappingId: id(m),
        reason: "first_qualifying_transfer_outside_measurement",
      });
      continue;
    }
    // Deterministic placeholder is used only to run the pure selector. It is
    // never issued as a fact: exact retained IDs are required immediately below.
    const selectionInput = {
      ruleVersion,
      conversion: {
        ...first.result,
        id: id(m),
        workspaceId: s.workspaceId,
        projectId: s.projectId,
        walletAddress: context.walletAddress,
      },
      touches,
    };
    const selected =
      first.result.evaluatorVersion === 2
        ? evaluateLastTouchAttributionV2({
            ...selectionInput,
            conversion: { ...selectionInput.conversion, evaluatorVersion: 2 },
          })
        : evaluateLastTouchAttribution({
            ...selectionInput,
            conversion: { ...selectionInput.conversion, evaluatorVersion: 1 },
          });
    if (
      selected.outcome !== "attributed" ||
      selected.protectedWalletMappingId !== m.id
    ) {
      exclusions.push({
        mappingId: id(m),
        reason: "not_last_eligible_creator_touch",
      });
      continue;
    }
    const facts = conversions.filter(
      (c) =>
        c.rule_version_id === s.ruleVersionId &&
        c.protected_wallet_mapping_id === m.id,
    );
    requireEvidence(
      facts.length === 1,
      "Expected winning conversion has not been retained.",
    );
    const fact = facts[0]!;
    requireEvidence(
      first.result.value.kind !== "none",
      "Transfer value is unavailable.",
    );
    requireEvidence(
      fact.canonical_chain_event_id === first.c.id &&
        fact.campaign_id === s.campaignId &&
        at(fact.conversion_time) === at(first.result.conversionTime) &&
        fact.value_kind === first.result.value.kind &&
        fact.raw_amount === first.result.value.rawAmount &&
        fact.decimals === first.result.value.decimals &&
        fact.token_mint ===
          (first.result.value.kind === "token_base_units"
            ? first.result.value.tokenMint
            : null) &&
        fact.revenue_kind === "none" &&
        fact.evaluator_version === evaluatorVersion &&
        fact.outcome === "match" &&
        fact.reason === "matched",
      "Retained conversion disagrees with reconstructed first-event evidence.",
    );
    const source = s.results.find((r) => r.conversionFactId === fact.id);
    requireEvidence(
      source !== undefined,
      "Expected conversion lacks governed report provenance.",
    );
    const attribution = byId(attributions, source.attributionFactId);
    requireEvidence(
      attribution.protected_wallet_mapping_id === m.id &&
        attribution.conversion_fact_id === fact.id &&
        source.creatorId === selected.creatorId &&
        source.contentAssetId === selected.contentAssetId &&
        at(source.touchTime) === at(selected.touchTime),
      "Retained attribution disagrees with reconstructed last-touch evidence.",
    );
    expectedIds.push(id(fact));
  }
  requireEvidence(
    expectedIds.length === s.results.length &&
      s.results.every((r) => expectedIds.includes(r.conversionFactId)),
    "Report contains results outside the reconstructed retained universe.",
  );
  const walletWinners = new Map<string, string>();
  for (const result of [...s.results].sort((a, b) =>
    at(a.touchTime) === at(b.touchTime)
      ? a.attributionFactId > b.attributionFactId
        ? -1
        : 1
      : at(a.touchTime) > at(b.touchTime)
        ? -1
        : 1,
  )) {
    const fact = byId(conversions, result.conversionFactId);
    const address = text(
      byId(mappings, fact.protected_wallet_mapping_id),
      "wallet_address",
    );
    if (!walletWinners.has(address))
      walletWinners.set(address, result.attributionFactId);
  }
  requireEvidence(
    s.walletAttributionEvidenceIds.length === walletWinners.size &&
      s.walletAttributionEvidenceIds.every((v) =>
        [...walletWinners.values()].includes(v),
      ),
    "Report wallet counts disagree with retained unique-wallet evidence.",
  );
  const latestQualified: string[] = [];
  for (const click of clicks.filter(
    (c) =>
      c.campaign_id === s.campaignId &&
      at(c.requested_at) >= at(s.measurementWindow.startedAt) &&
      at(c.requested_at) < at(s.measurementWindow.endedAt),
  )) {
    const assessed = qualities
      .filter((q) => q.click_event_id === click.id)
      .sort((a, b) =>
        at(a.assessed_at) === at(b.assessed_at)
          ? id(a) > id(b)
            ? -1
            : 1
          : at(a.assessed_at) > at(b.assessed_at)
            ? -1
            : 1,
      );
    requireEvidence(
      assessed.length > 0,
      "Campaign click quality is unresolved.",
    );
    const q = assessed[0]!;
    requireEvidence(
      (q.outcome === "qualified" &&
        q.reason === "passed_declared_checks" &&
        q.canonical_click_event_id === click.id) ||
        (q.outcome === "duplicate" &&
          q.reason === "duplicate_within_window" &&
          typeof q.canonical_click_event_id === "string") ||
        (q.outcome === "rejected" &&
          ["declared_automated_agent", "raw_click_ineligible"].includes(
            String(q.reason),
          )),
      "Campaign click quality is unresolved.",
    );
    if (
      click.signature_valid === true &&
      click.eligibility === "eligible" &&
      q.outcome === "qualified" &&
      q.reason === "passed_declared_checks" &&
      q.canonical_click_event_id === click.id
    ) {
      requireEvidence(
        s.qualifiedClickEvidence.some(
          (v) =>
            v.clickId === click.id &&
            v.assessmentId === q.id &&
            v.qualityRuleVersionId === q.rule_version_id,
        ),
        "Qualified click evidence disagrees with latest assessment.",
      );
      latestQualified.push(id(click));
    }
  }
  requireEvidence(
    latestQualified.length === s.qualifiedClickEvidence.length,
    "Report qualified clicks exceed reconstructed evidence.",
  );
  return {
    sourceHash: bundle.sourceHash,
    sourceHashProtocol: bundle.protocol,
    checkedAt,
    coverageBasis: "retained_trusted_adapter_history" as const,
    mappingProofs,
    rawTransactionCount: raw.length,
    canonicalTransferCount: canonical.length,
    providerExhaustion: "not_independently_verified" as const,
    conversionEvaluation: "retained_universe_reconciled" as const,
    conversionFactIds: expectedIds,
    exclusions,
    issuance: "requires_separate_human_approval" as const,
  };
}
