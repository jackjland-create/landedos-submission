import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  assertBrowserCampaignHost,
  runBrowserCommercialAction,
} from "@/lib/baskets/browser-campaign-runtime.server";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };
async function handle(request: NextRequest, write: boolean) {
  try {
    assertBrowserCampaignHost(request.headers.get("host"));
  } catch {
    return NextResponse.json({ error: "Not found" }, { status: 404, headers });
  }
  if (
    write &&
    (request.headers.get("origin") !==
      `http://${request.headers.get("host")}` ||
      !["same-origin", null].includes(request.headers.get("sec-fetch-site")))
  )
    return NextResponse.json(
      { error: "Same-origin request required." },
      { status: 403, headers },
    );
  try {
    let input: unknown;
    if (write) {
      if (!request.headers.get("content-type")?.startsWith("application/json"))
        throw new Error("Invalid content");
      const body = await request.text();
      if (body.length > 16000) throw new Error("Body too large");
      input = JSON.parse(body);
    } else input = Object.fromEntries(request.nextUrl.searchParams);
    const action = (input as { action?: unknown })?.action;
    if (
      write
        ? ![
            "prepare",
            "select",
            "confirmSelected",
            "confirm",
            "create",
          ].includes(String(action))
        : action !== "recover"
    )
      throw new Error("Invalid method");
    return NextResponse.json(
      await runBrowserCommercialAction(await createClient(), input),
      { headers },
    );
  } catch {
    return NextResponse.json(
      {
        error:
          "The decision could not be confirmed. Check its status before retrying. Changed or expired plans need a fresh review.",
      },
      { status: 409, headers },
    );
  }
}
export const GET = (request: NextRequest) => handle(request, false);
export const POST = (request: NextRequest) => handle(request, true);
