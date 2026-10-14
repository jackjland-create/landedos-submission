import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import styles from "./campaign-timing-fields.module.css";
import {
  CampaignTimingFields,
  CampaignTimingSummary,
} from "./campaign-timing-fields";
import {
  fieldsToTiming,
  timingFields,
  timingToFields,
} from "@/lib/baskets/timing-fields";

const timing = {
  schemaVersion: 1 as const,
  flight: {
    startedAt: "2026-09-14T09:00:00.000001Z",
    endedAt: "2026-10-05T17:00:00Z",
  },
  measurement: {
    startedAt: "2026-09-14T00:00:00Z",
    endedAt: "2026-10-12T17:00:00Z",
  },
};
afterEach(cleanup);

describe("BSK-09 inline campaign dates", () => {
  it("labels every field and uses explicit UTC without inferred dates", () => {
    render(
      <CampaignTimingFields value={timingToFields(null)} onChange={vi.fn()} />,
    );
    for (const label of [
      "Activity starts (UTC)",
      "Activity ends (UTC)",
      "Measurement starts (UTC)",
      "Measurement ends (UTC)",
    ])
      expect(screen.getByLabelText(label)).toHaveValue("");
    expect(
      screen.getByText(/Choose Save dates to keep your changes/),
    ).toBeInTheDocument();
  });
  it("reports only the edited field and has no persistence side effects", () => {
    const onChange = vi.fn();
    render(
      <CampaignTimingFields
        value={timingToFields(timing)}
        onChange={onChange}
      />,
    );
    fireEvent.change(screen.getByLabelText("Activity ends (UTC)"), {
      target: { value: "2026-10-06T17:00:00" },
    });
    expect(onChange).toHaveBeenCalledExactlyOnceWith(
      "flightEnd",
      "2026-10-06T17:00",
    );
  });
  it("supports permission and pending states with disabled native controls", () => {
    render(
      <CampaignTimingFields
        disabled
        value={timingToFields(timing)}
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByLabelText("Activity starts (UTC)")).toBeDisabled();
  });
  it("associates validation guidance with its field", () => {
    render(
      <CampaignTimingFields
        value={timingToFields(timing)}
        onChange={vi.fn()}
        errors={{ measurementEnd: "Measurement must cover campaign activity." }}
      />,
    );
    expect(screen.getByLabelText("Measurement ends (UTC)")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
    expect(
      screen.getByLabelText("Measurement ends (UTC)"),
    ).toHaveAccessibleDescription(/Measurement must cover/);
  });
  it("shows separate activity and measurement boundaries under review", () => {
    render(<CampaignTimingSummary timing={timing} />);
    expect(
      screen.getByRole("region", { name: "Campaign dates under review" }),
    ).toHaveTextContent("12 Oct 2026");
    expect(
      screen.getByText(/does not extend creator obligations/),
    ).toBeInTheDocument();
    expect(screen.getByText(/09:00:00.000001/)).toBeInTheDocument();
  });
  it("captures staged component states for responsive audit when requested", () => {
    if (process.env.CAPTURE_TIMING !== "1") return;
    const directory = resolve(
      process.cwd(),
      "../../docs/sprint-8/evidence/bsk09-timing-controls",
    );
    mkdirSync(directory, { recursive: true });
    const globalCss = readFileSync(
      resolve(process.cwd(), "src/app/globals.css"),
      "utf8",
    );
    const moduleCss = readFileSync(
      resolve(
        process.cwd(),
        "src/components/campaign-timing-fields.module.css",
      ),
      "utf8",
    ).replace(/\.([a-zA-Z]+)\b/g, (match, key: string) =>
      styles[key] ? `.${styles[key]}` : match,
    );
    for (const state of [
      "ready",
      "empty",
      "error",
      "permission",
      "loading",
    ] as const) {
      const view = render(
        <main>
          <h1>Campaign planning</h1>
          <p>Staged component audit. No save or approval is enabled.</p>
          {state === "loading" ? (
            <p role="status">Loading saved dates…</p>
          ) : null}
          {state === "permission" ? (
            <p>Campaign manager access is required to change these dates.</p>
          ) : null}
          <CampaignTimingFields
            value={timingToFields(
              state === "empty" || state === "loading"
                ? null
                : state === "error"
                  ? {
                      ...timing,
                      measurement: {
                        ...timing.measurement,
                        endedAt: "2026-10-01T17:00:00Z",
                      },
                    }
                  : timing,
            )}
            disabled={state === "permission" || state === "loading"}
            onChange={vi.fn()}
            errors={
              state === "error"
                ? {
                    measurementEnd:
                      "Measurement must cover campaign activity. Choose a later end time.",
                  }
                : {}
            }
          />
          {state === "ready" ? <CampaignTimingSummary timing={timing} /> : null}
        </main>,
      );
      writeFileSync(
        resolve(directory, `${state}.html`),
        `<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width, initial-scale=1"><title>Campaign dates component audit</title><style>${globalCss}\n${moduleCss}\nmain {padding:24px;max-width:1200px;margin:auto} main>section {margin-top:24px}</style></head><body>${view.container.innerHTML}</body></html>`,
      );
      view.unmount();
    }
  });
  it("retains untouched precision and never applies the browser timezone", () => {
    expect(fieldsToTiming(timingToFields(timing), timing)).toEqual({
      ok: true,
      timing,
    });
    const fields = {
      ...timingToFields(timing),
      flightStart: "2026-09-15T09:30",
    };
    const result = fieldsToTiming(fields, timing);
    expect(result.ok && result.timing.flight.startedAt).toBe(
      "2026-09-15T09:30:00Z",
    );
  });
  it("preserves precision when a native input omits zero seconds", () => {
    expect(
      fieldsToTiming(
        { ...timingToFields(timing), flightStart: "2026-09-14T09:00" },
        timing,
      ),
    ).toEqual({ ok: true, timing });
  });
  it.each(timingFields)("reports missing %s without defaults", (key) => {
    const result = fieldsToTiming(
      { ...timingToFields(timing), [key]: "" },
      timing,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[key]).toBeTruthy();
  });
  it("rejects impossible dates and measurement ending before activity", () => {
    expect(
      fieldsToTiming(
        { ...timingToFields(timing), flightEnd: "2026-02-30T17:00" },
        timing,
      ).ok,
    ).toBe(false);
    const result = fieldsToTiming(
      { ...timingToFields(timing), measurementEnd: "2026-10-01T17:00" },
      timing,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.measurementEnd).toMatch(/cover/);
  });
});
