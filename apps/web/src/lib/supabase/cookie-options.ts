import type { CookieOptions } from "@supabase/ssr";

const safeCookieName = /^[A-Za-z0-9_-]{1,80}$/;

// INT-01 / FND-08 / SEC-02: rehearsal only. SDK options alone do not cap writes.
function rehearsalDeadline(name: string) {
  if (!name.startsWith("landed-external-")) return null;
  const configured =
    process.env.NEXT_PUBLIC_LANDED_REHEARSAL_COOKIE_DEADLINE_MS;
  const deadline =
    configured && /^\d+$/.test(configured) ? Number(configured) : NaN;
  if (
    !Number.isSafeInteger(deadline) ||
    deadline <= 0 ||
    deadline - Date.now() > 3_600_000
  ) {
    throw new Error("Rehearsal cookie deadline is invalid.");
  }
  return deadline;
}

export function supabaseCookieOptions() {
  const name = process.env.NEXT_PUBLIC_SUPABASE_AUTH_COOKIE_NAME?.trim();
  if (!name) return undefined;
  if (!safeCookieName.test(name)) {
    throw new Error("Supabase auth cookie name is invalid.");
  }
  rehearsalDeadline(name);
  return { name };
}

/** Applied after @supabase/ssr's 400-day override, without touching other runs. */
export function boundedSupabaseCookieOptions(
  name: string,
  options: CookieOptions,
): CookieOptions {
  const namespace = supabaseCookieOptions()?.name;
  if (!namespace) return options;
  const deadline = rehearsalDeadline(namespace);
  if (deadline === null) return options;
  const suffix = name.slice(namespace.length);
  const owned =
    name.startsWith(namespace) &&
    /^(?:-code-verifier|-flows-code-verifier|-flow-[A-Za-z0-9_-]{8,64}-code-verifier)?(?:\.\d+)?$/.test(
      suffix,
    );
  if (!owned) return options;
  if (options.maxAge !== undefined && options.maxAge <= 0) return options;
  const endsAt = Math.min(deadline, options.expires?.getTime() ?? deadline);
  const maxAge = Math.max(
    0,
    Math.min(
      Math.floor((endsAt - Date.now()) / 1_000),
      options.maxAge ?? Infinity,
    ),
  );
  return { ...options, maxAge, expires: new Date(maxAge ? endsAt : 0) };
}
