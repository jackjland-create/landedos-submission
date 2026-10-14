import { campaignTimingProposalSchema } from "@landed/contracts";
import { z } from "zod";
import type { TimingSessionClient } from "./timing-session";
import { createClient } from "@/lib/supabase/client";

/** Same-origin transport; errors carry no arbitrary provider content. */
export function basketTimingClient(
  projectId: string,
  basketId: string,
  request: typeof fetch = fetch,
): TimingSessionClient {
  z.string()
    .regex(/^[a-zA-Z0-9_-]+$/)
    .parse(projectId);
  z.uuid().parse(basketId);
  const url = `/api/projects/${encodeURIComponent(projectId)}/baskets/${basketId.toLowerCase()}/timing`;
  async function send(method: "GET" | "PUT", body?: unknown) {
    const response = await request(url, {
      method,
      credentials: "same-origin",
      cache: "no-store",
      redirect: "error",
      ...(body === undefined
        ? {}
        : {
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          }),
    });
    if (method === "GET" && response.status === 404) return null;
    if (!response.ok) throw new Error("Saved dates could not be confirmed.");
    return response.json();
  }
  return {
    onIdentityChange(reset) {
      let owner: string | null | undefined;
      const { data } = createClient().auth.onAuthStateChange(
        (event, session) => {
          const next = session?.user.id ?? null;
          if (event === "SIGNED_OUT" || (owner !== undefined && owner !== next))
            reset();
          owner = next;
        },
      );
      return () => data.subscription.unsubscribe();
    },
    load: async () =>
      z
        .strictObject({
          ownerId: z.uuid(),
          canManage: z.boolean(),
          revision: z.number().int().positive().max(2147483647),
          timing: campaignTimingProposalSchema.nullable(),
        })
        .nullable()
        .parse(await send("GET")),
    save: (input) =>
      send(
        "PUT",
        z
          .strictObject({
            expectedOwnerId: z.uuid().optional(),
            expectedRevision: z.number().int().positive().max(2147483646),
            timing: campaignTimingProposalSchema,
          })
          .parse(input),
      ),
  };
}
