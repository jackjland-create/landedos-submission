"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  saveBasketStrategyInputSchema,
  type BasketStrategyDefinition,
  type SavedBasketStrategy,
} from "@landed/contracts";
import {
  StrategyClientError,
  type BasketStrategyClient,
} from "./strategy-client";

export type StrategyEdits = {
  name: string;
  strategy: BasketStrategyDefinition;
};
type Edits = StrategyEdits;
export type BasketEditorState = {
  saved: SavedBasketStrategy | null;
  edits: Edits | null;
  latest: SavedBasketStrategy | null;
  busy: "loading" | "saving" | "adding" | null;
  error: StrategyClientError | null;
  needsReview: boolean;
};
const initial = (): BasketEditorState => ({
  saved: null,
  edits: null,
  latest: null,
  busy: "loading",
  error: null,
  needsReview: false,
});
const editable = (record: SavedBasketStrategy): Edits => ({
  name: record.draft.name,
  strategy: record.draft.strategy,
});

/** Pass a stable client; changing it starts a new basket session. This does not
 * enable a customer route or bypass BSK-09's strategy-bound approval gate. */
export function useBasketStrategy(client: BasketStrategyClient) {
  const owner = useMemo(() => ({ client }), [client]);
  const [ownedState, setState] = useState(() => ({ owner, value: initial() }));
  const state = ownedState.owner === owner ? ownedState.value : initial();
  const current = useRef(state);
  const generation = useRef(0);
  const active = useRef(false);
  const sessionOwner = useRef(owner);
  function publish(next: BasketEditorState) {
    current.current = next;
    setState({ owner, value: next });
  }

  useEffect(() => {
    const session = ++generation.current;
    sessionOwner.current = owner;
    active.current = true;
    const next = initial();
    current.current = next;
    const timer = window.setTimeout(() => {
      void Promise.resolve()
        .then(async () => {
          if (!active.current || session !== generation.current) return null;
          return client.load();
        })
        .then((saved) => {
          if (saved === null) return;
          if (!active.current || session !== generation.current) return;
          const loaded = {
            ...initial(),
            saved,
            edits: editable(saved),
            busy: null,
          };
          current.current = loaded;
          setState({ owner, value: loaded });
        })
        .catch((error: unknown) => {
          if (!active.current || session !== generation.current) return;
          const failed = { ...initial(), busy: null, error: failure(error) };
          current.current = failed;
          setState({ owner, value: failed });
        });
    }, 0);
    return () => {
      window.clearTimeout(timer);
      active.current = false;
      generation.current = session + 1;
    };
  }, [client, owner]);

  const dirty =
    !!state.saved &&
    !!state.edits &&
    JSON.stringify(editable(state.saved)) !== JSON.stringify(state.edits);

  function edit(edits: Edits) {
    const now = current.current;
    if (
      !active.current ||
      sessionOwner.current !== owner ||
      !now.saved ||
      now.busy
    )
      return;
    // Clone caller-owned values so external mutation cannot silently change a save.
    publish({ ...now, edits: structuredClone(edits), latest: null });
  }

  async function reviewSaved() {
    const now = current.current;
    if (!active.current || sessionOwner.current !== owner || now.busy) return;
    const session = generation.current;
    publish({ ...now, busy: "loading", error: null });
    try {
      const latest = await client.load();
      if (!active.current || session !== generation.current) return;
      publish(
        now.saved
          ? { ...now, busy: null, latest, needsReview: true, error: null }
          : {
              ...initial(),
              saved: latest,
              edits: editable(latest),
              busy: null,
            },
      );
    } catch (error) {
      if (active.current && session === generation.current)
        publish({ ...now, busy: null, error: failure(error) });
    }
  }

  function useSavedVersion() {
    const now = current.current;
    if (
      !active.current ||
      sessionOwner.current !== owner ||
      now.busy ||
      !now.latest
    )
      return;
    // This is the only explicit discard action. A refresh never replaces edits.
    publish({
      ...initial(),
      saved: now.latest,
      edits: editable(now.latest),
      busy: null,
    });
  }

  async function change(creatorIds?: string[]) {
    const now = current.current;
    if (
      !active.current ||
      sessionOwner.current !== owner ||
      now.busy ||
      now.needsReview ||
      !now.saved ||
      !now.edits
    )
      return false;
    const submittedCreatorIds = creatorIds ? [...creatorIds] : undefined;
    const isDirty =
      JSON.stringify(editable(now.saved)) !== JSON.stringify(now.edits);
    // Save strategy first. Never navigate to discovery on an unconfirmed save.
    if (creatorIds && (isDirty || now.saved.persistence !== "saved"))
      return false;
    const parsed = saveBasketStrategyInputSchema.safeParse({
      ...now.edits,
      expectedRevision: now.saved.revision,
    });
    if (!parsed.success) {
      publish({ ...now, error: new StrategyClientError("invalid") });
      return false;
    }
    const session = generation.current;
    publish({ ...now, busy: creatorIds ? "adding" : "saving", error: null });
    try {
      const revision = submittedCreatorIds
        ? await client.addCreators({
            expectedRevision: now.saved.revision,
            creatorIds: submittedCreatorIds,
          })
        : await client.save(parsed.data);
      if (!active.current || session !== generation.current) return false;
      const saved: SavedBasketStrategy = {
        ...now.saved,
        revision,
        persistence: "saved",
        draft: {
          ...now.saved.draft,
          name: parsed.data.name,
          strategy: parsed.data.strategy,
          selectedCreatorIds: submittedCreatorIds
            ? [
                ...new Set([
                  ...now.saved.draft.selectedCreatorIds,
                  ...submittedCreatorIds,
                ]),
              ].sort()
            : now.saved.draft.selectedCreatorIds,
        },
      };
      publish({ ...initial(), saved, edits: editable(saved), busy: null });
      return true;
    } catch (error) {
      if (!active.current || session !== generation.current) return false;
      const reason = failure(error);
      publish({
        ...now,
        busy: null,
        error: reason,
        needsReview: reason.kind !== "invalid",
      });
      return false;
    }
  }

  return {
    state,
    dirty,
    edit,
    restore(edits: Edits, baseRevision: number, uncertain: boolean) {
      const now = current.current;
      if (
        !active.current ||
        sessionOwner.current !== owner ||
        now.busy ||
        !now.saved
      )
        return;
      publish({
        ...now,
        edits: structuredClone(edits),
        latest: null,
        needsReview:
          now.needsReview || uncertain || baseRevision !== now.saved.revision,
      });
    },
    save: () => change(),
    addCreators: (ids: string[]) => change(ids),
    reviewSaved,
    useSavedVersion,
  };
}

function failure(error: unknown) {
  return error instanceof StrategyClientError
    ? error
    : new StrategyClientError("unavailable");
}
