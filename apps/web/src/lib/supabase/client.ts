import {
  createBrowserClient,
  parseCookieHeader,
  serializeCookieHeader,
  type CookieMethodsBrowser,
} from "@supabase/ssr";
import {
  boundedSupabaseCookieOptions,
  supabaseCookieOptions,
} from "./cookie-options";

export function rehearsalBrowserCookies(): CookieMethodsBrowser | undefined {
  if (
    !supabaseCookieOptions()?.name.startsWith("landed-external-") ||
    typeof document === "undefined"
  )
    return undefined;
  return {
    getAll() {
      return parseCookieHeader(document.cookie);
    },
    setAll(cookiesToSet) {
      for (const { name, value, options } of cookiesToSet) {
        document.cookie = serializeCookieHeader(
          name,
          value,
          boundedSupabaseCookieOptions(name, options),
        );
      }
    },
  };
}

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookieOptions: supabaseCookieOptions(),
      cookies: rehearsalBrowserCookies(),
    },
  );
}
