import { curveLinear } from "@visx/curve";
import { describe, expect, it } from "vitest";

import {
  computeSeriesPathPoints,
  seriesPathFromPoints,
} from "./series-path-utils";

describe("series path gaps", () => {
  it("leaves non-numeric observations out of the generated line", () => {
    const points = computeSeriesPathPoints(
      [
        { date: "2026-08-01T00:00:00.000Z", value: 2 },
        { date: "2026-08-02T00:00:00.000Z", value: null },
        { date: "2026-08-03T00:00:00.000Z", value: 5 },
      ],
      (datum) => new Date(String(datum.date)),
      (date) => date.getUTCDate() * 10,
      (value) => 100 - value * 10,
      "value",
    );

    expect(points.map((point) => point.defined)).toEqual([true, false, true]);
    const path = seriesPathFromPoints(points, curveLinear);
    expect(path.match(/M/g)).toHaveLength(2);
    expect(path).not.toContain("20,0");
  });
});
