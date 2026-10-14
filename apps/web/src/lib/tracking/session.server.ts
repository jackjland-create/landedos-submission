import "server-only";

export const anonymousSessionCookieName = "lnd_session";
export const anonymousSessionMaxAgeSeconds = 7 * 24 * 60 * 60;

const canonicalSessionIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export function readAnonymousSessionId(request: Request) {
  const cookieHeader = request.headers.get("cookie");

  if (!cookieHeader) return null;

  for (const part of cookieHeader.split(";")) {
    const separator = part.indexOf("=");

    if (separator < 1) continue;

    const name = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();

    if (
      name === anonymousSessionCookieName &&
      canonicalSessionIdPattern.test(value)
    ) {
      return value;
    }
  }

  return null;
}

export function getAnonymousSessionCookieMaxAge(
  expiresAt: string,
  now = Date.now(),
) {
  const expiresAtMs = new Date(expiresAt).getTime();

  if (!Number.isFinite(expiresAtMs)) {
    throw new TypeError("Anonymous session expiry is not valid.");
  }

  return Math.max(
    0,
    Math.min(
      anonymousSessionMaxAgeSeconds,
      Math.floor((expiresAtMs - now) / 1000),
    ),
  );
}
