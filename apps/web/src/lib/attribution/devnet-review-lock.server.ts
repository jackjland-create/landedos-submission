import "server-only";
import type { NextRequest } from "next/server";

/** SOL-05 / ATT-01–02 / RPT-03: temporary runner only. Not an Auth bypass.
 * Normal application requests are unchanged. Closed review never reopens inputs.
 */
export function devnetReviewRequestAllowed(
  request: NextRequest,
  env: NodeJS.ProcessEnv = process.env,
) {
  const mode = env.LANDED_LOCAL_DEVNET_INPUT_LOCK;
  if (!mode) return true;
  if (!["drain", "review"].includes(mode)) return false;
  if (
    !(
      env.LANDED_SAME_COPY_CLOSED_REVIEW === "1" && mode === "review"
        ? ["localhost:3213", "127.0.0.1:3213"]
        : ["localhost:3319", "127.0.0.1:3319"]
    ).includes(request.headers.get("host") ?? "") ||
    request.headers.has("cf-ray")
  )
    return false;
  const path = request.nextUrl.pathname;
  const read = ["GET", "HEAD"].includes(request.method);
  if (path === "/isolated-readiness") return read;
  if (mode === "drain")
    return (
      path === "/api/inngest" && ["GET", "POST", "PUT"].includes(request.method)
    );
  const campaign = env.LANDED_LOCAL_DEVNET_REVIEW_CAMPAIGN_ID;
  const uuid =
    "[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
  if (!campaign || !new RegExp(`^${uuid}$`).test(campaign)) return false;
  // Existing credentials may reauthenticate, but cannot create an account.
  // The signup server action separately denies this temporary locked phase.
  if (path === "/login") return read || request.method === "POST";
  if (
    path === "/api/isolated-devnet-rehearsal" ||
    path === "/api/isolated-timed-reports"
  )
    return ["GET", "POST"].includes(request.method);
  if (!read) return false;
  if (path === "/login" || path === "/visual-tests/reporting-studio/review")
    return true;
  return (
    path === "/projects/helios/overview" ||
    path === `/projects/helios/campaigns/${campaign}` ||
    path === `/projects/helios/campaigns/${campaign}/results/review` ||
    new RegExp(`^/projects/helios/reports/${uuid}$`).test(path) ||
    new RegExp(
      `^/api/projects/(?:helios|20000000-0000-4000-8000-000000000001)/reports/${uuid}/evidence$`,
    ).test(path)
  );
}
