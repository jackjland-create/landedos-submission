import type { Metadata } from "next";
import { cookies } from "next/headers";
import { z } from "zod";

import { WalletMeasurementFlow } from "@/components/wallet-measurement-flow";
import { createAdminClient } from "@/lib/supabase/server";
import { anonymousSessionCookieName } from "@/lib/tracking/session.server";
import { readWalletMeasurementRuleContext } from "@/lib/wallet/measurement-context.server";
import { readHostedContinuation } from "@/lib/wallet/continuation.server";
import { getTrackedLinkApplicationOrigin } from "@/lib/tracking/signing.server";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Campaign measurement",
  robots: { follow: false, index: false },
};

export default async function MeasurePage({
  searchParams,
}: {
  searchParams: Promise<{ theme?: string | string[] }>;
}) {
  const query = await searchParams;
  const cookieStore = await cookies();
  const session = z
    .uuid()
    .safeParse(cookieStore.get(anonymousSessionCookieName)?.value);
  let context = null;
  let continuationHostname: string | undefined;

  if (session.success) {
    try {
      context = await readWalletMeasurementRuleContext(
        createAdminClient(),
        session.data,
      );
    } catch {
      // Fail closed. Consent recovery remains independently available in the
      // client so an existing participant can still unlink.
    }
  }

  // Optional onward navigation cannot prevent consent recovery or unlinking.
  // No query string can supply the onward destination.
  if (
    session.success &&
    context &&
    process.env.LANDED_SAME_COPY_REVISED_TRACKING !== "1"
  ) {
    try {
      const onward = await readHostedContinuation(
        createAdminClient(),
        session.data,
        getTrackedLinkApplicationOrigin(),
      );
      continuationHostname = onward?.hostname;
    } catch {
      // The destination is checked again on navigation. Never show an unverified URL.
    }
  }

  return (
    <WalletMeasurementFlow
      available={context !== null}
      initialTheme={query.theme === "dark" ? "dark" : "light"}
      receiverAddress={context?.receiverAddress}
      continuationHostname={continuationHostname}
    />
  );
}
