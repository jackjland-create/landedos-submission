"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { CreatorDirectoryRecord } from "@landed/contracts";
import { CreatorDirectory } from "./creator-directory";
import {
  basketStrategyClient,
  type BasketStrategyClient,
} from "@/lib/baskets/strategy-client";
import { useBasketStrategy } from "@/lib/baskets/use-basket-strategy";
import styles from "./plan-creator-directory.module.css";

/**
 * Local rehearsal only: selection appends to one saved basket, never creates
 * another. UI-03 (board 02d): a plan bar with the way back, and a selection
 * tray whose only action adds the new creators to this plan.
 */
export function BasketCreatorDirectory({
  projectId,
  basketId,
  creators,
  canManage,
  client: suppliedClient,
  theme = "light",
}: {
  theme?: "light" | "dark";
  projectId: string;
  basketId: string;
  creators: CreatorDirectoryRecord[];
  canManage: boolean;
  client?: BasketStrategyClient;
}) {
  const router = useRouter();
  const client = useMemo(
    () => suppliedClient ?? basketStrategyClient(projectId, basketId),
    [suppliedClient, projectId, basketId],
  );
  const editor = useBasketStrategy(client);
  const { state } = editor;
  const [leaving, setLeaving] = useState(false);
  const back = `/projects/${projectId}/baskets/${basketId}`;
  const existing = state.saved?.draft.selectedCreatorIds ?? [];
  async function add(ids: string[]) {
    if (!canManage || leaving || state.saved?.persistence !== "saved") return;
    const additions = ids.filter((id) => !existing.includes(id));
    if (!additions.length || existing.length + additions.length > 20) return;
    if (await editor.addCreators(additions)) {
      setLeaving(true);
      router.push(back);
    }
  }
  const plan = state.saved?.draft.name ?? "your plan";
  const names = new Map(
    creators.map(({ id, displayName }) => [id, displayName]),
  );
  return (
    <>
      <section
        className={`${styles.root} ${styles.planBar}`}
        data-theme={theme}
        aria-label="Plan you are adding to"
      >
        <Link className={styles.back} href={back}>
          <span aria-hidden="true">←</span> Back to plan
        </Link>
        <p className={styles.barText}>
          {state.busy === "loading" ? (
            "Loading the saved plan…"
          ) : leaving ? (
            "Creators added. Returning to your plan…"
          ) : state.saved ? (
            <>
              Adding candidates to <strong>{plan}</strong> · {existing.length}{" "}
              already in this plan · up to 20
            </>
          ) : (
            "This plan’s details aren’t available."
          )}
        </p>
        <div className={styles.barNotes} role="status">
          {(state.busy === "adding" || state.needsReview) && (
            <p>
              An addition may still be saved even if you leave. Check the saved
              plan before trying again.
            </p>
          )}
          {state.saved?.persistence === "legacy_unconfigured" && (
            <p>
              Save Goal and audience on the plan before adding creators here.
            </p>
          )}
        </div>
        {!canManage && (
          <p className={styles.barNotice} role="alert">
            You can review creators, but only a campaign manager can add them.
          </p>
        )}
        {state.error && (
          <p className={styles.barNotice} role="alert">
            {state.error.message}
          </p>
        )}
        {(state.error || state.needsReview) && (
          <button
            type="button"
            className={styles.button}
            disabled={!!state.busy}
            onClick={() => void editor.reviewSaved()}
          >
            Check the saved plan
          </button>
        )}
        {state.latest && (
          <div className={styles.barNotice}>
            <p>
              The saved plan now has{" "}
              {state.latest.draft.selectedCreatorIds.length} creators. Review
              your selection before adding anyone.
            </p>
            <button
              type="button"
              className={styles.button}
              disabled={!!state.busy}
              onClick={editor.useSavedVersion}
            >
              Use these saved details
            </button>
          </div>
        )}
      </section>
      <CreatorDirectory
        creators={creators}
        renderBasketAction={(ids) => {
          const additions = ids.filter((id) => !existing.includes(id));
          const count = additions.length;
          const alreadyIn = ids.length - count;
          const overLimit = existing.length + count > 20;
          const shown = additions
            .slice(0, 3)
            .map((id) => names.get(id))
            .filter(Boolean)
            .join(", ");
          return (
            <section
              className={`${styles.root} ${styles.tray}`}
              data-theme={theme}
              aria-label="Selected creators"
            >
              <div className={styles.trayText}>
                <p>
                  <strong>
                    {count} selected
                    {shown
                      ? ` · ${shown}${additions.length > 3 ? ` and ${additions.length - 3} more` : ""}`
                      : ""}
                  </strong>
                </p>
                <p className={styles.small}>
                  {count
                    ? "They join the plan’s candidates. You add their terms there. Existing terms don’t change."
                    : "Tick creators to add them to the plan."}
                  {alreadyIn > 0
                    ? ` ${alreadyIn} already in the plan ${alreadyIn === 1 ? "is" : "are"} skipped.`
                    : ""}
                </p>
                {overLimit && (
                  <p className={styles.trayAlert} role="alert">
                    Choose fewer creators: a plan can have up to 20.
                  </p>
                )}
              </div>
              <button
                type="button"
                className={`${styles.button} ${styles.hero}`}
                disabled={
                  !canManage ||
                  !!state.busy ||
                  leaving ||
                  state.needsReview ||
                  !count ||
                  overLimit ||
                  state.saved?.persistence !== "saved"
                }
                onClick={() => void add(ids)}
              >
                {state.busy === "adding"
                  ? "Adding…"
                  : leaving
                    ? "Returning to plan…"
                    : `Add ${count} to plan`}
              </button>
            </section>
          );
        }}
      />
      {/* Keeps the last rows clear of the fixed selection tray. */}
      <div className={styles.traySpace} aria-hidden="true" />
    </>
  );
}
