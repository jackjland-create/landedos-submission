import {
  buildReportVisualFixture,
  type ReportVisualState,
} from "./visual-fixtures";
import { clarityDate, clarityMetrics } from "./clarity";

export const overviewPersonas = [
  "returning",
  "new",
  "analyst",
  "creator",
] as const;
export type OverviewPersona = (typeof overviewPersonas)[number];
export function isOverviewPersona(value: string): value is OverviewPersona {
  return overviewPersonas.some((item) => item === value);
}

/** BRD-04 sanitized presentation fixtures, never an authorization decision. */
export function overviewReference(
  persona: OverviewPersona,
  state: ReportVisualState,
) {
  if (state !== "ready" && state !== "partial" && state !== "stale")
    return null;
  if (persona === "new") return { kind: "new" as const };
  if (persona === "creator")
    return {
      kind: "creator" as const,
      name: "DeFi After Dark",
      campaign: "Helios launch rehearsal",
      brief:
        "Introduce Helios to mobile-first founders. Explain the product clearly, include the supplied disclosure and do not promise financial returns.",
      deliverables: ["One host-read integration", "One founder interview"],
      offer: "£2,400.00 GBP fixed fee",
    };
  const fixture = buildReportVisualFixture(state);
  const version = fixture.report.versions.find((item) => item.version === 2)!;
  return {
    kind: "operator" as const,
    readOnly: persona === "analyst",
    metrics: clarityMetrics(version),
    campaign: "Helios Mobile Roster",
    issued: clarityDate(version.issuedAt),
    through: state === "partial" ? "not available" : "13 Aug 2026, 11:55 UTC",
    creators: ["DeFi After Dark", "Maya / Chain Mode", "Mint Condition"],
  };
}
export type OverviewReference = ReturnType<typeof overviewReference>;

export function validBriefText(value: string) {
  return value.trim().length > 0;
}
export function validBudget(value: string) {
  return /^\d+(\.\d{1,2})?$/.test(value) && BigInt(value.replace(".", "")) > 0n;
}
