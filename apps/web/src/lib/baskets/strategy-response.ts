import { NextResponse } from "next/server";
import { logError } from "@/lib/observability";

export function strategyJson(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "private, no-store" },
  });
}

export function strategyFailure(error: unknown, projectId: string) {
  const code =
    error && typeof error === "object" && "code" in error
      ? error.code
      : undefined;
  if (code === "42501")
    return strategyJson(
      { message: "Basket changes require campaign manager access." },
      403,
    );
  if (code === "40001" || code === "PT409")
    return strategyJson(
      {
        message:
          "This basket has newer changes. Reload it before saving again.",
      },
      409,
    );
  if (code === "55000")
    return strategyJson(
      {
        message:
          "This plan cannot be changed here. Keep the approved plan and start a new basket.",
      },
      409,
    );
  if (["22023", "23514", "23503"].includes(String(code)))
    return strategyJson(
      {
        message:
          "Check the basket details and select creators and a conversion definition from this project.",
      },
      400,
    );
  const reference = logError({
    event: "basket_strategy_failed",
    error,
    projectId,
  });
  return strategyJson(
    {
      message: "Basket strategy could not be saved or loaded. Try again.",
      reference,
    },
    500,
  );
}
