// Local runner only: narrows existing Auth/RLS/CSRF, never grants authority.
export function localReviewDiagnosticActionAllowed(
  input: unknown,
  write: boolean,
  report: boolean,
  env: NodeJS.ProcessEnv = process.env,
) {
  if (env.LANDED_LOCAL_REVIEW_DIAGNOSTIC !== "1") return true;
  if (!input || typeof input !== "object" || Array.isArray(input)) return false;
  const value = input as Record<string, unknown>;
  if (
    !env.LANDED_LOCAL_DEVNET_REVIEW_CAMPAIGN_ID ||
    value.campaignId !== env.LANDED_LOCAL_DEVNET_REVIEW_CAMPAIGN_ID
  )
    return false;
  if (typeof value.action !== "string") return false;
  return (
    write ? ["prepare"] : report ? ["sources", "read", "recover"] : ["recover"]
  ).includes(value.action);
}
