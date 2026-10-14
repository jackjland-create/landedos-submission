import { describe, expect, it } from "vitest";
import {
  earliestReviewDeadline,
  reviewTime,
  utcFieldInstant,
} from "./review-time";

describe("explicit review timing", () => {
  const expiry = "2026-10-08T02:00:43.719Z";
  const cutoff = "2026-10-08T01:58:43.719Z";
  it("uses the earlier decision boundary, never extends a shorter review", () => {
    expect(earliestReviewDeadline(expiry, cutoff)).toBe(cutoff);
    expect(earliestReviewDeadline(cutoff, expiry)).toBe(cutoff);
    expect(earliestReviewDeadline(expiry)).toBe(expiry);
    expect(earliestReviewDeadline(expiry, null)).toBeNull();
    expect(earliestReviewDeadline(expiry, "bad")).toBeNull();
    expect(earliestReviewDeadline("bad", cutoff)).toBeNull();
  });
  it("labels date rollover, UTC and daylight-saving local time explicitly", () => {
    const label = reviewTime("2026-10-07T23:58:43Z", "Europe/London");
    expect(label).toContain("8 Oct 2026");
    expect(label).toContain("00:58:43 BST");
    expect(label).toContain("7 Oct 2026");
    expect(label).toContain("23:58:43 UTC");
    expect(reviewTime("2026-12-01T01:00:00Z", "Europe/London")).toContain(
      "01:00:00 GMT",
    );
    expect(reviewTime("bad", "UTC")).toBe("Time unavailable");
  });
  it("previews native fields as UTC without normalizing impossible dates", () => {
    expect(utcFieldInstant("2026-10-08T01:38")).toBe("2026-10-08T01:38:00Z");
    expect(utcFieldInstant("2026-10-08T01:38:42")).toBe("2026-10-08T01:38:42Z");
    for (const value of [
      "",
      "bad",
      "2026-02-30T12:00",
      "2026-10-08T25:00",
      "2026-10-08T01:38Z",
    ])
      expect(utcFieldInstant(value)).toBeNull();
  });
});
