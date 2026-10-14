import { notFound } from "next/navigation";

import { AppShell } from "@/components/app-shell";
import { BasketPlanNavigation } from "@/components/basket-plan-navigation";
import { BasketWorkspace } from "@/components/basket-workspace";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Guided basket flow visual fixture",
  robots: { index: false, follow: false },
};

const nextActions = {
  ready: {
    status: "ACTION REQUIRED",
    title: "Complete purpose and measurement",
    detail:
      "Save the goal, audience and success rule first. The rest of the plan will use that shared definition.",
    href: "#basket-strategy",
    label: "Open purpose",
  },
  loading: {
    status: "CHECKING ACCESS",
    title: "Confirming your basket session",
    detail:
      "You will stay on this basket while the first required input is confirmed.",
    href: "#basket-strategy",
    label: "Open purpose",
  },
  error: {
    status: "ACTION REQUIRED",
    title: "The saved plan could not be loaded",
    detail:
      "Try again before editing. No plan, term or approval has been changed.",
    href: "?state=ready",
    label: "Try again",
  },
  permission: {
    status: "PROJECT ACCESS REQUIRED",
    title: "This basket is not available",
    detail:
      "Ask a workspace administrator for campaign-manager access. No creator or package evidence is shown.",
    href: "/projects/helios/overview",
    label: "Return to overview",
  },
} as const;

export default async function GuidedBasketFlowFixture({
  searchParams,
}: {
  searchParams: Promise<{ state?: string }>;
}) {
  if (process.env.NODE_ENV !== "development" || process.env.VERCEL) notFound();
  const requested = (await searchParams).state;
  const state =
    requested === "loading" ||
    requested === "error" ||
    requested === "permission"
      ? requested
      : "ready";

  return (
    <AppShell activeSection="baskets" projectId="helios" showGuidedDemo={false}>
      <BasketWorkspace
        commitment="£15,000"
        count={3}
        enabled
        localCommercialEnabled
        name="Investor launch"
        nextAction={nextActions[state]}
        scenario="A · Focused authority"
      >
        {state === "permission" ? null : <BasketPlanNavigation />}
        <section
          aria-busy={state === "loading"}
          aria-labelledby="fixture-purpose-title"
          className="commercial-approval__confirm"
          id="basket-strategy"
          tabIndex={-1}
        >
          <span className="eyebrow">01 / PURPOSE &amp; MEASUREMENT</span>
          <h2 id="fixture-purpose-title">
            {state === "permission"
              ? "Campaign manager access is required"
              : state === "error"
                ? "Your saved purpose is still protected"
                : state === "loading"
                  ? "Loading saved purpose…"
                  : "Define the change this basket should make"}
          </h2>
          <p>
            {state === "ready"
              ? "Start with the commercial goal, the audience and the action that will count as success. Save this shared definition before choosing the final mix."
              : nextActions[state].detail}
          </p>
          {state === "ready" ? (
            <dl className="commercial-approval__terms">
              <div>
                <dt>Goal</dt>
                <dd>Generate measurable investor interest</dd>
              </div>
              <div>
                <dt>Audience</dt>
                <dd>Crypto-native investors</dd>
              </div>
              <div>
                <dt>Success rule</dt>
                <dd>Qualified wallet additions</dd>
              </div>
            </dl>
          ) : null}
        </section>
        <section id="basket-outcome" tabIndex={-1} />
        <section id="basket-roster" tabIndex={-1} />
        <section id="basket-timing" tabIndex={-1} />
        <section id="basket-plan-review" tabIndex={-1} />
      </BasketWorkspace>
    </AppShell>
  );
}
