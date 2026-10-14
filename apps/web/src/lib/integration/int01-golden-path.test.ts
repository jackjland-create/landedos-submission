import { createSignInMessage } from "@solana/wallet-standard-util";
import { createClient } from "@supabase/supabase-js";
import { webcrypto } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import {
  computeCampaignMetrics,
  type MetricSnapshotInput,
} from "@landed/analytics";
import {
  trackedClickQueryParameter,
  walletMeasurementConsentResponseSchema,
  walletNonceChallengeResponseSchema,
  walletSignatureProofResponseSchema,
} from "@landed/contracts";
import {
  getProjectBasket,
  getProjectConversionRule,
  getProjectReport,
  getProjectReportEvidence,
} from "@landed/db";
import { canonicalSolanaTransferSchema } from "@landed/solana";

import { POST as acceptWalletConsent } from "@/app/api/wallet/consents/route";
import { POST as issueWalletChallenge } from "@/app/api/wallet/challenges/route";
import { POST as recordWalletProof } from "@/app/api/wallet/proofs/route";
import { POST as receiveHeliusWebhook } from "@/app/api/integrations/helius/route";
import { GET as followTrackedLink } from "@/app/t/[linkId]/route";
import { inngest } from "@/inngest/client";
import { processLiveRawChainEvent } from "@/inngest/process-live-solana";
import { evaluateAndRecordStrongAttribution } from "@/lib/attribution/processing.server";
import { issueVersionedCampaignReport } from "@/lib/reports/issuance.server";
import {
  parseTrackedLinkKeyring,
  signTrackedLinkPayload,
} from "@/lib/tracking/signing.server";
import { anonymousSessionCookieName } from "@/lib/tracking/session.server";

// The exact destination-bound wallet handoff has its own connected SQL and
// route contract suites. INT-01 composes the remaining legacy report journey
// through the real challenge writer without weakening the production gate.
vi.mock("@/lib/wallet/measurement-context.server", () => ({
  readWalletMeasurementRuleContext: vi.fn(async () => ({
    ruleVersionId: "f1800000-0000-4000-8000-000000000001",
    chainId: "solana:devnet",
    receiverAddress: "Vote111111111111111111111111111111111111111",
    nativeAmountLamports: "1",
  })),
}));

const ids = {
  workspace: "10000000-0000-4000-8000-000000000001",
  project: "20000000-0000-4000-8000-000000000001",
  manager: "f1000000-0000-4000-8000-000000000001",
  basket: "f1100000-0000-4000-8000-000000000001",
  ruleVersion: "f1800000-0000-4000-8000-000000000001",
  report: "f2100000-0000-4000-8000-000000000001",
} as const;

const managerEmail = "int01-manager@example.test";
const managerPassword = "int01-golden-password";
const applicationOrigin = "https://int01.example.test";
const heliusIntegrationId = "f3300000-0000-4000-8000-000000000001";
const heliusAuthorization = "Bearer int01-sanitized-provider-proof";
const base58Alphabet =
  "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

const commercialTermsSchema = z.object({
  compensationLines: z.array(
    z.object({
      id: z.uuid(),
      assetType: z.literal("cash"),
      model: z.literal("fixed"),
      amountMinor: z.string().regex(/^\d+$/),
      currencyCode: z.string().length(3),
    }),
  ),
});

function encodeBase58(input: Uint8Array) {
  const digits = [0];
  for (const byte of input) {
    let carry = byte;
    for (let index = 0; index < digits.length; index += 1) {
      carry += digits[index]! << 8;
      digits[index] = carry % 58;
      carry = Math.floor(carry / 58);
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = Math.floor(carry / 58);
    }
  }
  for (
    let index = 0;
    input[index] === 0 && index < input.length - 1;
    index += 1
  ) {
    digits.push(0);
  }
  return digits
    .reverse()
    .map((digit) => base58Alphabet[digit])
    .join("");
}

