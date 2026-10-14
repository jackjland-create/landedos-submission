"use client";

import { draftCustomBasket, type SavedBasketStrategy } from "@landed/contracts";
import { StrategyEditorSession } from "@/components/basket-strategy-editor";
import type { BasketStrategyClient } from "@/lib/baskets/strategy-client";

const ownerId = "91000000-0000-4000-8000-000000000001";
const basketId = "90000000-0000-4000-8000-000000000001";
const draft = draftCustomBasket({
  name: "Internal devnet response proof",
  goal: "One creator-linked consented devnet response",
  audience: "Jack — internal devnet test participant",
  selectedCreatorIds: ["91000000-0000-4000-8000-000000000061"],
});
draft.strategy = {
  ...draft.strategy,
  rationale:
    "One signed private link tests the attribution journey without a public post.",
  distributionMode: "unpaid_private_link",
};
const saved: SavedBasketStrategy = {
  basketId,
  revision: 3,
  persistence: "saved",
  draft,
};
const client: BasketStrategyClient = {
  load: async () => saved,
  save: async () => {
    throw new Error("Layout fixture cannot save a strategy");
  },
  addCreators: async () => {
    throw new Error("Layout fixture cannot add creators");
  },
};
const errorClient: BasketStrategyClient = {
  ...client,
  load: async () => {
    throw new Error("Layout fixture: strategy unavailable");
  },
};
const onReviewState = () => {};

export function PrivateLinkStrategyFixture({
  state,
}: {
  state: "ready" | "permission" | "error";
}) {
  return (
    <StrategyEditorSession
      projectId="helios"
      basketId={basketId}
      ownerId={ownerId}
      canManage={state !== "permission"}
      allowPrivateLinkTest
      onReviewState={onReviewState}
      client={state === "error" ? errorClient : client}
    />
  );
}
