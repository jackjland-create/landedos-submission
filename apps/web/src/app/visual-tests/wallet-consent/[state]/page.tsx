import {
  walletMeasurementConsentStatement,
  walletMeasurementHistoricalLookbackDays,
} from "@landed/contracts";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { WalletConsentReview } from "@/components/wallet-consent-review";
import { reportVisualFixturesEnabled } from "@/lib/reports/visual-fixtures";
import { walletNonceChallengeStatement } from "@/lib/wallet/challenge.server";

type PageProps = {
  params: Promise<{ state: string }>;
  searchParams: Promise<{
    phase?: string | string[];
    theme?: string | string[];
  }>;
};

const walletConsentReviewStates = [
  "ready",
  "loading",
  "expired",
  "error",
  "permission",
] as const;

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Wallet consent interaction review",
  robots: { follow: false, index: false },
};

export default async function WalletConsentVisualStatePage({
  params,
  searchParams,
}: PageProps) {
  const [{ state }, query] = await Promise.all([params, searchParams]);
  const enabled = reportVisualFixturesEnabled({
    explicitFlag: process.env.ENABLE_VISUAL_FIXTURES,
    nodeEnv: process.env.NODE_ENV,
    vercelEnv: process.env.VERCEL_ENV,
  });
  if (!enabled || !walletConsentReviewStates.includes(state as never)) {
    notFound();
  }

  return (
    <WalletConsentReview
      challengeStatement={walletNonceChallengeStatement}
      consentStatement={walletMeasurementConsentStatement}
      historicalLookbackDays={walletMeasurementHistoricalLookbackDays}
      initialPhase={
        query.phase === "consent" || query.phase === "handoff"
          ? query.phase
          : "proof"
      }
      initialTheme={query.theme === "dark" ? "dark" : "light"}
      state={state as (typeof walletConsentReviewStates)[number]}
    />
  );
}
