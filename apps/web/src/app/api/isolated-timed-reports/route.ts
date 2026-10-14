import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { createClient } from "@/lib/supabase/server";
import { assertTimedRuntimeEnvironment } from "@/lib/reports/timed-report-runtime.server";
import { runTimedReportWorkflow } from "@/lib/reports/timed-report-workflow.server";
import { localReviewDiagnosticActionAllowed } from "@/lib/attribution/local-review-diagnostic";

export const dynamic = "force-dynamic";
async function handle(request: NextRequest, write: boolean) {
  try {
    assertTimedRuntimeEnvironment(request.headers.get("host"));
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  if (
    write &&
    (request.headers.get("origin") !==
      `http://${request.headers.get("host")}` ||
      !["same-origin", null].includes(request.headers.get("sec-fetch-site")))
  )
    return NextResponse.json(
      { error: "Same-origin confirmation is required." },
      { status: 403 },
    );
  try {
    let input: unknown;
    if (write) {
      if (!request.headers.get("content-type")?.startsWith("application/json"))
        throw new Error("Invalid request");
      const text = await request.text();
      if (text.length > 64000) throw new Error("Request too large");
      input = JSON.parse(text);
    } else input = Object.fromEntries(request.nextUrl.searchParams);
    const action = (input as { action?: unknown } | null)?.action;
    if (!localReviewDiagnosticActionAllowed(input, write, true))
      return NextResponse.json(
        { error: "Synthetic local review only; action unavailable." },
        { status: 403, headers: { "Cache-Control": "private, no-store" } },
      );
    if (
      write
        ? !["prepare", "confirm"].includes(String(action))
        : !["sources", "read", "recover"].includes(String(action))
    )
      throw new Error("Invalid operation");
    const result = await runTimedReportWorkflow(await createClient(), input);
    return NextResponse.json(result, {
      headers: { "Cache-Control": "private, no-store" },
    });
  } catch {
    const reference = randomUUID();
    console.error(
      JSON.stringify({
        event: "isolated_timed_report_request_failed",
        reference,
      }),
    );
    return NextResponse.json(
      {
        error:
          "The review is unavailable or has changed. Check access and reload. If confirmation was interrupted, check its status before trying again.",
        reference,
      },
      { status: 409, headers: { "Cache-Control": "private, no-store" } },
    );
  }
}
export const GET = (request: NextRequest) => handle(request, false);
export const POST = (request: NextRequest) => handle(request, true);
