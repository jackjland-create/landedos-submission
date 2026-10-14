import {
  walletMappingUnlinkRequestSchema,
  walletMappingUnlinkResponseSchema,
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

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ mappingId: string }>;
};

const unlinkResultSchema = z
  .array(
    z.object({
      mapping_id: z.uuid().nullable(),
      eligibility: z.enum(["unlinked", "already_unlinked", "not_found"]),
      unlinked_at: z.iso.datetime({ offset: true }).nullable(),
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

export async function DELETE(request: Request, context: RouteContext) {
  const { mappingId } = await context.params;
  const contentLength = Number(request.headers.get("content-length") ?? "0");

  if (
    !z.uuid().safeParse(mappingId).success ||
    request.headers.get("content-type")?.split(";", 1)[0] !==
      "application/json" ||
    (Number.isFinite(contentLength) && contentLength > 1_024)
  ) {
    return privateJson(
      { message: "Wallet unlink request was not valid." },
      400,
    );
  }

  const parsedBody = walletMappingUnlinkRequestSchema.safeParse(
    await request.json().catch(() => null),
  );
  const anonymousSessionId = readAnonymousSessionId(request);

  if (!parsedBody.success) {
    return privateJson(
      { message: "Wallet unlink request was not valid." },
      400,
    );
  }
  if (!anonymousSessionId) {
    return privateJson({ message: "Wallet relationship was not found." }, 404);
  }

  const projectId = "wallet-unlink";

  try {
    const applicationOrigin = getWalletChallengeApplicationOrigin(request.url);
    if (!requestMatchesWalletChallengeOrigin(request, applicationOrigin)) {
      return privateJson(
        { message: "Wallet unlink origin was not accepted." },
        403,
      );
    }

    const client = createAdminClient();
    const { data, error } = await client.rpc(
      "unlink_protected_wallet_mapping",
      {
        target_anonymous_session_id: anonymousSessionId,
        target_mapping_id: mappingId,
        target_unlink_request_id: parsedBody.data.unlinkRequestId,
      },
    );

    if (error) {
      const reference = logError({
        event: "protected_wallet_mapping_unlink_failed",
        error,
        projectId,
      });
      return privateJson(
        { message: "Wallet unlink is temporarily unavailable.", reference },
        503,
      );
    }

    const parsedResult = unlinkResultSchema.safeParse(data);
    if (!parsedResult.success) {
      const reference = logError({
        event: "protected_wallet_mapping_unlink_result_invalid",
        error: parsedResult.error,
        projectId,
      });
      return privateJson(
        { message: "Wallet unlink is temporarily unavailable.", reference },
        503,
      );
    }

    const result = parsedResult.data[0];
    if (
      result.eligibility === "not_found" ||
      !result.mapping_id ||
      !result.unlinked_at
    ) {
      return privateJson(
        { message: "Wallet relationship was not found." },
        404,
      );
    }

    return privateJson(
      walletMappingUnlinkResponseSchema.parse({
        mappingId: result.mapping_id,
        state: result.eligibility,
        unlinkedAt: result.unlinked_at,
      }),
    );
  } catch (error) {
    if (
      error instanceof WalletChallengeConfigError ||
      error instanceof SupabaseServerConfigError
    ) {
      return privateJson(
        { message: "Wallet unlink is temporarily unavailable." },
        503,
      );
    }
    const reference = logError({
      event: "protected_wallet_mapping_unlink_failed",
      error,
      projectId,
    });
    return privateJson(
      { message: "Wallet unlink is temporarily unavailable.", reference },
      503,
    );
  }
}
