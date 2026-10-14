/** Local integration rehearsal only. Hosted enablement needs a separate review. */
export function basketTimingEnabled(env: {
  ENABLE_BASKET_TIMING?: string;
  LANDED_EXTERNAL_DEVNET_SESSION?: string;
  LANDED_LOCAL_DEVNET_REHEARSAL?: string;
  NODE_ENV?: string;
  VERCEL?: string;
  NEXT_PUBLIC_SUPABASE_URL?: string;
}) {
  let localDatabase = false;
  try {
    const url = new URL(env.NEXT_PUBLIC_SUPABASE_URL ?? "");
    localDatabase =
      url.protocol === "http:" &&
      ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) &&
      !url.username &&
      !url.password;
  } catch {
    /* Missing/invalid configuration stays disabled. */
  }
  const enabledLocalDevelopment = env.NODE_ENV === "development";
  const enabledIsolatedExternalRehearsal =
    env.NODE_ENV === "production" &&
    env.LANDED_LOCAL_DEVNET_REHEARSAL === "1" &&
    env.LANDED_EXTERNAL_DEVNET_SESSION === "1";

  return (
    localDatabase &&
    env.ENABLE_BASKET_TIMING === "1" &&
    (enabledLocalDevelopment || enabledIsolatedExternalRehearsal) &&
    !env.VERCEL
  );
}
