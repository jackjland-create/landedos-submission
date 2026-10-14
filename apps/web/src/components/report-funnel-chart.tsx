"use client";

import { useState } from "react";

import { FunnelChart, type FunnelStage } from "./charts/funnel-chart";
import {
  Legend,
  LegendDetail,
  LegendItemComponent,
  LegendLabel,
  LegendMarker,
  LegendValue,
  type LegendItemData,
} from "./charts/legend";

type FunnelValue = number | null;

export interface ReportFunnelChartProps {
  stages?: { label: string; value: number }[];
  activatedWallets: FunnelValue;
  qualifiedClicks: FunnelValue;
  qualifiedWallets: FunnelValue;
}

function formatInteger(value: number) {
  return new Intl.NumberFormat("en-GB").format(value);
}

function stageRate(value: number, previous: number | null) {
  if (previous === null) return "PRIOR STAGE NOT AVAILABLE";
  if (previous === 0) return "NO PRIOR ENTRY";
  return `${((value / previous) * 100).toFixed(1)}% OF PRIOR STAGE`;
}

function evidenceRows({
  activatedWallets,
  qualifiedClicks,
  qualifiedWallets,
}: ReportFunnelChartProps) {
  return [
    {
      label: "Qualified clicks",
      value: qualifiedClicks,
      detail: qualifiedClicks === null ? "SOURCE NOT AVAILABLE" : "ENTRY STAGE",
    },
    {
      label: "Qualified wallets",
      value: qualifiedWallets,
      detail:
        qualifiedWallets === null
          ? "SOURCE NOT AVAILABLE"
          : stageRate(qualifiedWallets, qualifiedClicks),
    },
    {
      label: "Activated wallets",
      value: activatedWallets,
      detail:
        activatedWallets === null
          ? "SOURCE NOT AVAILABLE"
          : stageRate(activatedWallets, qualifiedWallets),
    },
  ];
}

export function ReportFunnelChart(props: ReportFunnelChartProps) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const rows = props.stages
    ? props.stages.map((stage, i) => ({
        ...stage,
        detail:
          i === 0
            ? "ENTRY STAGE"
            : `${stageRate(stage.value, props.stages![i - 1]!.value)} · ${formatInteger(props.stages![i - 1]!.value - stage.value)} DROPPED OFF`,
      }))
    : evidenceRows(props);
  const values = rows.map((row) => row.value);
  const isComplete = values.every((value) => value !== null);
  const numericValues = values.filter(
    (value): value is number => value !== null,
  );
  const isOrdered =
    isComplete &&
    numericValues.every((value) => Number.isSafeInteger(value) && value >= 0) &&
    numericValues.every(
      (value, index) => index === 0 || value <= numericValues[index - 1]!,
    );
  const hasObservedEntry = isOrdered && numericValues[0]! > 0;
  const stageData: FunnelStage[] = rows.map((row) => ({
    color: "var(--report-funnel-observed)",
    displayValue:
      row.value === null ? "NOT AVAILABLE" : formatInteger(row.value),
    label: row.label,
    value: row.value ?? 0,
  }));
  const legendItems: LegendItemData[] = rows.map((row) => ({
    color: "var(--report-funnel-observed)",
    detail: row.detail,
    displayValue:
      row.value === null ? "NOT AVAILABLE" : formatInteger(row.value),
    label: row.label,
    value: row.value ?? 0,
  }));

  return (
    <div className="report-funnel-chart">
      {hasObservedEntry ? (
        <div
          aria-label={
            props.stages
              ? "Synthetic campaign funnel"
              : "Observed campaign funnel"
          }
          className="report-funnel-chart__visual"
          data-testid="report-funnel-visual"
          role="img"
        >
          <FunnelChart
            className="report-funnel-chart__desktop-visual"
            color="var(--report-funnel-observed)"
            data={stageData}
            hoveredIndex={hoveredIndex}
            layers={3}
            onHoverChange={setHoveredIndex}
          />
          <FunnelChart
            className="report-funnel-chart__mobile-visual"
            color="var(--report-funnel-observed)"
            data={stageData}
            hoveredIndex={hoveredIndex}
            layers={3}
            onHoverChange={setHoveredIndex}
            orientation="vertical"
          />
        </div>
      ) : (
        <div className="report-funnel-chart__boundary" role="status">
          <strong>
            {!isComplete
              ? "PARTIAL EVIDENCE"
              : !isOrdered
                ? "RETAINED STAGES REQUIRE REVIEW"
                : "ZERO OBSERVED ENTRY"}
          </strong>
          <p>
            {!isComplete
              ? "The funnel remains unshaped until all three retained stages are available."
              : !isOrdered
                ? "Exact retained values are shown below; no misleading funnel shape has been drawn."
                : "No qualified click entered this issued window. Zero is retained as an observed result, not treated as missing."}
          </p>
        </div>
      )}

      <Legend
        hoveredIndex={hoveredIndex}
        items={legendItems}
        onHoverChange={setHoveredIndex}
      >
        <LegendItemComponent>
          <LegendMarker />
          <LegendLabel />
          <LegendValue />
          <LegendDetail />
        </LegendItemComponent>
      </Legend>

      <div className="report-funnel-chart__retention">
        <span>04</span>
        <div>
          <strong>Retained wallets</strong>
          <small>
            {props.stages
              ? "Retention is not measured in this synthetic campaign"
              : "Requires a retained-wallet source in this issued version"}
          </small>
        </div>
        <b>NOT AVAILABLE</b>
      </div>
    </div>
  );
}
