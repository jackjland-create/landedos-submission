import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import fixture from "./fixtures/retained-report-reconciled.json";
import { inspectRetainedReportCoverage } from "./retained-coverage.server";

type Bundle = typeof fixture;
type Row = Record<string, unknown>;
const fresh = () => structuredClone(fixture);
const records = (b: Bundle, name: keyof Bundle["evidence"]) =>
  b.evidence[name] as unknown as Row[];
const requiredJob = (b: Bundle) =>
  b.evidence.solana_reconciliation_jobs.find(
    (j) =>
      j.id ===
      b.evidence.executionReview.reportReview.historyReadiness.mappings[0]!
        .matchingJob.id,
  )!;
const page = (b: Bundle) =>
  b.evidence.solana_reconciliation_job_events.find(
    (p) => p.job_id === requiredJob(b).id && p.kind === "page_completed",
  )!;

// Synthetic-only exact Devnet successor. No real wallet/provider evidence.
function exactDevnetFixture() {
  const b = JSON.parse(
    JSON.stringify(fresh())
      .replaceAll('"demo"', '"devnet"')
      .replaceAll(
        "2026-09-18T13:00:00+00:00",
        "2026-09-18T13:00:00.123456+00:00",
      ),
  ) as Bundle;
  const walk = (v: unknown): void => {
    if (!v || typeof v !== "object") return;
    if (Array.isArray(v)) {
      v.forEach(walk);
      return;
    }
    const row = v as Row;
    for (const [key, value] of Object.entries(row)) {
      if (
        [
          "nativeAmountLamports",
          "native_amount_lamports",
          "rawAmount",
          "raw_amount",
        ].includes(key) &&
        value === "1000000"
      )
        row[key] = "1";
      else if (key === "amount" && value === 1000000) row[key] = 1;
      else if (
        ["evaluator_version", "attribution_evaluator_version"].includes(key)
      )
        row[key] = 2;
      else walk(value);
    }
    if (row.templateCode === "first_qualifying_transaction")
      Object.assign(row, {
        configuredEnvironment: "devnet",
        destinationAddress: "Vote111111111111111111111111111111111111111",
        nativeAmountLamports: "1",
      });
    if (row.template_code === "first_qualifying_transaction")
      Object.assign(row, {
        configured_environment: "devnet",
        destination_address: "Vote111111111111111111111111111111111111111",
        native_amount_lamports: 1,
      });
  };
  walk(b);
  for (const delivery of records(b, "raw_chain_event_deliveries")) {
    delivery.raw_body = JSON.stringify(delivery.raw_payload);
    delivery.payload_sha256 = createHash("sha256")
      .update(delivery.raw_body as string)
      .digest("hex");
  }
  return b;
}

