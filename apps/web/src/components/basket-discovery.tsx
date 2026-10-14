"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { listPreparedBaskets } from "@landed/contracts";
import { ActionButton, Eyebrow } from "@landed/ui";
import { z } from "zod";
import styles from "./basket-discovery.module.css";

const library = listPreparedBaskets();
const words = (value: string) =>
  value === "x" ? "X" : value.replaceAll("_", " ");

/** BSK-07/08: editorial discovery, then the existing saved-draft workflow. */
export function BasketDiscovery({
  projectId,
  templateKey,
  canManage = false,
  rehearsalPath,
}: {
  projectId: string;
  templateKey?: string;
  canManage?: boolean;
  rehearsalPath?: "/visual-tests/baskets/discovery";
}) {
  const custom = !!rehearsalPath && templateKey === "custom";
  const selected = library.find((item) => item.key === templateKey);
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [uncertain, setUncertain] = useState(false);
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    if (!dirty) return;
    const unload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    const leave = (event: MouseEvent) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      )
        return;
      const link =
        event.target instanceof Element
          ? event.target.closest<HTMLAnchorElement>("a[href]")
          : null;
      if (!link || link.target === "_blank" || link.hasAttribute("download"))
        return;
      if (
        !window.confirm(
          "Leave these unsaved starting details? They will not be kept. If a save was sent, check your saved baskets before creating another copy.",
        )
      ) {
        event.preventDefault();
        event.stopPropagation();
      }
    };
    window.addEventListener("beforeunload", unload);
    document.addEventListener("click", leave, true);
    return () => {
      window.removeEventListener("beforeunload", unload);
      document.removeEventListener("click", leave, true);
    };
  }, [dirty]);
  const inFlight = useRef(false);
  const disposed = useRef(false);
  useEffect(() => {
    disposed.current = false;
    return () => {
      disposed.current = true;
    };
  }, []);
  const base = `/projects/${projectId}/baskets`;
  const discovery = rehearsalPath ?? base;
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if ((!selected && !custom) || !canManage || inFlight.current || uncertain)
      return;
    const name = String(
      new FormData(event.currentTarget).get("name") ?? "",
    ).trim();
    if (!name || name.length > 120) {
      setMessage("Use a basket name between 1 and 120 characters.");
      event.currentTarget.querySelector<HTMLInputElement>("input")?.focus();
      return;
    }
    inFlight.current = true;
    setBusy(true);
    setMessage("Saving your editable basket…");
    let navigating = false;
    try {
      const response = await fetch(
        `/api/projects/${projectId}/baskets/drafts`,
        {
          method: "POST",
          credentials: "same-origin",
          cache: "no-store",
          redirect: "error",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            custom
              ? {
                  kind: "custom",
                  name,
                  goal:
                    String(
                      new FormData(event.currentTarget).get("goal") ?? "",
                    ).trim() || null,
                  audience:
                    String(
                      new FormData(event.currentTarget).get("audience") ?? "",
                    ).trim() || null,
                }
              : {
                  kind: "prepared",
                  templateKey: selected!.key,
                  templateVersion: selected!.version,
                  name,
                },
          ),
        },
      );
      if (disposed.current) return;
      if (response.status === 401 || response.status === 403) {
        setMessage(
          "Campaign manager access is required. Ask your workspace administrator.",
        );
        return;
      }
      if (response.status === 400) {
        setMessage(
          "The basket could not be created. Check its name and reload this starting strategy.",
        );
        return;
      }
      if (!response.ok) throw new Error("unconfirmed");
      const result = z
        .object({ basketId: z.uuid() })
        .parse(await response.json());
      if (disposed.current) return;
      setMessage("Basket saved. Opening your builder…");
      setDirty(false);
      router.push(`${base}/${result.basketId}`);
      navigating = true;
      // Keep submit locked while navigation completes.
      return;
    } catch {
      if (disposed.current) return;
      setUncertain(true);
      setMessage(
        "We could not confirm whether the basket was saved. Check Continue your work before creating another copy.",
      );
    } finally {
      if (!navigating && !disposed.current) {
        inFlight.current = false;
        setBusy(false);
      }
    }
  }
  if (custom)
    return (
      <section className={styles.root} aria-label="Build your own basket">
        <Link href={discovery}>← Explore all baskets</Link>
        <h2>Start with your own goal.</h2>
        <p>
          Save a draft, then choose creators and configure their exact packages,
          fees and dates in the same basket. Nothing is booked or approved.
        </p>
        <div className={styles.next}>
          <div>
            <h3>Your starting point</h3>
            <p>
              No suggested allocation or performance claim is added. You can
              finish the strategy in the builder.
            </p>
            <Link href={`/projects/${projectId}/kols`}>
              Prefer to browse creators first?
            </Link>
          </div>
          <form
            onSubmit={create}
            onChange={() => setDirty(true)}
            aria-busy={busy}
          >
            <label htmlFor="custom-basket-name">
              Name your basket
              <span
                className="required-field-marker"
                aria-hidden="true"
                title="Required"
              />
            </label>
            <input
              id="custom-basket-name"
              name="name"
              required
              maxLength={120}
              autoComplete="off"
              disabled={busy || !canManage || uncertain}
            />
            <label htmlFor="custom-basket-goal">
              What do you want to achieve? (optional)
            </label>
            <input
              id="custom-basket-goal"
              name="goal"
              maxLength={1000}
              autoComplete="off"
              disabled={busy || !canManage || uncertain}
            />
            <label htmlFor="custom-basket-audience">
              Who do you want to reach? (optional)
            </label>
            <input
              id="custom-basket-audience"
              name="audience"
              maxLength={1000}
              autoComplete="off"
              disabled={busy || !canManage || uncertain}
            />
            <ActionButton
              type="submit"
              disabled={busy || !canManage || uncertain}
            >
              {busy ? "Saving basket…" : "Save my starting basket"}
            </ActionButton>
            {!canManage && (
              <p>Campaign manager access is required to create a basket.</p>
            )}
            <p role="status" aria-live="polite">
              {message}
            </p>
            {uncertain && (
              <Link href={`${base}#continue-work`}>
                Check Continue your work
              </Link>
            )}
          </form>
        </div>
      </section>
    );
  if (selected)
    return (
      <section className={styles.root} aria-label="Basket starting strategy">
        <Link href={discovery}>← Explore all baskets</Link>
        <div className={styles.detail}>
          <div className={styles.lead}>
            <Eyebrow>EDITABLE STARTING STRATEGY</Eyebrow>
            <h2>{selected.name}</h2>
            <p>{selected.summary}</p>
            <dl>
              <dt>Who you want to reach</dt>
              <dd>{selected.strategy.audience}</dd>
              <dt>What you want to achieve</dt>
              <dd>{selected.strategy.goal}</dd>
            </dl>
            <p>{selected.strategy.rationale}</p>
          </div>
          <div className={styles.mix}>
            <h3>A starting channel mix</h3>
            <p>
              Suggested share of planned spend—not reach, performance or a fixed
              price.
            </p>
            {selected.strategy.allocations.map((item) => (
              <div
                className={styles.allocation}
                key={`${item.channel}:${item.archetype}`}
              >
                <div>
                  <strong>{words(item.channel)}</strong>
                  <span>{item.plannedSpendBps / 100}%</span>
                </div>
                <meter
                  min={0}
                  max={10000}
                  value={item.plannedSpendBps}
                  aria-label={`${words(item.channel)} suggested spend share`}
                >
                  {item.plannedSpendBps / 100}%
                </meter>
                <p>
                  {words(item.archetype)} · {item.format}
                </p>
                <p>{item.rationale}</p>
              </div>
            ))}
          </div>
        </div>
        <div className={styles.next}>
          <div>
            <h3>Make it yours</h3>
            <ol>
              <li>
                <strong>Save your starting strategy.</strong> Nothing is booked
                or approved.
              </li>
              <li>
                <strong>Choose your creators and terms.</strong> Set your
                budget, packages and dates in the full builder.
              </li>
              <li>
                <strong>Review the plan.</strong> Confirm what success means and
                check the exact saved terms. Approval is not enabled in this
                rehearsal.
              </li>
            </ol>
          </div>
          <form
            onSubmit={create}
            onChange={() => setDirty(true)}
            aria-busy={busy}
          >
            <label htmlFor="discovery-basket-name">
              Name your basket
              <span
                className="required-field-marker"
                aria-hidden="true"
                title="Required"
              />
            </label>
            <input
              id="discovery-basket-name"
              name="name"
              defaultValue={selected.name}
              required
              maxLength={120}
              autoComplete="off"
              disabled={busy || !canManage || uncertain}
            />
            <ActionButton
              type="submit"
              disabled={busy || !canManage || uncertain}
            >
              {busy ? "Saving basket…" : "Customise this basket"}
            </ActionButton>
            {!canManage ? (
              <p>
                Campaign manager access is required to create a basket. You can
                still explore the strategy.
              </p>
            ) : null}
            <p role="status" aria-live="polite">
              {message}
            </p>
            {uncertain ? (
              <Link href={`${base}#continue-work`}>
                Check Continue your work
              </Link>
            ) : null}
          </form>
        </div>
        <details className={styles.evidence}>
          <summary>
            What supports this strategy—and what still needs checking?
          </summary>
          <p>
            {selected.provenance.sourceLabel}. Reviewed{" "}
            {new Intl.DateTimeFormat("en-GB", {
              dateStyle: "medium",
              timeZone: "UTC",
            }).format(new Date(selected.provenance.reviewedOn))}
            , version {selected.version}.
          </p>
          <p>
            Editorial starting hypothesis. No measured basket performance,
            creator availability, price or outcome forecast is claimed.
          </p>
          <ul>
            {[
              ...selected.strategy.assumptions,
              ...selected.strategy.missingEvidence,
              ...selected.strategy.exclusions,
            ].map((value) => (
              <li key={value}>{value}</li>
            ))}
          </ul>
        </details>
      </section>
    );
  return (
    <section className={styles.root} aria-label="Explore baskets">
      <div className={styles.intro}>
        <div>
          <Eyebrow>START WITH YOUR GOAL</Eyebrow>
          <h2>Find your distribution strategy.</h2>
          <p>
            Explore a prepared basket, then choose the creators, budget and
            terms that fit your campaign.
          </p>
        </div>
        <Link
          className="action-button action-button--secondary"
          href={
            rehearsalPath
              ? `${discovery}?template=custom`
              : `/projects/${projectId}/kols`
          }
        >
          Build your own
        </Link>
      </div>
      {templateKey ? (
        <p role="status">
          That starting strategy is unavailable. Choose one below; no basket has
          been created.
        </p>
      ) : null}
      <div className={styles.library}>
        {library.map((item) => (
          <article className={styles.card} key={item.key}>
            <Eyebrow>PREPARED · EDITABLE</Eyebrow>
            <h3>{item.name}</h3>
            <p>{item.summary}</p>
            <p className={styles.channels}>
              {item.strategy.allocations
                .map((a) => words(a.channel))
                .join(" / ")}
            </p>
            <Link
              className="action-button action-button--secondary"
              href={`${discovery}?template=${item.key}`}
            >
              Explore {item.name}
            </Link>
          </article>
        ))}
      </div>
      <p>
        Starting strategies, not pre-booked creator bundles. Availability,
        prices and outcome forecasts need current evidence.
      </p>
    </section>
  );
}
