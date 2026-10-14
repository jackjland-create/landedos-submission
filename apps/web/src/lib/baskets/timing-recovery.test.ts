import { afterEach, expect, it, vi } from "vitest";
import { createTimingSession } from "./timing-session";
import {
  findTimingDraft,
  forgetTimingDraft,
  rememberTimingDraft,
} from "./timing-recovery";
const ownerId = "91000000-0000-4000-8000-000000000077";
afterEach(() => {
  vi.useRealTimers();
  forgetTimingDraft(ownerId, "p", "b");
});
it("isolates owner/project/basket, clones values, expires memory and keeps uncertainty", async () => {
  vi.useFakeTimers();
  const session = createTimingSession({
    load: async () => ({ ownerId, revision: 1, timing: null }),
    save: async () => {
      throw new Error();
    },
  });
  await session.loadSaved();
  session.edit("flightStart", "2026-09-14T09:00");
  rememberTimingDraft("p", "b", { ...session.read(), phase: "saving" });
  const draft = findTimingDraft(ownerId, "p", "b")!;
  expect(draft.uncertain).toBe(true);
  draft.fields.flightStart = "changed";
  expect(findTimingDraft(ownerId, "p", "b")?.fields.flightStart).toBe(
    "2026-09-14T09:00",
  );
  expect(findTimingDraft("other", "p", "b")).toBeNull();
  expect(findTimingDraft(ownerId, "other", "b")).toBeNull();
  expect(findTimingDraft(ownerId, "p", "other")).toBeNull();
  session.restoreDraft(findTimingDraft(ownerId, "p", "b")!);
  expect(session.read().needsReview).toBe(true);
  expect(await session.save()).toBe(false);
  vi.advanceTimersByTime(30 * 60 * 1000);
  expect(findTimingDraft(ownerId, "p", "b")).toBeNull();
});