describe("private retained report source reconciliation", () => {
  it("reconstructs destination-bound V2 with actual-style microsecond consent", () => {
    const proof = inspectRetainedReportCoverage(exactDevnetFixture());
    expect(proof.conversionEvaluation).toBe("retained_universe_reconciled");
    expect(proof.issuance).toBe("requires_separate_human_approval");
  });
  it("resolves omitted snapshot destination fields only through the immutable bound rule", () => {
    const b = exactDevnetFixture();
    const rule = b.evidence.executionReview.reportReview.reportSources
      .commercialPlanSnapshot.strategyBinding.conversionRule as unknown as Row;
    for (const key of [
      "configuredEnvironment",
      "destinationAddress",
      "nativeAmountLamports",
    ])
      delete rule[key];
    expect(inspectRetainedReportCoverage(b).conversionEvaluation).toBe(
      "retained_universe_reconciled",
    );
    records(b, "conversion_rule_versions")[0]!.name = "Changed rule";
    expect(() => inspectRetainedReportCoverage(b)).toThrow("immutable rule");
  });
  it("rejects a contradictory destination in the bound commercial snapshot", () => {
    const b = exactDevnetFixture();
    const rule = b.evidence.executionReview.reportReview.reportSources
      .commercialPlanSnapshot.strategyBinding.conversionRule as unknown as Row;
    rule.destinationAddress = "11111111111111111111111111111111";
    expect(() => inspectRetainedReportCoverage(b)).toThrow("immutable rule");
  });
  it("does not let unrelated historical V1 facts choose this campaign's evaluator", () => {
    const b = exactDevnetFixture();
    for (const key of ["conversion_facts", "attribution_facts"] as const) {
      const old = structuredClone(records(b, key)[0]!);
      old.id =
        key === "conversion_facts"
          ? "10000000-0000-4000-8000-000000000091"
          : "10000000-0000-4000-8000-000000000092";
      old.campaign_id = "10000000-0000-4000-8000-000000000093";
      old.rule_version_id = "10000000-0000-4000-8000-000000000094";
      old[
        key === "conversion_facts"
          ? "evaluator_version"
          : "attribution_evaluator_version"
      ] = 1;
      records(b, key).push(old);
    }
    expect(inspectRetainedReportCoverage(b).conversionEvaluation).toBe(
      "retained_universe_reconciled",
    );
  });
  it.each([1, 3])(
    "rejects mixed or unknown retained versions %s",
    (version) => {
      const b = exactDevnetFixture();
      records(b, "attribution_facts")[0]!.attribution_evaluator_version =
        version;
      expect(() => inspectRetainedReportCoverage(b)).toThrow(
        "evaluator versions",
      );
    },
  );
  it("does not reinterpret historical V1 fractional evidence", () => {
    const b = fresh();
    // All exact historical references agree; only V1 evaluator precision fails.
    const changed = JSON.parse(
      JSON.stringify(b).replaceAll(
        "2026-09-18T13:00:00+00:00",
        "2026-09-18T13:00:00.123456+00:00",
      ),
    );
    expect(() => inspectRetainedReportCoverage(changed)).toThrow("precision");
  });
  it("reconstructs synthetic retained history without claiming provider exhaustion or issuance", () => {
    const proof = inspectRetainedReportCoverage(fixture);
    expect(proof.mappingProofs).toHaveLength(2);
    expect(proof.conversionEvaluation).toBe("retained_universe_reconciled");
    expect(proof.issuance).toBe("requires_separate_human_approval");
    expect(proof.providerExhaustion).toBe("not_independently_verified");
  });
  it("preserves observed checkedAt microseconds instead of rounding freshness", () => {
    const b = fresh();
    b.checkedAt = "2026-09-21T19:00:00.123456+00:00";
    expect(inspectRetainedReportCoverage(b).checkedAt).toBe(b.checkedAt);
  });
  it.each([
    "protected_wallet_mappings",
    "raw_chain_events",
    "canonical_chain_events",
    "solana_finality_observations",
    "canonical_chain_event_sources",
    "conversion_facts",
    "attribution_facts",
    "wallet_session_proofs",
    "wallet_measurement_consents",
    "anonymous_session_clicks",
  ] as const)("rejects missing %s evidence", (name) => {
    const b = fresh();
    records(b, name).splice(0, 1);
    expect(() => inspectRetainedReportCoverage(b)).toThrow();
  });
  it("rejects an omitted required history diagnostic", () => {
    const b = fresh();
    b.evidence.executionReview.reportReview.historyReadiness.mappings.pop();
    expect(() => inspectRetainedReportCoverage(b)).toThrow();
  });
  it("rejects a missing required history page", () => {
    const b = fresh();
    b.evidence.solana_reconciliation_job_events =
      b.evidence.solana_reconciliation_job_events.filter((p) => p !== page(b));
    expect(() => inspectRetainedReportCoverage(b)).toThrow();
  });
  it.each(["workspace_id", "project_id"])(
    "rejects foreign retained %s",
    (field) => {
      const b = fresh();
      records(b, "raw_chain_events")[0]![field] =
        "ffffffff-ffff-4fff-8fff-ffffffffffff";
      expect(() => inspectRetainedReportCoverage(b)).toThrow("scope");
    },
  );
  it.each(["active_from", "monitoring_ends_at", "unlinked_at"])(
    "rejects changed consent mapping %s",
    (field) => {
      const b = fresh();
      records(b, "protected_wallet_mappings")[0]![field] =
        "2026-09-19T00:00:00+00:00";
      expect(() => inspectRetainedReportCoverage(b)).toThrow();
    },
  );
  it("rejects consent expiry disagreement even after the report ends", () => {
    const b = fresh();
    b.evidence.wallet_measurement_consents[0]!.monitoring_ends_at =
      "2026-09-26T12:00:00+00:00";
    expect(() => inspectRetainedReportCoverage(b)).toThrow("consent");
  });
  it("rejects a pending in-window click with no quality assessment", () => {
    const b = fresh();
    b.evidence.click_events.push({
      ...b.evidence.click_events[0]!,
      id: "ffffffff-ffff-4fff-8fff-ffffffffffff",
      requested_at: "2026-09-20T15:00:00+00:00",
    });
    expect(() => inspectRetainedReportCoverage(b)).toThrow(
      "quality is unresolved",
    );
  });
  it("rejects an unresolved assessment state instead of silently treating it as an exclusion", () => {
    const b = fresh();
    const clickId = "ffffffff-ffff-4fff-8fff-ffffffffffff";
    b.evidence.click_events.push({
      ...b.evidence.click_events[0]!,
      id: clickId,
      requested_at: "2026-09-20T15:00:00+00:00",
    });
    b.evidence.click_quality_assessments.push({
      ...b.evidence.click_quality_assessments[0]!,
      id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee",
      click_event_id: clickId,
      canonical_click_event_id: clickId,
      assessed_at: "2026-09-20T15:00:01+00:00",
      outcome: "pending",
      reason: "awaiting_assessment",
    });
    expect(() => inspectRetainedReportCoverage(b)).toThrow();
  });
  it("rejects report evidence missing the expected winning result", () => {
    const b = fresh();
    const s = b.evidence.executionReview.reportReview.reportSources;
    s.results = [];
    s.walletAttributionEvidenceIds = [];
    expect(() => inspectRetainedReportCoverage(b)).toThrow();
  });
  it.each([
    "raw_event_count",
    "canonical_event_count",
    "duplicate_event_count",
    "normalization_issue_count",
    "page_count",
  ] as const)("rejects altered job counter %s", (counter) => {
    const b = fresh();
    requiredJob(b)[counter] += 1;
    expect(() => inspectRetainedReportCoverage(b)).toThrow();
  });
  it.each(["cursor_before", "cursor_after"])(
    "rejects terminal page %s drift",
    (key) => {
      const b = fresh();
      (page(b) as unknown as Row)[key] = "unexpected-cursor";
      expect(() => inspectRetainedReportCoverage(b)).toThrow("continuity");
    },
  );
  it("rejects skipped page numbering", () => {
    const b = fresh();
    page(b).page_number = 2;
    expect(() => inspectRetainedReportCoverage(b)).toThrow("continuity");
  });
  it.each(["queued", "completed"])(
    "rejects missing %s lifecycle evidence",
    (kind) => {
      const b = fresh();
      b.evidence.solana_reconciliation_job_events =
        b.evidence.solana_reconciliation_job_events.filter(
          (e) => !(e.job_id === requiredJob(b).id && e.kind === kind),
        );
      expect(() => inspectRetainedReportCoverage(b)).toThrow();
    },
  );
  it("rejects a retained failure event despite a completed job label", () => {
    const b = fresh();
    b.evidence.solana_reconciliation_job_events.push({
      ...page(b),
      id: "ffffffff-ffff-4fff-8fff-ffffffffffff",
      kind: "failed",
    });
    expect(() => inspectRetainedReportCoverage(b)).toThrow("lifecycle");
  });
  it.each(["started_at", "completed_at"] as const)(
    "rejects inconsistent %s lifecycle time",
    (key) => {
      const b = fresh();
      requiredJob(b)[key] = "2026-09-01T00:00:00+00:00";
      expect(() => inspectRetainedReportCoverage(b)).toThrow();
    },
  );
  it("rejects finality RPC slot mismatch", () => {
    const b = fresh();
    b.evidence.solana_finality_observations[0]!.rpc_response.result.value[0]!.slot += 1;
    expect(() => inspectRetainedReportCoverage(b)).toThrow("Finality response");
  });
  it("rejects non-finalized observation", () => {
    const b = fresh();
    b.evidence.solana_finality_observations[0]!.confirmation_status =
      "confirmed";
    expect(() => inspectRetainedReportCoverage(b)).toThrow("finality");
  });
  it("rejects raw delivery body/hash disagreement", () => {
    const b = fresh();
    b.evidence.raw_chain_event_deliveries[0]!.raw_body = "[]";
    expect(() => inspectRetainedReportCoverage(b)).toThrow("delivery payload");
  });
  it("rejects earlier retained event time even when delivery payloads and canonical event agree", () => {
    const b = fresh();
    const c = b.evidence.canonical_chain_events[0]!;
    const earlier = "2026-09-19T12:00:00+00:00";
    c.event_time = earlier;
    c.payload.eventTime = earlier;
    for (const r of b.evidence.raw_chain_events.filter(
      (r) => r.transaction_signature === c.transaction_signature,
    )) {
      r.raw_payload.timestamp = Date.parse(earlier) / 1000;
      r.provider_timestamp = String(r.raw_payload.timestamp);
      const d = b.evidence.raw_chain_event_deliveries.find(
        (d) => d.id === r.delivery_id,
      )!;
      d.raw_payload[r.provider_event_index]!.timestamp =
        r.raw_payload.timestamp;
      d.raw_body = JSON.stringify(d.raw_payload);
      d.payload_sha256 = createHash("sha256").update(d.raw_body).digest("hex");
    }
    expect(() => inspectRetainedReportCoverage(b)).toThrow(
      "reconstructed first-event",
    );
  });
  it("fails closed on ambiguous multiple data pages", () => {
    const b = fresh();
    const p = page(b);
    const j = requiredJob(b);
    const link = b.evidence.solana_reconciliation_job_deliveries.find(
      (l) => l.job_id === j.id,
    )!;
    const delivery = b.evidence.raw_chain_event_deliveries.find(
      (d) => d.id === link.delivery_id,
    )!;
    const source = b.evidence.raw_chain_events.find(
      (r) => r.delivery_id === delivery.id,
    )!;
    const uuid = (n: number) =>
      `eeeeeeee-eeee-4eee-8eee-${n.toString().padStart(12, "0")}`;
    // Construct 99 valid zero-transfer transactions on the first retained page.
    // They need no canonical/finality rows, but remain payload/hash/count bound.
    for (let n = 1; n <= 99; n++) {
      const transaction = {
        ...structuredClone(source.raw_payload),
        nativeTransfers: [],
        tokenTransfers: [],
        signature: `${source.transaction_signature.slice(0, -2)}${"123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"[Math.floor(n / 58)]}${"123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz"[n % 58]}`,
      };
      delivery.raw_payload.push(transaction);
      b.evidence.raw_chain_events.push({
        ...structuredClone(source),
        id: uuid(n),
        provider_event_index: n,
        raw_payload: transaction,
        transaction_signature: transaction.signature,
      });
    }
    delivery.event_count = 100;
    delivery.raw_body = JSON.stringify(delivery.raw_payload);
    delivery.payload_sha256 = createHash("sha256")
      .update(delivery.raw_body)
      .digest("hex");
    const cursor = delivery.raw_payload.at(-1)!.signature;
    (p as unknown as Row).cursor_after = cursor;
    p.raw_event_count = 100;
    const secondPayload = {
      ...structuredClone(source.raw_payload),
      nativeTransfers: [],
      tokenTransfers: [],
      signature: "3".repeat(88),
    };
    const secondBody = JSON.stringify([secondPayload]);
    b.evidence.raw_chain_event_deliveries.push({
      ...delivery,
      id: uuid(100),
      event_count: 1,
      raw_payload: [secondPayload],
      raw_body: secondBody,
      payload_sha256: createHash("sha256").update(secondBody).digest("hex"),
    });
    b.evidence.raw_chain_events.push({
      ...source,
      id: uuid(101),
      delivery_id: uuid(100),
      provider_event_index: 0,
      raw_payload: secondPayload,
      transaction_signature: secondPayload.signature,
    });
    b.evidence.solana_reconciliation_job_deliveries.push({
      ...link,
      delivery_id: uuid(100),
    });
    b.evidence.solana_reconciliation_job_events.push({
      ...p,
      id: "ffffffff-ffff-4fff-8fff-ffffffffffff",
      page_number: 2,
      cursor_before: cursor as unknown as null,
      cursor_after: null,
      raw_event_count: 1,
      canonical_event_count: 0,
      duplicate_event_count: 0,
    });
    j.page_count = 2;
    j.raw_event_count = 101;
    expect(() => inspectRetainedReportCoverage(b)).toThrow(
      "Multi-page delivery ownership",
    );
  });
});
