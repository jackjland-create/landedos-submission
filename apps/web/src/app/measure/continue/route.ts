import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { readAnonymousSessionId } from "@/lib/tracking/session.server";
import { getTrackedLinkApplicationOrigin } from "@/lib/tracking/signing.server";
import { readHostedContinuation } from "@/lib/wallet/continuation.server";
import { logError } from "@/lib/observability";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const headers = {
  "Cache-Control": "private, no-store, max-age=0",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Robots-Tag": "noindex, nofollow",
};
export async function HEAD() {
  return new NextResponse(null, { status: 204, headers });
}
export async function GET(request: Request) {
  const sessionId = readAnonymousSessionId(request);
  // A return URL is never accepted, even if a caller adds one to this endpoint.
  if (sessionId && !new URL(request.url).search) {
    try {
      const destination = await readHostedContinuation(
        createAdminClient(),
        sessionId,
        getTrackedLinkApplicationOrigin(request.url),
      );
      if (destination)
        return NextResponse.redirect(destination.url, { status: 303, headers });
    } catch (error) {
      logError({
        event: "measurement_continuation_unavailable",
        error,
        projectId: "public-measurement",
      });
    }
  }
  return new NextResponse(
    "This campaign destination is no longer available. Return to the campaign measurement page or ask the campaign team for a current link.",
    {
      status: 410,
      headers: { ...headers, "Content-Type": "text/plain; charset=utf-8" },
    },
  );
}