async function createEphemeralWallet() {
  const keys = (await webcrypto.subtle.generateKey({ name: "Ed25519" }, true, [
    "sign",
    "verify",
  ])) as unknown as CryptoKeyPair;
  const publicKey = new Uint8Array(
    await webcrypto.subtle.exportKey("raw", keys.publicKey),
  );

  return {
    address: encodeBase58(publicKey),
    async sign(challenge: z.infer<typeof walletNonceChallengeResponseSchema>) {
      const signedMessage = createSignInMessage(challenge.signInInput);
      const signature = new Uint8Array(
        await webcrypto.subtle.sign(
          "Ed25519",
          keys.privateKey,
          Uint8Array.from(signedMessage).buffer,
        ),
      );
      return {
        challengeId: challenge.challengeId,
        signInInput: challenge.signInInput,
        signInOutput: {
          accountAddress: challenge.signInInput.address,
          accountPublicKey: Buffer.from(publicKey).toString("base64"),
          signature: Buffer.from(signature).toString("base64"),
          signatureType: "ed25519" as const,
          signedMessage: Buffer.from(signedMessage).toString("base64"),
        },
      };
    },
  };
}

function cookieValue(response: Response, name: string) {
  const value = response.headers
    .get("set-cookie")
    ?.match(new RegExp(`(?:^|,\\s*)${name}=([^;]+)`))?.[1];
  if (!value) throw new Error(`The ${name} cookie was not returned.`);
  return value;
}

