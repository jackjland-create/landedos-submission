import "server-only";
import { createClient } from "@supabase/supabase-js";

// Off by default. Enable only after provider email/OTP controls and delivery have
// been approved and verified. Existing login/request-access remains independent.
export function accountFlowsEnabled() {
  return (
    process.env.LANDED_ACCOUNT_FLOWS_ENABLED === "1" &&
    process.env.LANDED_SUBMISSION_SNAPSHOT !== "1" &&
    !process.env.LANDED_LOCAL_DEVNET_INPUT_LOCK
  );
}
export function recoveryEnabled() {
  return (
    accountFlowsEnabled() &&
    process.env.LANDED_PASSWORD_RECOVERY_ENABLED === "1"
  );
}

/** Fresh public-key client: never borrow a signed-in cookie, admin key or session. */
export function createAccountAuthClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error("Account authentication is not configured");
  return createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

export function confirmationUrl() {
  const url = new URL(process.env.NEXT_PUBLIC_APP_URL ?? "");
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (
    url.username ||
    url.password ||
    (url.protocol !== "https:" && !(url.protocol === "http:" && local))
  )
    throw new Error("Invalid application origin");
  return new URL("/auth/confirm", url.origin).href;
}
