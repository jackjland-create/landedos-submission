import { submissionPage } from "@/lib/submission-page.server";
import {
  BasketQueryError,
  getProjectBasket,
  getSavedBasketStrategy,
  getProjectConversionRule,
} from "@landed/db";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { z } from "zod";

import { AppShell } from "@/components/app-shell";
import {
  BasketBuilder,
  BasketBuilderPermission,
} from "@/components/basket-builder";
import { project } from "@/lib/demo-data";
import { createClient } from "@/lib/supabase/server";
import { basketTimingEnabled } from "@/lib/baskets/timing-enabled";
import { browserCampaignEnabled } from "@/lib/baskets/browser-campaign-runtime.server";
import {
  BrowserCommercialRecovery,
  LocalDevnetCommercialRecovery,
} from "@/components/browser-commercial-review";
import { localDevnetRehearsalEnabled } from "@/lib/attribution/devnet-campaign-runtime.server";
import {
  basketMeasurementChoices,
  type BasketMeasurementChoices,
} from "@/lib/baskets/measurement-choices";

type PageProps = {
  searchParams?: Promise<{ theme?: string | string[] }>;
  params: Promise<{
    projectId: string;
    basketId: string;
  }>;
};

export const metadata: Metadata = {
  title: "Campaign plan",
};

async function loadBasket(basketId: string) {
  const client = await createClient();

  try {
    const basket = await getProjectBasket(client, project.databaseId, basketId);

    if (basket) {
      const { data: canManage, error: permissionError } = await client.rpc(
        "can_manage_project",
        {
          target_project_id: project.databaseId,
          target_workspace_id: basket.workspaceId,
        },
      );

      if (permissionError) {
        throw new BasketQueryError(
          "Basket approval access could not be prepared.",
          permissionError.code,
        );
      }

      const timingEnabled =
        basketTimingEnabled(process.env) &&
        (await getSavedBasketStrategy(client, project.databaseId, basketId))
          ?.persistence === "saved";
      const owner = timingEnabled ? await client.auth.getUser() : null;
      if (timingEnabled && (owner?.error || !owner?.data.user))
        return { kind: "permission" as const };
      let measurementChoices: BasketMeasurementChoices | undefined;
      if (timingEnabled) {
        try {
          measurementChoices = basketMeasurementChoices(
            await getProjectConversionRule(client, project.databaseId),
            project.databaseId,
            basket.workspaceId,
          );
        } catch {
          measurementChoices = { kind: "unavailable" };
        }
      }
      return {
        kind: "ready" as const,
        basket,
        canManage: canManage === true,
        timingEnabled,
        strategyOwnerId: owner?.data.user?.id,
        measurementChoices,
      };
    }

    const { data: readableProject, error } = await client
      .from("projects")
      .select("id")
      .eq("id", project.databaseId)
      .maybeSingle();

    if (error?.code === "42501" || !readableProject) {
      return { kind: "permission" as const };
    }

    notFound();
  } catch (error) {
    if (error instanceof BasketQueryError && error.code === "42501") {
      return { kind: "permission" as const };
    }

    throw error;
  }
}

export default async function BasketPage({ params, searchParams }: PageProps) {
  const { projectId, basketId } = await params;
  const theme = (await searchParams)?.theme === "dark" ? "dark" : "light";
  if (projectId === "demo") { const preview=await submissionPage("baskets", await searchParams, basketId); if(preview) return preview; }


  if (projectId !== project.id || !z.uuid().safeParse(basketId).success) {
    notFound();
  }

  const basketState = await loadBasket(basketId);
  const commercialMode = browserCampaignEnabled()
    ? "browser"
    : localDevnetRehearsalEnabled()
      ? "devnet"
      : null;

  return (
    <AppShell
      activeSection="baskets"
      projectId={projectId}
      contentAppearance="application"
      theme={theme}
    >
      {basketState.kind === "ready" ? (
        <>
          {basketState.canManage && commercialMode === "browser" && (
            <BrowserCommercialRecovery
              theme={theme}
              basketId={basketId}
              projectId={projectId}
            />
          )}
          {basketState.canManage && commercialMode === "devnet" && (
            <LocalDevnetCommercialRecovery
              theme={theme}
              basketId={basketId}
              projectId={projectId}
            />
          )}
          <BasketBuilder
            theme={theme}
            localCommercialEnabled={commercialMode !== null}
            localCommercialMode={commercialMode ?? "browser"}
            key={`${basketState.basket.id}:${basketState.strategyOwnerId ?? "legacy"}`}
            basket={basketState.basket}
            canManage={basketState.canManage}
            timingEnabled={basketState.timingEnabled}
            strategyOwnerId={basketState.strategyOwnerId}
            measurementChoices={basketState.measurementChoices}
          />
        </>
      ) : (
        <BasketBuilderPermission theme={theme} />
      )}
    </AppShell>
  );
}
