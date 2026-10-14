import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { project } from "@/lib/demo-data";
import {
  assertBrowserCampaignHost,
  withBrowserCampaignTransaction,
} from "@/lib/baskets/browser-campaign-runtime.server";
const inputSchema = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("prepare"), campaignId: z.uuid() }),
  z.strictObject({
    action: z.literal("recover"),
    campaignId: z.uuid(),
    reviewId: z.uuid(),
  }),
  z.strictObject({
    action: z.literal("confirm"),
    campaignId: z.uuid(),
    reviewId: z.uuid(),
    reason: z.string().trim().min(8).max(240),
    acknowledged: z.literal(true),
  }),
]);
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
    let value: unknown;
    if (write) {
      if (!request.headers.get("content-type")?.startsWith("application/json"))
        throw new Error("Invalid body");
      const text = await request.text();
      if (text.length > 16000) throw new Error("Body too large");
      value = JSON.parse(text);
    } else value = Object.fromEntries(request.nextUrl.searchParams);
    const input = inputSchema.parse(value);
    if (write ? input.action === "recover" : input.action !== "recover")
      throw new Error("Invalid method");
    const result = await withBrowserCampaignTransaction(
      await createClient(),
      async (session) => {
        const args = [
          project.workspaceId,
          project.databaseId,
          input.campaignId,
        ];
        if (input.action === "prepare")
          return (
            await session.query(
              "select public.prepare_local_browser_execution($1::uuid,$2::uuid,$3::uuid) as value",
              args,
            )
          ).rows[0]?.value as unknown;
        if (input.action === "recover")
          return (
            await session.query(
              "select public.read_local_browser_execution($1::uuid,$2::uuid,$3::uuid,$4::uuid) as value",
              [...args, input.reviewId],
            )
          ).rows[0]?.value as unknown;
        return (
          await session.query(
            "select public.confirm_local_browser_execution($1::uuid,$2::uuid,$3::uuid,$4::uuid,$5::text) as value",
            [...args, input.reviewId, input.reason],
          )
        ).rows[0]?.value as unknown;
      },
    );
    return NextResponse.json(result, { headers });
  } catch {
    return NextResponse.json(
      {
        error:
          "Execution could not be confirmed. Sources may be missing, changed or expired. Check status before retrying.",
      },
      { status: 409, headers },
    );
  }
}
export const GET = (request: NextRequest) => handle(request, false);
export const POST = (request: NextRequest) => handle(request, true);
