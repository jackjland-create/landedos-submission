import { browserCampaignEnabled } from "./browser-campaign-runtime.server";
import { localDevnetRehearsalEnabled } from "@/lib/attribution/devnet-campaign-runtime.server";

/** Exact browser origin, including Next's isolated loopback alias normalization. */
export function isTimingSameOrigin(request: Request) {
  const requestUrl = new URL(request.url);
  const host = request.headers.get("host");
  const localHost =
    (browserCampaignEnabled() || localDevnetRehearsalEnabled()) &&
    /^(localhost|127\.0\.0\.1):\d+$/.test(host ?? "") &&
    requestUrl.protocol === "http:" &&
    ["localhost", "127.0.0.1"].includes(requestUrl.hostname) &&
    host?.split(":")[1] === requestUrl.port;
  const expectedOrigin = localHost ? `http://${host}` : requestUrl.origin;
  return (
    request.headers.get("origin") === expectedOrigin &&
    (!localHost ||
      [null, "same-origin"].includes(request.headers.get("sec-fetch-site")))
  );
}
