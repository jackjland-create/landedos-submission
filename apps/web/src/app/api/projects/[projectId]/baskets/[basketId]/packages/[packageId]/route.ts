import {
  decimalToBaseUnits,
  savePackageCommercialTermsInputSchema,
} from "@landed/contracts";
import { BasketQueryError, getProjectBasket } from "@landed/db";
import { NextResponse } from "next/server";
import { z } from "zod";

import { project } from "@/lib/demo-data";
import { logError } from "@/lib/observability";
import { createClient } from "@/lib/supabase/server";

type RouteContext = {
  params: Promise<{
    projectId: string;
    basketId: string;
    packageId: string;
  }>;
};

function privateJson(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: {
      "Cache-Control": "private, no-store",
    },
  });
}

export async function PUT(request: Request, context: RouteContext) {
  const { projectId, basketId, packageId } = await context.params;
  const parsedBody = savePackageCommercialTermsInputSchema.safeParse(
    await request.json().catch(() => null),
  );

  if (
    projectId !== project.id ||
    !z.uuid().safeParse(basketId).success ||
    !z.uuid().safeParse(packageId).success
  ) {
    return privateJson({ message: "Package terms were not valid." }, 400);
  }

  if (!parsedBody.success) {
    return privateJson(
      {
        message:
          parsedBody.error.issues[0]?.message ??
          "Package terms were not valid.",
      },
      400,
    );
  }

  let compensationLines;

  try {
    compensationLines = parsedBody.data.compensationLines.map((line) =>
      line.assetType === "cash"
        ? {
            assetType: "cash" as const,
            model: line.model,
            variableUnit: line.variableUnit,
            amountMinor: decimalToBaseUnits(line.amount, 2),
            currencyCode: line.currencyCode,
          }
        : {
            assetType: line.assetType,
            model: line.model,
            variableUnit: line.variableUnit,
            tokenMint: line.tokenMint,
            tokenAmountRaw: decimalToBaseUnits(line.amount, line.tokenDecimals),
            tokenDecimals: line.tokenDecimals,
            unitPriceUsd: line.unitPriceUsd,
            priceSource: line.priceSource,
            valuedAt: line.valuedAt,
          },
    );
  } catch (error) {
    return privateJson(
      {
        message:
          error instanceof Error
            ? error.message
            : "Package terms were not valid.",
      },
      400,
    );
  }

  try {
    const client = await createClient();
    const { error } = await client.rpc(
      parsedBody.data.commercialDetail
        ? "save_package_commercial_detail"
        : "update_package_commercial_terms",
      {
        target_project_id: project.databaseId,
        target_basket_id: basketId,
        target_package_id: packageId,
        next_package_label: parsedBody.data.packageLabel,
        next_deliverable_summary: parsedBody.data.deliverableSummary,
        next_compensation_lines: compensationLines,
        ...(parsedBody.data.commercialDetail
          ? {
              next_detail: parsedBody.data.commercialDetail,
              expected_detail_revision: parsedBody.data.expectedDetailRevision,
            }
          : {}),
      },
    );

    if (error) {
      if (["40001", "PT409"].includes(error.code))
        return privateJson(
          {
            message:
              "This package changed. Reload to review the latest terms before saving.",
          },
          409,
        );
      if (error.code === "55000")
        return privateJson(
          {
            message:
              "This plan is already approved. Use a new basket for changed terms.",
          },
          409,
        );
      if (error.code === "42501") {
        return privateJson(
          { message: "Commercial changes require campaign manager access." },
          403,
        );
      }

      if (error.code === "P0002") {
        return privateJson({ message: "Package was not found." }, 404);
      }

      if (["22003", "22007", "22023", "22P02", "23514"].includes(error.code)) {
        return privateJson({ message: "Package terms were not valid." }, 400);
      }

      const reference = logError({
        event: "package_terms_update_failed",
        error,
        projectId,
      });

      return privateJson(
        { message: "Package terms could not be saved.", reference },
        500,
      );
    }

    const basket = await getProjectBasket(client, project.databaseId, basketId);
    const savedPackage = basket?.packages.find(({ id }) => id === packageId);

    if (!savedPackage) {
      return privateJson({ message: "Package was not found." }, 404);
    }

    return privateJson({ package: savedPackage });
  } catch (error) {
    if (error instanceof BasketQueryError && error.code === "42501") {
      return privateJson(
        { message: "Commercial changes require campaign manager access." },
        403,
      );
    }

    const reference = logError({
      event: "package_terms_update_failed",
      error,
      projectId,
    });

    return privateJson(
      { message: "Package terms could not be saved.", reference },
      500,
    );
  }
}
