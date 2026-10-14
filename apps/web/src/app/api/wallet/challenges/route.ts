import { walletNonceChallengeRequestSchema } from "@landed/contracts";
import { NextResponse } from "next/server";
import { z } from "zod";

import { logError } from "@/lib/observability";
import {
  createAdminClient,
  SupabaseServerConfigError,
} from "@/lib/supabase/server";
import { readAnonymousSessionId } from "@/lib/tracking/session.server";
import {
  buildWalletNonceChallengeResponse,
  createWalletChallengeNonce,
  getWalletChallengeApplicationOrigin,
  hashWalletChallengeNonce,
  requestMatchesWalletChallengeOrigin,
  WalletChallengeConfigError,
  walletNonceChallengeMaxAgeSeconds,
  walletNonceChallengeStatement,
} from "@/lib/wallet/challenge.server";
import { readWalletMeasurementRuleContext } from "@/lib/wallet/measurement-context.server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const challengeResultSchema = z
  .array(
    z.object({
      challenge_id: z.uuid(),
      eligibility: z.enum(["issued", "session_not_eligible", "rate_limited"]),
      wallet_address: z.string().nullable(),
      domain: z.string().nullable(),
      uri: z.string().nullable(),
      statement: z.string().nullable(),
      chain_id: z.string().nullable(),
      issued_at: z.iso.datetime({ offset: true }),
      expires_at: z.iso.datetime({ offset: true }).nullable(),
    }),
  )
  .length(1);

const privateHeaders = {
  "Cache-Control": "private, no-store, max-age=0",
  Pragma: "no-cache",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
};

function privateJson(body: unknown, status = 200, extraHeaders = {}) {
  return NextResponse.json(body, {
    status,
    headers: { ...privateHeaders, ...extraHeaders },
  });
}

function unavailable(reference?: string) {
  return privateJson(
    {
      message: "Wallet verification is temporarily unavailable.",
      ...(reference ? { reference } : {}),
    },
    503,
  );
}

export async function POST(request: Request) {
  const contentLength = Number(request.headers.get("content-length") ?? "0");

  if (
    request.headers.get("content-type")?.split(";", 1)[0] !==
      "application/json" ||
    (Number.isFinite(contentLength) && contentLength > 4096)
  ) {
    return privateJson(
      { message: "Wallet challenge request was not valid." },
      400,
    );
  }

  const parsedBody = walletNonceChallengeRequestSchema.safeParse(
    await request.json().catch(() => null),
  );
  const anonymousSessionId = readAnonymousSessionId(request);

  if (!parsedBody.success) {
    return privateJson(
      { message: "Wallet challenge request was not valid." },
      400,
    );
  }

  if (!anonymousSessionId) {
    return privateJson(
      { message: "Open the campaign link again before connecting a wallet." },
      410,
    );
  }

  const projectId = "wallet-challenge";

  try {
    const applicationOrigin = getWalletChallengeApplicationOrigin(request.url);

    if (!requestMatchesWalletChallengeOrigin(request, applicationOrigin)) {
      return privateJson(
        { message: "Wallet challenge origin was not accepted." },
        403,
      );
    }

    const origin = new URL(applicationOrigin);
    const client = createAdminClient();
    const measurementContext = await readWalletMeasurementRuleContext(
      client,
      anonymousSessionId,
    );
    if (!measurementContext) {
      return privateJson(
        { message: "This campaign session has no approved wallet response." },
        410,
      );
    }
    const chainId = measurementContext.chainId;
    const challengeId = crypto.randomUUID();
    const nonce = createWalletChallengeNonce();
    const nonceHash = await hashWalletChallengeNonce(nonce);
    const { data, error } = await client.rpc(
      "issue_wallet_nonce_challenge_v2",
      {
        target_anonymous_session_id: anonymousSessionId,
        target_challenge_id: challengeId,
        target_domain: origin.host,
        target_nonce_hash: nonceHash,
        target_uri: origin.origin,
        target_wallet_address: parsedBody.data.walletAddress,
        target_chain_id: chainId,
      },
    );

    if (error) {
      if (error.code === "22023") {
        return privateJson(
          { message: "Wallet challenge request was not valid." },
          400,
        );
      }

      const reference = logError({
        event: "wallet_nonce_challenge_issue_failed",
        error,
        projectId,
      });
      return unavailable(reference);
    }

    const parsedResult = challengeResultSchema.safeParse(data);

    if (
      !parsedResult.success ||
      parsedResult.data[0]?.challenge_id !== challengeId
    ) {
      const reference = logError({
        event: "wallet_nonce_challenge_issue_missing",
        error: parsedResult.success
          ? new Error("Wallet challenge identity did not match the request.")
          : parsedResult.error,
        projectId,
      });
      return unavailable(reference);
    }

    const result = parsedResult.data[0];

    if (result.eligibility === "rate_limited") {
      return privateJson(
        { message: "Too many wallet challenge requests. Try again shortly." },
        429,
        { "Retry-After": "60" },
      );
    }

    if (result.eligibility === "session_not_eligible") {
      return privateJson(
        { message: "Open the campaign link again before connecting a wallet." },
        410,
      );
    }

    if (
      result.wallet_address !== parsedBody.data.walletAddress ||
      result.domain !== origin.host ||
      result.uri !== origin.origin ||
      result.statement !== walletNonceChallengeStatement ||
      result.chain_id !== chainId ||
      !result.expires_at ||
      new Date(result.expires_at).getTime() -
        new Date(result.issued_at).getTime() !==
        walletNonceChallengeMaxAgeSeconds * 1000
    ) {
      const reference = logError({
        event: "wallet_nonce_challenge_evidence_mismatch",
        error: new Error("Wallet challenge evidence was not canonical."),
        projectId,
      });
      return unavailable(reference);
    }

    return privateJson(
      buildWalletNonceChallengeResponse({
        applicationOrigin,
        challengeId,
        expiresAt: result.expires_at,
        issuedAt: result.issued_at,
        nonce,
        statement: result.statement,
        walletAddress: result.wallet_address,
        chainId,
      }),
      201,
    );
  } catch (error) {
    if (
      error instanceof WalletChallengeConfigError ||
      error instanceof SupabaseServerConfigError
    ) {
      return unavailable();
    }

    const reference = logError({
      event: "wallet_nonce_challenge_issue_failed",
      error,
      projectId,
    });
    return unavailable(reference);
  }
}