function jsonRequest(path: string, body: unknown, sessionId: string) {
  return new Request(`${applicationOrigin}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: `${anonymousSessionCookieName}=${sessionId}`,
      Origin: applicationOrigin,
    },
    body: JSON.stringify(body),
  });
}

const integrationEnabled = process.env.INT01_INTEGRATION === "1";

describe.skipIf(!integrationEnabled)("INT-01 application golden path", () => {
  it("creates report V2 through the real application orchestration chain", async () => {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !publishableKey || !serviceKey) {
      throw new Error("INT-01 local Supabase credentials are missing.");
    }

    process.env.NEXT_PUBLIC_APP_URL = applicationOrigin;
    process.env.HELIUS_WEBHOOK_INTEGRATION_ID = heliusIntegrationId;
    process.env.HELIUS_WEBHOOK_AUTHORIZATION = heliusAuthorization;
    process.env.HELIUS_WEBHOOK_CREDENTIAL_VERSION = "int01-sanitized-v1";
    process.env.SOLANA_FINALITY_RPC_URL = "https://rpc.int01.example.test";

    const service = createClient(url, serviceKey, {
      auth: {
        autoRefreshToken: false,
        detectSessionInUrl: false,
        persistSession: false,
      },
    });
    const manager = createClient(url, publishableKey, {
      auth: {
        autoRefreshToken: false,
        detectSessionInUrl: false,
        persistSession: false,
      },
    });
    const signedIn = await manager.auth.signInWithPassword({
      email: managerEmail,
      password: managerPassword,
    });
    expect(signedIn.error).toBeNull();
    expect(signedIn.data.user?.id).toBe(ids.manager);

    // DEM-01: a readable basket row is not enough. Exercise the same strict
    // application reader as the page before claiming the deep link is ready.
    const basket = await getProjectBasket(manager, ids.project, ids.basket);
    expect(basket?.name).toBe("INT-01 Golden Campaign");
    expect(basket?.scenarios.map(({ code }) => code).sort()).toEqual([
      "A",
      "B",
      "C",
    ]);
    expect(
      basket?.scenarios
        .filter(({ code }) => code !== "A")
        .every(({ packageIds }) => packageIds.length === 0),
    ).toBe(true);
    expect(basket?.latestApproval).not.toBeNull();
    expect(basket?.latestApprovalIsCurrent).toBe(true);

    const initialReport = await getProjectReport(
      manager,
      ids.project,
      ids.report,
    );
    expect(initialReport?.versions.map(({ version }) => version)).toEqual([1]);
    const initialVersion = initialReport?.versions[0];
    if (!initialVersion)
      throw new Error("The INT-01 baseline report is missing.");

    const linkResult = await manager
      .from("tracked_links")
      .select(
        "id, campaign_id, creator_id, content_asset_id, expires_at, key_version",
      )
      .eq("generation_request_id", "f2600000-0000-4000-8000-000000000001")
      .single();
    expect(linkResult.error).toBeNull();
    const link = linkResult.data!;
    const signingKey = Buffer.alloc(32, 7).toString("base64url");
    process.env.TRACKING_SIGNING_ACTIVE_KEY_VERSION = String(link.key_version);
    process.env.TRACKING_SIGNING_KEYS_JSON = JSON.stringify({
      [String(link.key_version)]: signingKey,
    });
    const keyring = parseTrackedLinkKeyring({
      activeKeyVersion: String(link.key_version),
      keysJson: process.env.TRACKING_SIGNING_KEYS_JSON,
    });
    const linkPayload = {
      schemaVersion: 1 as const,
      linkId: link.id,
      campaignId: link.campaign_id,
      creatorId: link.creator_id,
      contentAssetId: link.content_asset_id,
      expiresAt: new Date(link.expires_at).toISOString(),
      keyVersion: link.key_version,
    };
    const signature = await signTrackedLinkPayload(linkPayload, keyring);
    const redirect = await followTrackedLink(
      new Request(`${applicationOrigin}/t/${link.id}?signature=${signature}`, {
        headers: { "User-Agent": "INT-01 browser journey" },
      }),
      { params: Promise.resolve({ linkId: link.id }) },
    );
    expect(redirect.status).toBe(307);
    const destination = new URL(redirect.headers.get("location")!);
    const clickId = z
      .uuid()
      .parse(destination.searchParams.get(trackedClickQueryParameter));
    const sessionId = z
      .uuid()
      .parse(cookieValue(redirect, anonymousSessionCookieName));

    const wallet = await createEphemeralWallet();
    const challengeResponse = await issueWalletChallenge(
      jsonRequest(
        "/api/wallet/challenges",
        { walletAddress: wallet.address },
        sessionId,
      ),
    );
    expect(challengeResponse.status).toBe(201);
    const challenge = walletNonceChallengeResponseSchema.parse(
      await challengeResponse.json(),
    );
    const proofResponse = await recordWalletProof(
      jsonRequest(
        "/api/wallet/proofs",
        await wallet.sign(challenge),
        sessionId,
      ),
    );
    expect(proofResponse.status).toBe(201);
    const proof = walletSignatureProofResponseSchema.parse(
      await proofResponse.json(),
    );

    const send = vi.spyOn(inngest, "send").mockResolvedValue({ ids: [] });
    const consentResponse = await acceptWalletConsent(
      jsonRequest(
        "/api/wallet/consents",
        { accepted: true, consentVersion: 1, proofId: proof.proofId },
        sessionId,
      ),
    );
    expect(consentResponse.status).toBe(201);
    const consent = walletMeasurementConsentResponseSchema.parse(
      await consentResponse.json(),
    );
    const consentAcceptedAt = new Date(consent.acceptedAt).toISOString();
    const consentMonitoringEndsAt = new Date(
      consent.monitoringEndsAt,
    ).toISOString();

    const eventEpoch = Math.ceil(Date.parse(consentAcceptedAt) / 1_000) + 1;
    const waitMilliseconds = eventEpoch * 1_000 - Date.now();
    if (waitMilliseconds > 0) {
      await new Promise((resolve) => setTimeout(resolve, waitMilliseconds));
    }
    const transactionSignature = encodeBase58(
      webcrypto.getRandomValues(new Uint8Array(64)),
    );
    const transactionSlot = 358_050_002;
    const rawBody = JSON.stringify([
      {
        accountData: [],
        description: "Synthetic INT-01 application-orchestrated transfer",
        events: {},
        fee: 5000,
        feePayer: wallet.address,
        nativeTransfers: [
          {
            amount: 1,
            fromUserAccount: wallet.address,
            toUserAccount: "11111111111111111111111111111111",
          },
        ],
        signature: transactionSignature,
        slot: transactionSlot,
        source: "SYSTEM_PROGRAM",
        timestamp: eventEpoch,
        tokenTransfers: [],
        transactionError: null,
        type: "TRANSFER",
      },
    ]);
    const webhookResponse = await receiveHeliusWebhook(
      new Request(`${applicationOrigin}/api/integrations/helius`, {
        method: "POST",
        headers: {
          Authorization: heliusAuthorization,
          "Content-Length": String(Buffer.byteLength(rawBody)),
          "Content-Type": "application/json",
        },
        body: rawBody,
      }),
    );
    expect(webhookResponse.status).toBe(200);
    const dispatchedEvents = send.mock.calls.flatMap(([input]) =>
      Array.isArray(input) ? input : [input],
    );
    const rawDispatch = dispatchedEvents.find(
      (event) => event.name === "landed/solana.raw-event.received",
    );
    const rawChainEventId = z.uuid().parse(rawDispatch?.data.rawChainEventId);

    const originalFetch = globalThis.fetch;
    const fetchFinality = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation((input, init) => {
        const requestUrl =
          typeof input === "string"
            ? input
            : input instanceof URL
              ? input.href
              : input.url;
        if (requestUrl !== process.env.SOLANA_FINALITY_RPC_URL) {
          return originalFetch.call(globalThis, input, init);
        }

        return Promise.resolve(
          new Response(
            JSON.stringify({
              id: "landed-finality",
              jsonrpc: "2.0",
              result: {
                context: { slot: transactionSlot },
                value: [
                  {
                    confirmationStatus: "finalized",
                    confirmations: null,
                    err: null,
                    slot: transactionSlot,
                    status: { Ok: null },
                  },
                ],
              },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          ),
        );
      });
    const processing = await processLiveRawChainEvent(rawChainEventId);
    fetchFinality.mockRestore();
    expect(processing).toMatchObject({ insertedCount: 1, issueCount: 0 });
    const canonicalEventId = z.uuid().parse(processing.canonicalEventIds[0]);

    const canonicalResult = await manager
      .from("canonical_chain_events")
      .select("payload, event_time, finality")
      .eq("id", canonicalEventId)
      .single();
    expect(canonicalResult.error).toBeNull();
    const canonical = canonicalSolanaTransferSchema.parse(
      canonicalResult.data!.payload,
    );
    expect(canonical).toMatchObject({
      fromAddress: wallet.address,
      transactionSignature,
      slot: String(transactionSlot),
    });

    const clickResult = await manager
      .from("click_events")
      .select("requested_at, eligibility")
      .eq("id", clickId)
      .single();
    const qualityResult = await manager
      .from("click_quality_assessments")
      .select("id, outcome, reason")
      .eq("click_event_id", clickId)
      .single();
    expect(clickResult.error).toBeNull();
    expect(qualityResult.error).toBeNull();
    const touchTime = new Date(clickResult.data!.requested_at).toISOString();
    const rule = await getProjectConversionRule(manager, ids.project);
    const ruleVersion = rule?.versions.find(
      (version) => version.id === ids.ruleVersion,
    );
    expect(ruleVersion).toBeDefined();

    const conversionFactId = crypto.randomUUID();
    const attributionFactId = crypto.randomUUID();
    const facts = await evaluateAndRecordStrongAttribution(service, {
      attributionFactId,
      calculationRequestId: crypto.randomUUID(),
      conversionFactId,
      conversion: {
        ruleVersion: ruleVersion!,
        wallet: {
          activeFrom: consentAcceptedAt,
          anonymousSessionId: sessionId,
          monitoringEndsAt: consentMonitoringEndsAt,
          projectId: ids.project,
          protectedWalletMappingId: consent.mappingId,
          unlinkedAt: null,
          walletAddress: wallet.address,
          workspaceId: ids.workspace,
        },
        evidence: {
          canonicalChainEventId: canonicalEventId,
          event: canonical,
          finality: "finalized",
          kind: "solana_transfer",
        },
        priorConversion: null,
      },
      touches: [
        {
          anonymousSessionId: sessionId,
          campaignId: link.campaign_id,
          clickEventId: clickId,
          clickQualityAssessmentId: qualityResult.data!.id,
          clickQualityOutcome: qualityResult.data!.outcome,
          clickQualityReason: qualityResult.data!.reason,
          contentAssetId: link.content_asset_id,
          creatorId: link.creator_id,
          id: consent.mappingId,
          linkEligibility: clickResult.data!.eligibility,
          mappingActiveFrom: consentAcceptedAt,
          mappingMonitoringEndsAt: consentMonitoringEndsAt,
          mappingUnlinkedAt: null,
          measurementConsentId: consent.consentId,
          projectId: ids.project,
          protectedWalletMappingId: consent.mappingId,
          sessionClickKind: "originating",
          sessionExpiresAt: consentMonitoringEndsAt,
          touchTime,
          trackedLinkId: link.id,
          walletAddress: wallet.address,
          walletProofId: proof.proofId,
          workspaceId: ids.workspace,
        },
      ],
    });
    expect(facts.retained.inserted).toBe(true);
    expect(facts.confidence).toMatchObject({
      confidence: "strong",
      primaryRoasEligible: true,
    });

    const rosterResult = await manager
      .from("campaign_creators")
      .select("commercial_terms")
      .eq("campaign_id", link.campaign_id)
      .single();
    expect(rosterResult.error).toBeNull();
    const commercial = commercialTermsSchema.parse(
      rosterResult.data!.commercial_terms,
    ).compensationLines[0]!;
    const calculatedAt = new Date().toISOString();
    const metricSnapshotId = crypto.randomUUID();
    const metricInput: MetricSnapshotInput = {
      activationDefinition: {
        label: "First qualifying transaction",
        ruleVersionId: ids.ruleVersion,
      },
      activatedWallets: {
        status: "complete",
        evidenceIds: [attributionFactId],
      },
      attributionClassifierVersion: 1,
      campaignId: link.campaign_id,
      conversionRuleVersionIds: [ids.ruleVersion],
      currencyCode: commercial.currencyCode,
      dataFreshness: {
        calculatedAt,
        dataThrough: canonical.eventTime,
      },
      id: metricSnapshotId,
      projectId: ids.project,
      protocolRevenue: {
        status: "not_available",
        reason: "source_not_configured",
      },
      qualifiedClicks: { status: "complete", evidenceIds: [clickId] },
      qualifiedWallets: {
        status: "complete",
        evidenceIds: [attributionFactId],
      },
      sourceTimeRange: { startedAt: touchTime, endedAt: calculatedAt },
      spend: {
        status: "complete",
        lines: [
          {
            amountMinor: commercial.amountMinor,
            exclusionReason: null,
            id: commercial.id,
            inclusion: "included",
            kind: "creator_compensation",
            sourceEvidenceId: commercial.id,
          },
        ],
      },
      valuationPolicy:
        initialVersion.metricSnapshot.metrics.cpc.valuationPolicy,
      workspaceId: ids.workspace,
    };
    const expectedSnapshot = computeCampaignMetrics(metricInput);
    const reportVersionId = crypto.randomUUID();
    const issueRequestId = crypto.randomUUID();
    const issued = await issueVersionedCampaignReport(
      service,
      { getUser: () => manager.auth.getUser() },
      {
        campaignId: link.campaign_id,
        issueRequestId,
        metricSnapshotId,
        projectId: ids.project,
        reportId: ids.report,
        reportVersionId,
        requestedBy: ids.manager,
      },
      metricInput,
    );
    expect(issued).toMatchObject({
      inserted: true,
      metricSnapshotId,
      reportId: ids.report,
      reportVersionId,
      version: 2,
    });

    const completedReport = await getProjectReport(
      manager,
      ids.project,
      ids.report,
    );
    const completedVersion = completedReport?.versions.find(
      (version) => version.id === reportVersionId,
    );
    expect(completedVersion?.metricSnapshot).toEqual(expectedSnapshot);
    const evidence = await getProjectReportEvidence(
      manager,
      ids.project,
      reportVersionId,
      "activated_wallets",
    );
    expect(evidence).toEqual([
      expect.objectContaining({
        attributionFactId,
        canonicalChainEventId: canonicalEventId,
        clickEventId: clickId,
        confidence: "strong",
        conversionFactId,
        transactionSignature,
        walletProofState: "signed_nonce_and_consent",
      }),
    ]);

    const retried = await issueVersionedCampaignReport(
      service,
      { getUser: () => manager.auth.getUser() },
      {
        campaignId: link.campaign_id,
        issueRequestId,
        metricSnapshotId,
        projectId: ids.project,
        reportId: ids.report,
        reportVersionId,
        requestedBy: ids.manager,
      },
      metricInput,
    );
    expect(retried).toEqual({ ...issued, inserted: false });
    send.mockRestore();
  }, 45_000);
});
