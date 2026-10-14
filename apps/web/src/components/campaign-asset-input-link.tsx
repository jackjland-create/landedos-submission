"use client";

import type { ReactNode } from "react";
import { usePathname, useSearchParams } from "next/navigation";

/** CMP-03: cross-view asset navigation only; the destination owns all controls. */
export function CampaignAssetInputLink({
  campaignPath,
  view,
  controlId,
  children,
}: {
  campaignPath: string;
  view: "content" | "delivery" | "tracking";
  controlId: string;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const search = useSearchParams();
  // Retain this campaign's current theme/review/demo context, never borrow it
  // from a different campaign or an offline preview route. Only view changes.
  const query = new URLSearchParams(
    pathname === campaignPath ? search?.toString() : undefined,
  );
  query.set("view", view);
  return <a href={`${campaignPath}?${query}#${controlId}`}>{children}</a>;
}
