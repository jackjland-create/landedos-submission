import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { WalletMeasurementFlow } from "@/components/wallet-measurement-flow";
import { reportVisualFixturesEnabled } from "@/lib/reports/visual-fixtures";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Connected wallet measurement review",
  robots: { follow: false, index: false },
};

export default async function WalletMeasurementVisualPage({
  searchParams,
}: {
  searchParams: Promise<{ theme?: string | string[] }>;
}) {
  if (
    !reportVisualFixturesEnabled({
      explicitFlag: process.env.ENABLE_VISUAL_FIXTURES,
      nodeEnv: process.env.NODE_ENV,
      vercelEnv: process.env.VERCEL_ENV,
    })
  ) {
    notFound();
  }
  const query = await searchParams;

  return (
    <WalletMeasurementFlow
      available
      initialTheme={query.theme === "dark" ? "dark" : "light"}
      receiverAddress="Vote111111111111111111111111111111111111111"
    />
  );
}
