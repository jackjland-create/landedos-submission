import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  assertLocalDevnetRehearsalHost,
  runLocalDevnetAction,
} from "@/lib/attribution/devnet-campaign-runtime.server";
import { readLocalDevnetSignedLink } from "@/lib/attribution/devnet-signed-link.server";
import { z } from "zod";
import { inngest } from "@/inngest/client";
import { localReviewDiagnosticActionAllowed } from "@/lib/attribution/local-review-diagnostic";

export const dynamic = "force-dynamic";
const responseHeaders = { "Cache-Control": "private, no-store" };

async function handle(request: NextRequest, write: boolean) {
  try {
    assertLocalDevnetRehearsalHost(request.headers.get("host"));
  } catch {
    return NextResponse.json(
      { error: "Not found" },
      { status: 404, headers: responseHeaders },
    );
  }

  if (
    write &&
    (request.headers.get("origin") !==
      `http://${request.headers.get("host")}` ||
      !["same-origin", null].includes(request.headers.get("sec-fetch-site")))
  )
    return NextResponse.json(
      { error: "Same-origin request required." },
      { status: 403, headers: responseHeaders },
    );

  try {
    let input: unknown;
    if (write) {
      if (!request.headers.get("content-type")?.startsWith("application/json"))
        throw new Error("Invalid body");
      const text = await request.text();
      if (text.length > 16_000) throw new Error("Body too large");
      input = JSON.parse(text);
    } else {
      input = Object.fromEntries(request.nextUrl.searchParams);
    }

    const action = String((input as { action?: unknown })?.action ?? "");
    if (!localReviewDiagnosticActionAllowed(input, write, false))
      return NextResponse.json(
        { error: "Synthetic local review only; action unavailable." },
        { status: 403, headers: responseHeaders },
      );
    const readActions = [
      "recover",
      "recoverCommercial",
      "readActivation",
      "readSignedLink",
      "readReconciliation",
    ];
    if (write ? readActions.includes(action) : !readActions.includes(action))
      throw new Error("Invalid method");

    if (action === "readSignedLink") {
      const parsed = z
        .strictObject({
          action: z.literal("readSignedLink"),
          campaignId: z.uuid(),
          contentAssetId: z.uuid(),
        })
        .parse(input);
      return NextResponse.json(
        await readLocalDevnetSignedLink(await createClient(), parsed),
        { headers: responseHeaders },
      );
    }

    const result = await runLocalDevnetAction(await createClient(), input);
    if (action === "enqueueReconciliation") {
      const retained = z
        .strictObject({
          job_id: z.uuid(),
          status: z.enum(["queued", "running", "completed", "failed"]),
          inserted: z.boolean(),
        })
        .parse(result);
      if (
        retained.job_id !==
        (input as { reconciliationJobId: string }).reconciliationJobId
      )
        throw new Error("Retained reconciliation identity changed");
      let dispatch: "accepted" | "not_needed" | "unconfirmed" = "not_needed";
      if (["queued", "running"].includes(retained.status)) {
        try {
          await inngest.send({
            id: `local-devnet-closed-${retained.job_id}`,
            name: "landed/solana.reconciliation.requested",
            data: { jobId: retained.job_id },
          });
          dispatch = "accepted";
        } catch {
          dispatch = "unconfirmed";
          console.error("Local devnet closed-range dispatch unconfirmed.");
        }
      }
      // Queue acceptance is not acquisition/completion. An uncertain transport
      // keeps the durable exact job identity for recovery, never a new job.
      return NextResponse.json(
        { ...retained, dispatch },
        { headers: responseHeaders },
      );
    }
    return NextResponse.json(result, { headers: responseHeaders });
  } catch (error) {
    console.error(
      "Local devnet rehearsal action failed:",
      (error instanceof Error ? error.message : "Unknown local rehearsal error")
        .replaceAll(/\s+/g, " ")
        .slice(0, 500),
    );
    return NextResponse.json(
      {
        error:
          "The local rehearsal action could not be confirmed. Check its retained status before retrying; changed or expired evidence needs a fresh review.",
      },
      { status: 409, headers: responseHeaders },
    );
  }
}

export const GET = (request: NextRequest) => handle(request, false);
export const POST = (request: NextRequest) => handle(request, true);
