"use client";

import { Background } from "./charts/background";
import { ComposedChart } from "./charts/composed-chart";
import { Line } from "./charts/line";
import { SeriesBar } from "./charts/series-bar";
import { ChartTooltip } from "./charts/tooltip/chart-tooltip";
import { TooltipContent } from "./charts/tooltip/tooltip-content";
import { XAxis } from "./charts/x-axis";
import { YAxis } from "./charts/y-axis";

export type ReportSnapshotChartPoint = {
  activatedPeriodState?: "complete" | "partial";
  activatedWallets: number | null;
  activatedWalletsExact?: string | null;
  date: string;
  label?: string;
  qualifiedPeriodState?: "complete" | "partial";
  qualifiedWallets: number | null;
  qualifiedWalletsExact?: string | null;
  version?: number;
};

export type ReportSnapshotBenchmark = {
  kind: "approved_target" | "portfolio_cohort";
  label: string;
  metric: "qualified_wallets" | "activated_wallets";
  sourceLabel: string;
  value: number | null;
  valueDecimal: string;
};

function formatInteger(value: number) {
  return new Intl.NumberFormat("en-GB").format(value);
}

function formatAxisInteger(value: number) {
  return value === 0 ? "" : formatInteger(value);
}

function formatSnapshotDate(value: string) {
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    timeZone: "UTC",
    year: "numeric",
  }).format(new Date(value));
}

function exactCount(exact: string | null | undefined, plotted: number | null) {
  if (exact !== null && exact !== undefined) {
    return new Intl.NumberFormat("en-GB").format(BigInt(exact));
  }
  return plotted === null ? "Not available" : formatInteger(plotted);
}

function tooltipRows(point: Record<string, unknown>) {
  const qualified = point.qualifiedWallets;
  const activated = point.activatedWallets;

  return [
    {
      color: "var(--report-chart-qualified)",
      label: "Qualified wallets",
      value: exactCount(
        typeof point.qualifiedWalletsExact === "string"
          ? point.qualifiedWalletsExact
          : null,
        typeof qualified === "number" ? qualified : null,
      ),
    },
    {
      color: "var(--report-chart-activated)",
      label: "Activated wallets",
      value: exactCount(
        typeof point.activatedWalletsExact === "string"
          ? point.activatedWalletsExact
          : null,
        typeof activated === "number" ? activated : null,
      ),
    },
  ];
}

