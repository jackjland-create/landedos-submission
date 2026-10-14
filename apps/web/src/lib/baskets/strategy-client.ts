import {
  addBasketCreatorsInputSchema,
  savedBasketStrategySchema,
  saveBasketStrategyInputSchema,
  type SavedBasketStrategy,
} from "@landed/contracts";
import { z } from "zod";

export type StrategyFailureKind =
  "permission" | "not_found" | "conflict" | "invalid" | "unavailable";

export class StrategyClientError extends Error {
  constructor(public readonly kind: StrategyFailureKind) {
    super(
      {
        permission:
          "You do not have access to change this basket. Your edits are still here.",
        not_found: "This basket is unavailable. Check your project and access.",
        conflict:
          "This basket has changed or is now locked. Review its saved details before continuing.",
        invalid: "Check the basket details before trying again.",
        unavailable:
          "We could not confirm the result. Review the saved basket before trying another change.",
      }[kind],
    );
  }
}

/** Same-origin cookie-authenticated transport. No storage, credentials or retries. */
export function basketStrategyClient(
  projectId: string,
  basketId: string,
  request: typeof fetch = fetch,
  expectedOwnerId?: string,
) {
  if (expectedOwnerId !== undefined) z.uuid().parse(expectedOwnerId);
  z.string()
    .regex(/^[a-zA-Z0-9_-]+$/)
    .parse(projectId);
  z.uuid().parse(basketId);
  const base = `/api/projects/${encodeURIComponent(projectId)}/baskets/${basketId}`;

  async function send(path: string, method: string, body?: unknown) {
    let response: Response;
    try {
      response = await request(`${base}/${path}`, {
        method,
        credentials: "same-origin",
        cache: "no-store",
        redirect: "error",
        ...(method === "GET" && expectedOwnerId
          ? { headers: { "X-Landed-Expected-Owner": expectedOwnerId } }
          : {}),
        ...(body === undefined
          ? {}
          : {
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(
                path === "strategy" && method === "PUT" && expectedOwnerId
                  ? { ...(body as object), expectedOwnerId }
                  : body,
              ),
            }),
      });
    } catch {
      throw new StrategyClientError("unavailable");
    }
    if (!response.ok) {
      const kind =
        response.status === 401 || response.status === 403
          ? "permission"
          : response.status === 404
            ? "not_found"
            : response.status === 409
              ? "conflict"
              : response.status === 400
                ? "invalid"
                : "unavailable";
      // Never surface arbitrary server/provider response text to the operator.
      throw new StrategyClientError(kind);
    }
    try {
      return await response.json();
    } catch {
      throw new StrategyClientError("unavailable");
    }
  }

  async function mutation(
    path: string,
    method: string,
    input: { expectedRevision: number },
  ) {
    const result = z
      .strictObject({ revision: z.number().int().positive() })
      .safeParse(await send(path, method, input));
    if (!result.success || result.data.revision !== input.expectedRevision + 1)
      throw new StrategyClientError("unavailable");
    return result.data.revision;
  }

  return {
    async load(): Promise<SavedBasketStrategy> {
      const result = savedBasketStrategySchema.safeParse(
        await send("strategy", "GET"),
      );
      if (
        !result.success ||
        result.data.basketId !== basketId ||
        (result.data.persistence === "saved"
          ? result.data.revision < 1
          : result.data.revision !== 0)
      )
        throw new StrategyClientError("unavailable");
      return result.data;
    },
    async save(input: z.input<typeof saveBasketStrategyInputSchema>) {
      const parsed = saveBasketStrategyInputSchema.safeParse(input);
      if (!parsed.success) throw new StrategyClientError("invalid");
      return mutation("strategy", "PUT", parsed.data);
    },
    async addCreators(input: z.input<typeof addBasketCreatorsInputSchema>) {
      const parsed = addBasketCreatorsInputSchema.safeParse(input);
      if (!parsed.success) throw new StrategyClientError("invalid");
      return mutation("creators", "POST", parsed.data);
    },
  };
}

export type BasketStrategyClient = ReturnType<typeof basketStrategyClient>;
