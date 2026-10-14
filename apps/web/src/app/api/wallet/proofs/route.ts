import {
  walletSignatureProofRequestSchema,
  walletSignatureProofResponseSchema,
} from "@landed/contracts";
import { NextResponse } from "next/server";
import { z } from "zod";

import { logError } from "@/lib/observability";
import {
  createAdminClient,
  SupabaseServerConfigError,
} from "@/lib/supabase/server";
import { readAnonymousSessionId } from "@/lib/tracking/session.server";
import {
  getWalletChallengeApplicationOrigin,
  requestMatchesWalletChallengeOrigin,
  WalletChallengeConfigError,
} from "@/lib/wallet/challenge.server";
import {
  verifyWalletSignatureProof,
  WalletSignatureVerificationError,
} from "@/lib/wallet/proof.server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const proofResultSchema = z
  .array(
    z.object({
      proof_id: z.uuid().nullable(),
      eligibility: z.enum(["recorded", "replayed", "not_accepted"]),
      verified_at: z.iso.datetime({ offset: true }).nullable(),
    }),
  )
  .length(1);

const proofAttemptResultSchema = z
  .array(
    z.object({
      eligibility: z.enum([
        "admitted",
        "rate_limited",
        "replayed",
        "not_accepted",
      ]),
    }),
  )
  .length(1);

const privateHeaders = {
  "Cache-Control": "private, no-store, max-age=0",
  Pragma: "no-cache",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
};

function privateJson(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: privateHeaders });
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
    (Number.isFinite(contentLength) && contentLength > 12_288)
  ) {
    return privateJson({ message: "Wallet proof request was not valid." }, 400);
  }

  const parsedBody = walletSignatureProofRequestSchema.safeParse(
    await request.json().catch(() => null),
  );
  const anonymousSessionId = readAnonymousSessionId(request);

  if (!parsedBody.success) {
    return privateJson({ message: "Wallet proof request was not valid." }, 400);
  }
  if (!anonymousSessionId) {
    return privateJson(
      { message: "Open the campaign link again before connecting a wallet." },
      410,
    );
  }

  const projectId = "wallet-proof";

  try {
    const applicationOrigin = getWalletChallengeApplicationOrigin(request.url);
    const origin = new URL(applicationOrigin);

    if (
      !requestMatchesWalletChallengeOrigin(request, applicationOrigin) ||
      parsedBody.data.signInInput.domain !== origin.host ||
      parsedBody.data.signInInput.uri !== origin.origin
    ) {
      return privateJson(
        { message: "Wallet proof origin was not accepted." },
        403,
      );
    }

    const input = parsedBody.data.signInInput;
    const client = createAdminClient();
    const { data: attemptData, error: attemptError } = await client.rpc(
      "admit_wallet_signature_proof_attempt",
      {
        target_anonymous_session_id: anonymousSessionId,
        target_challenge_id: parsedBody.data.challengeId,
        target_wallet_address: input.address,
      },
    );

    if (attemptError) {
      const reference = logError({
        event: "wallet_signature_proof_attempt_failed",
        error: attemptError,
        projectId,
      });
      return unavailable(reference);
    }

    const parsedAttempt = proofAttemptResultSchema.safeParse(attemptData);
    if (!parsedAttempt.success) {
      const reference = logError({
        event: "wallet_signature_proof_attempt_invalid",
        error: parsedAttempt.error,
        projectId,
      });
      return unavailable(reference);
    }

    if (parsedAttempt.data[0].eligibility === "rate_limited") {
      return NextResponse.json(
        { message: "Too many wallet proof attempts. Try again shortly." },
        {
          status: 429,
          headers: { ...privateHeaders, "Retry-After": "60" },
        },
      );
    }
    if (parsedAttempt.data[0].eligibility === "replayed") {
      return privateJson({ message: "Wallet proof was already used." }, 409);
    }
    if (parsedAttempt.data[0].eligibility !== "admitted") {
      return privateJson(
        { message: "Wallet proof expired or was not accepted." },
        410,
      );
    }

    const evidence = await verifyWalletSignatureProof(parsedBody.data);
    const proofId = crypto.randomUUID();
    const { data, error } = await client.rpc(
      "record_verified_wallet_session_proof",
      {
        target_anonymous_session_id: anonymousSessionId,
        target_chain_id: input.chainId,
        target_challenge_id: parsedBody.data.challengeId,
        target_domain: input.domain,
        target_expires_at: input.expirationTime,
        target_issued_at: input.issuedAt,
        target_message_version: Number(input.version),
        target_nonce_hash: evidence.nonceHash,
        target_proof_id: proofId,
        target_signature_hash: evidence.signatureHash,
        target_signed_message_hash: evidence.signedMessageHash,
        target_statement: input.statement,
        target_uri: input.uri,
        target_verifier: evidence.verifier,
        target_verifier_version: evidence.verifierVersion,
        target_wallet_address: input.address,
      },
    );

    if (error) {
      if (error.code === "22023") {
        return privateJson(
          { message: "Wallet proof expired or was not accepted." },
          410,
        );
      }
      const reference = logError({
        event: "wallet_signature_proof_record_failed",
        error,
        projectId,
      });
      return unavailable(reference);
    }

    const parsedResult = proofResultSchema.safeParse(data);
    if (!parsedResult.success) {
      const reference = logError({
        event: "wallet_signature_proof_result_invalid",
        error: parsedResult.error,
        projectId,
      });
      return unavailable(reference);
    }

    const result = parsedResult.data[0];
    if (result.eligibility === "replayed") {
      return privateJson({ message: "Wallet proof was already used." }, 409);
    }
    if (
      result.eligibility !== "recorded" ||
      result.proof_id !== proofId ||
      !result.verified_at
    ) {
      return privateJson(
        { message: "Wallet proof expired or was not accepted." },
        410,
      );
    }

    return privateJson(
      walletSignatureProofResponseSchema.parse({
        proofId,
        challengeId: parsedBody.data.challengeId,
        state: "verified",
        verifiedAt: result.verified_at,
      }),
      201,
    );
  } catch (error) {
    if (error instanceof WalletSignatureVerificationError) {
      return privateJson({ message: "Wallet signature was not valid." }, 401);
    }
    if (
      error instanceof WalletChallengeConfigError ||
      error instanceof SupabaseServerConfigError
    ) {
      return unavailable();
    }
    const reference = logError({
      event: "wallet_signature_proof_failed",
      error,
      projectId,
    });
    return unavailable(reference);
  }
}