export function ReportSnapshotChart({
  animate = true,
  edgeLabelInset = 12,
  benchmarks = [],
  compact = false,
  points,
  revealSignature,
  visibleSeries = "both",
}: {
  animate?: boolean;
  edgeLabelInset?: number;
  benchmarks?: ReportSnapshotBenchmark[];
  compact?: boolean;
  points: ReportSnapshotChartPoint[];
  revealSignature: string;
  visibleSeries?: "both" | "qualified" | "activated";
}) {
  if (points.length < 2) {
    return (
      <div className="report-snapshot-chart__empty" role="status">
        <strong>
          {points.length ? "Your first reporting point" : "No chart data yet"}
        </strong>
        <p>
          {points.length
            ? "Your result is saved. A trend needs at least two comparable reporting points; there is nothing else to approve here."
            : "There are no saved observations to plot. Missing data is not treated as zero."}
        </p>
      </div>
    );
  }

  const orderedPoints = [...points].sort((left, right) => {
    const dateDifference = Date.parse(left.date) - Date.parse(right.date);
    return dateDifference !== 0
      ? dateDifference
      : (left.label ?? String(left.version)).localeCompare(
          right.label ?? String(right.version),
        );
  });
  const chartPoints = orderedPoints.map((point) => {
    const references = Object.fromEntries(
      benchmarks.flatMap((benchmark) =>
        benchmark.value === null
          ? []
          : [[`${benchmark.metric}:${benchmark.kind}`, benchmark.value]],
      ),
    );
    return { ...point, ...references };
  });
  const availableQualified = orderedPoints.filter(
    (point) =>
      point.qualifiedWalletsExact !== null &&
      (point.qualifiedWalletsExact !== undefined ||
        point.qualifiedWallets !== null),
  ).length;
  const availableActivated = orderedPoints.filter(
    (point) =>
      point.activatedWalletsExact !== null &&
      (point.activatedWalletsExact !== undefined ||
        point.activatedWallets !== null),
  ).length;
  const issuedVersionSeries = orderedPoints.every(
    (point) => typeof point.version === "number",
  );
  const partialStartIndex = orderedPoints.findIndex(
    (point, index) =>
      point.activatedPeriodState === "partial" &&
      orderedPoints
        .slice(index)
        .every((candidate) => candidate.activatedPeriodState === "partial"),
  );

  return (
    <figure
      aria-describedby="report-snapshot-chart-description"
      aria-labelledby="report-snapshot-chart-title"
      className="report-snapshot-chart"
    >
      <figcaption className="report-snapshot-chart__caption">
        <div>
          <span id="report-snapshot-chart-title">WALLET OUTCOMES</span>
          <strong>
            {issuedVersionSeries
              ? "Issued evidence over time"
              : "Daily cumulative evidence"}
          </strong>
        </div>
        <div
          aria-label="Chart legend"
          className="report-snapshot-chart__legend"
        >
          {visibleSeries !== "activated" && (
            <span className="is-qualified">Qualified wallets</span>
          )}
          {visibleSeries !== "qualified" && (
            <span className="is-activated">Activated wallets</span>
          )}
        </div>
      </figcaption>
      <p
        className="report-snapshot-chart__summary"
        id="report-snapshot-chart-description"
      >
        {orderedPoints.length}{" "}
        {issuedVersionSeries
          ? "immutable report versions"
          : "retained observations"}
        . Qualified-wallet data is available in {availableQualified};
        activated-wallet data is available in {availableActivated}. Missing
        observations remain blank
        {issuedVersionSeries ? "." : "; partial periods are labelled."}
      </p>
      <div aria-hidden="true" className="report-snapshot-chart__visual">
        <ComposedChart
          animationDuration={animate ? 800 : 0}
          aspectRatio="2.8 / 1"
          barSize={18}
          data={chartPoints}
          margin={{
            bottom: compact ? 36 : 20,
            left: 32,
            right: edgeLabelInset,
            top: 6,
          }}
          maxBarSize={28}
          revealSignature={revealSignature}
          xDataKey="date"
        >
          <Background
            color="var(--report-chart-grid)"
            opacity={0.8}
            pattern="dots"
            radius={1}
            scale={1.25}
          />
          {visibleSeries !== "activated" && (
            <SeriesBar
              animate={animate}
              dataKey="qualifiedWallets"
              fill="var(--report-chart-qualified)"
              radius={4}
            />
          )}
          {visibleSeries !== "qualified" && (
            <Line
              animate={animate}
              dashFromIndex={
                partialStartIndex >= 0 ? partialStartIndex : undefined
              }
              dataKey="activatedWallets"
              fadeEdges={false}
              markers={{
                fill: "var(--report-chart-activated)",
                ringGap: 1,
                radius: 4,
                stroke: "var(--report-chart-surface)",
                strokeWidth: 2,
              }}
              showMarkers
              stroke="var(--report-chart-activated)"
              strokeWidth={3}
            />
          )}
          {benchmarks
            .filter((benchmark) => benchmark.value !== null)
            .map((benchmark) => (
              <Line
                animate={false}
                dashArray="4,4"
                dashFromIndex={0}
                dataKey={`${benchmark.metric}:${benchmark.kind}`}
                fadeEdges={false}
                key={`${benchmark.metric}:${benchmark.kind}`}
                showHighlight={false}
                stroke={
                  benchmark.kind === "approved_target"
                    ? "var(--action)"
                    : "var(--intelligence)"
                }
                strokeWidth={1.5}
              />
            ))}
          <ChartTooltip
            content={({ point }) => (
              <TooltipContent
                rows={tooltipRows(point).filter(
                  (_, index) =>
                    visibleSeries === "both" ||
                    (visibleSeries === "qualified" ? index === 0 : index === 1),
                )}
                title={`${point.label ?? `V${String(point.version).padStart(2, "0")}`} / ${formatSnapshotDate(String(point.date))}`}
              />
            )}
            dotColor={(_point, line) => {
              if (line.dataKey === "qualifiedWallets") {
                return "var(--report-chart-qualified)";
              }
              if (line.dataKey === "activatedWallets") {
                return "var(--report-chart-activated)";
              }
              return line.dataKey.endsWith(":approved_target")
                ? "var(--action)"
                : "var(--intelligence)";
            }}
            dotVariant="ring"
            indicatorColor="var(--report-chart-crosshair)"
            showDatePill={false}
          />
          <XAxis numTicks={Math.min(6, orderedPoints.length)} />
          <YAxis formatValue={formatAxisInteger} numTicks={4} />
        </ComposedChart>
      </div>
      {benchmarks.length > 0 ? (
        <ul
          aria-label="Retained chart references"
          className="report-snapshot-chart__references"
        >
          {benchmarks.map((benchmark) => (
            <li
              className={`is-${benchmark.kind}`}
              key={`${benchmark.metric}:${benchmark.kind}`}
            >
              <b>{benchmark.label}</b>
              <span>
                {benchmark.metric.replaceAll("_", " ")} ·{" "}
                {benchmark.valueDecimal}
                {" / "}
                {benchmark.sourceLabel}
                {benchmark.value === null
                  ? " / exact value retained; outside chart scale"
                  : ""}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      <details
        className="report-snapshot-chart__details"
        open={compact ? undefined : true}
      >
        <summary hidden={!compact}>
          Exact observations & period coverage
        </summary>
        <ol
          aria-label={
            issuedVersionSeries
              ? "Issued report values by version"
              : "Retained daily report values"
          }
          className="report-snapshot-chart__points"
        >
          {orderedPoints.map((point) => {
            const qualified = exactCount(
              point.qualifiedWalletsExact,
              point.qualifiedWallets,
            ).toLowerCase();
            const activated = exactCount(
              point.activatedWalletsExact,
              point.activatedWallets,
            ).toLowerCase();
            const pointLabel =
              point.label ?? `V${String(point.version).padStart(2, "0")}`;
            const qualifiedState =
              point.qualifiedPeriodState === "partial" ? " PARTIAL" : "";
            const activatedState =
              point.activatedPeriodState === "partial" ? " PARTIAL" : "";
            const hasPartial = Boolean(qualifiedState || activatedState);
            const label = issuedVersionSeries
              ? `Version ${point.version}, ${formatSnapshotDate(point.date)}. Qualified wallets: ${qualified}. Activated wallets: ${activated}.`
              : `${pointLabel}, ${formatSnapshotDate(point.date)}. Qualified wallets: ${qualified}, ${point.qualifiedPeriodState ?? "not retained"} period. Activated wallets: ${activated}, ${point.activatedPeriodState ?? "not retained"} period.`;

            return (
              <li key={`${pointLabel}-${point.date}`}>
                <span
                  aria-label={label}
                  className={hasPartial ? "has-partial" : undefined}
                  tabIndex={0}
                  title={label}
                >
                  <b>{pointLabel}</b>
                  <span>
                    Q {qualified}
                    {qualifiedState} · A {activated}
                    {activatedState}
                  </span>
                </span>
              </li>
            );
          })}
        </ol>
      </details>
    </figure>
  );
}
