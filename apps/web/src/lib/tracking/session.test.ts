import { describe, expect, it } from "vitest";

import {
  anonymousSessionCookieName,
  anonymousSessionMaxAgeSeconds,
  getAnonymousSessionCookieMaxAge,
  readAnonymousSessionId,
} from "./session.server";

describe("anonymous session delivery", () => {
  it("caps the cookie at the declared seven-day session window", () => {
    expect(
      getAnonymousSessionCookieMaxAge(
        "2026-08-18T12:00:00.000Z",
        new Date("2026-08-11T12:00:00.000Z").getTime(),
      ),
    ).toBe(anonymousSessionMaxAgeSeconds);
  });

  it("never extends a retained session when a duplicate click returns it", () => {
    expect(
      getAnonymousSessionCookieMaxAge(
        "2026-08-18T12:00:00.000Z",
        new Date("2026-08-11T12:30:00.000Z").getTime(),
      ),
    ).toBe(anonymousSessionMaxAgeSeconds - 1800);
  });

  it("fails closed for malformed or expired evidence", () => {
    expect(() => getAnonymousSessionCookieMaxAge("not-a-time")).toThrow(
      "Anonymous session expiry is not valid.",
    );
    expect(
      getAnonymousSessionCookieMaxAge(
        "2026-08-11T11:59:00.000Z",
        new Date("2026-08-11T12:00:00.000Z").getTime(),
      ),
    ).toBe(0);
  });

  it("reads only the canonical protected session cookie", () => {
    const sessionId = "f1000000-0000-4000-8000-000000000001";

    expect(
      readAnonymousSessionId(
        new Request("https://landed.test/wallet", {
          headers: {
            cookie: `other=value; ${anonymousSessionCookieName}=${sessionId}`,
          },
        }),
      ),
    ).toBe(sessionId);
    expect(
      readAnonymousSessionId(
        new Request("https://landed.test/wallet", {
          headers: {
            cookie: `${anonymousSessionCookieName}=../not-a-session`,
          },
        }),
      ),
    ).toBeNull();
  });
});
