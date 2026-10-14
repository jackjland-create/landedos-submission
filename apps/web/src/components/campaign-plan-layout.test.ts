import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, it } from "vitest";

// Source-level guard for the approved-header regression reported on 9 October.
// These assertions do not substitute for integrated viewport screenshots.
const css = readFileSync(
  resolve("src/components/campaign-plan.module.css"),
  "utf8",
);

it("uses one comparable baseline/target size with a quieter saved objective", () => {
  expect(css).toMatch(/\.outcomeValues dd\s*\{[^}]*font: 600 20px/);
  expect(css).toMatch(/\.outcomeObjective\s*\{[^}]*font: 600 16px/);
  expect(css).not.toContain(".outcomeTarget");
});

it("keeps drawer fields in one track and lets saved terms wrap", () => {
  expect(css).toMatch(
    /\.drawer :global\(\.compensation-line__grid\)\s*\{[^}]*grid-template-columns: minmax\(0, 1fr\)/,
  );
  expect(css).toMatch(
    /\.termsSummary dd\s*\{[^}]*white-space: pre-wrap;[^}]*overflow-wrap: anywhere/,
  );
  expect(css).toMatch(
    /:global\(\.app-shell\):has\(\.root:not\(\[data-plan-panel="none"\]\)\)\s*:global\(\.guided-demo-launcher\)\s*\{\s*display: none/,
  );
});

it("centres setup dialogs and switches them to full-screen on small screens", () => {
  expect(css).toMatch(
    /\.drawer\.planDialog\s*\{[^}]*width: min\(800px, calc\(100vw - 48px\)\);[^}]*max-height: calc\(100dvh - 48px\)/,
  );
  expect(css).toMatch(
    /\.drawer\.planDialog\s*\{[^}]*inset: 0;[^}]*height: 100dvh/,
  );
  expect(css).toMatch(
    /\.termsOverview,\s*\.termsSummary \.termsDetails\s*\{\s*grid-template-columns: minmax\(0, 1fr\)/,
  );
});

it("bounds both header tracks so approval text cannot collapse the plan title", () => {
  const header = css.match(/\.top\s*\{([^}]+)\}/)?.[1];
  expect(header).toContain(
    "grid-template-columns: minmax(0, 3fr) minmax(0, 2fr)",
  );
  const action = css.match(/\.topAction\s*\{([^}]+)\}/)?.[1];
  expect(action).toContain("min-width: 0");
  expect(action).toContain("width: 100%");
  const note = css.match(/\.heroNoteText\s*\{([^}]+)\}/)?.[1];
  expect(note).toContain("display: block");
});

it("stacks the header at compact desktop widths, before the mobile breakpoint", () => {
  const compact = css
    .split("@media (max-width: 1180px)")[1]
    ?.split("@media")[0];
  expect(compact).toMatch(
    /\.top\s*\{[^}]*grid-template-columns: minmax\(0, 1fr\)/,
  );
  expect(compact).toMatch(/\.topAction\s*\{[^}]*justify-items: start/);
  expect(compact).toMatch(/\.heroNoteText\s*\{[^}]*text-align: left/);
});
