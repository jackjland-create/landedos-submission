import { describe, expect, it, vi } from "vitest";
import { createTimingSession } from "./timing-session";

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
const record = { revision: 3, timing };
function setup() {
  const client = {
    load: vi.fn().mockResolvedValue(record),
    save: vi.fn().mockResolvedValue({ revision: 4 }),
  };
  return { client, session: createTimingSession(client) };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe("BSK-09 confirmed timing session", () => {
  it("exposes review context only for confirmed unchanged saved dates", async () => {
    const { session, client } = setup();
    expect(session.reviewContext()).toBeNull();
    await session.loadSaved();
    expect(session.reviewContext()).toEqual({
      expectedRevision: 3,
      expectedTiming: timing,
    });
    session.edit("measurementEnd", "2026-10-13T17:00");
    expect(session.reviewContext()).toBeNull();
    client.save.mockRejectedValue(new Error("uncertain"));
    await session.save();
    expect(session.reviewContext()).toBeNull();
    await session.loadSaved();
    expect(session.reviewContext()).toBeNull();
    session.adoptLatest();
    expect(session.reviewContext()).toEqual({
      expectedRevision: 3,
      expectedTiming: timing,
    });
    session.dispose();
    expect(session.reviewContext()).toBeNull();
  });
  it("does not fabricate dates or allow saving before loading", async () => {
    const { session, client } = setup();
    expect(await session.save()).toBe(false);
    expect(session.read().saved).toBeNull();
    expect(client.save).not.toHaveBeenCalled();
    await session.loadSaved();
    expect(session.read().saved).toEqual(record);
  });
  it("saves the checked revision and verifies the exact persisted dates", async () => {
    const { session, client } = setup();
    await session.loadSaved();
    session.edit("measurementEnd", "2026-10-13T17:00");
    const changed = {
      ...timing,
      measurement: { ...timing.measurement, endedAt: "2026-10-13T17:00:00Z" },
    };
    client.load.mockResolvedValue({ revision: 4, timing: changed });
    expect(await session.save()).toBe(true);
    expect(client.save).toHaveBeenCalledExactlyOnceWith({
      expectedRevision: 3,
      timing: changed,
    });
    expect(session.read().saved).toEqual({ revision: 4, timing: changed });
    expect(session.read().message).toBe("Dates saved.");
  });
  it("keeps null timing unset and rejects incomplete dates before writing", async () => {
    const { session, client } = setup();
    client.load.mockResolvedValue({ revision: 3, timing: null });
    await session.loadSaved();
    expect(await session.save()).toBe(false);
    expect(Object.keys(session.read().errors)).toHaveLength(4);
    expect(client.save).not.toHaveBeenCalled();
  });
  it("does not fabricate a strategy when a scoped read is missing", async () => {
    const { session, client } = setup();
    client.load.mockResolvedValue(null);
    expect(await session.loadSaved()).toBe(false);
    expect(session.read().phase).toBe("missing");
    expect(await session.save()).toBe(false);
  });
  it.each([
    null,
    {},
    { revision: 3 },
    { revision: 5 },
    { revision: 4, extra: true },
  ])(
    "treats malformed write acknowledgement as unconfirmed",
    async (response) => {
      const { session, client } = setup();
      await session.loadSaved();
      session.edit("measurementEnd", "2026-10-13T17:00");
      client.save.mockResolvedValue(response);
      expect(await session.save()).toBe(false);
      expect(session.read().fields.measurementEnd).toBe("2026-10-13T17:00");
      expect(session.read().needsReview).toBe(true);
      expect(await session.save()).toBe(false);
      expect(client.save).toHaveBeenCalledTimes(1);
      expect(client.load).toHaveBeenCalledTimes(1);
    },
  );
  it.each([
    null,
    { revision: 3, timing },
    { revision: 5, timing },
    { revision: 4, timing: null },
    {
      revision: 4,
      timing: {
        ...timing,
        flight: { ...timing.flight, startedAt: "2026-09-14T09:00:00.000002Z" },
      },
    },
  ])("requires exact readback after acknowledgement", async (response) => {
    const { session, client } = setup();
    await session.loadSaved();
    client.load.mockResolvedValue(response);
    expect(await session.save()).toBe(false);
    expect(session.read().saved).toEqual(record);
    expect(session.read().needsReview).toBe(true);
  });
  it("never surfaces transport details or automatically retries", async () => {
    const { session, client } = setup();
    await session.loadSaved();
    client.save.mockRejectedValue(new Error("private provider details"));
    expect(await session.save()).toBe(false);
    expect(await session.save()).toBe(false);
    expect(session.read().message).not.toContain("private provider");
    expect(client.save).toHaveBeenCalledTimes(1);
  });
  it("loads competing changes without silently replacing local edits", async () => {
    const { session, client } = setup();
    await session.loadSaved();
    session.edit("measurementEnd", "2026-10-13T17:00");
    client.load.mockResolvedValue({ revision: 5, timing });
    await session.loadSaved();
    expect(session.read().fields.measurementEnd).toBe("2026-10-13T17:00");
    expect(await session.save()).toBe(false);
    expect(session.adoptLatest()).toBe(true);
    expect(session.read().saved?.revision).toBe(5);
    expect(session.read().fields.measurementEnd).toBe("2026-10-12T17:00:00");
  });
  it("adopts a newer shared revision only when the date fields are unchanged", async () => {
    const { session, client } = setup();
    await session.loadSaved();
    client.load.mockResolvedValue({ revision: 4, timing });
    await session.loadSaved();
    expect(session.adoptLatestIfUnchanged(4)).toBe(true);
    expect(session.read()).toMatchObject({
      saved: { revision: 4, timing },
      latest: null,
      needsReview: false,
      message: "Saved dates refreshed after the strategy changed.",
    });

    session.edit("measurementEnd", "2026-10-13T17:00");
    client.load.mockResolvedValue({ revision: 5, timing });
    await session.loadSaved();
    expect(session.adoptLatestIfUnchanged(5)).toBe(false);
    expect(session.read().fields.measurementEnd).toBe("2026-10-13T17:00");
    expect(session.read().needsReview).toBe(true);
  });
  it("locks duplicate submissions and edits while saving", async () => {
    const { session, client } = setup();
    await session.loadSaved();
    const pending = deferred<unknown>();
    client.save.mockReturnValue(pending.promise);
    const saving = session.save();
    expect(await session.save()).toBe(false);
    expect(await session.loadSaved()).toBe(false);
    session.edit("measurementEnd", "2026-10-13T17:00");
    expect(session.read().fields.measurementEnd).toBe("2026-10-12T17:00:00");
    client.load.mockResolvedValue({ revision: 4, timing });
    pending.resolve({ revision: 4 });
    expect(await saving).toBe(true);
    expect(client.save).toHaveBeenCalledTimes(1);
  });
  it("ignores old session responses after disposal", async () => {
    const { session, client } = setup();
    await session.loadSaved();
    const pending = deferred<unknown>();
    client.save.mockReturnValue(pending.promise);
    const saving = session.save();
    session.dispose();
    pending.resolve({ revision: 4 });
    expect(await saving).toBe(false);
    expect(client.load).toHaveBeenCalledTimes(1);
    expect(await session.loadSaved()).toBe(false);
  });
  it("does not expose mutable saved objects", async () => {
    const { session } = setup();
    await session.loadSaved();
    session.read().saved!.timing!.flight.startedAt = "tampered";
    expect(session.read().saved).toEqual(record);
  });
});
