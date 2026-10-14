import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { operatorReturnPath } from "@/lib/auth/return-path";
import { devnetReviewRequestAllowed } from "@/lib/attribution/devnet-review-lock.server";
import {
  boundedSupabaseCookieOptions,
  supabaseCookieOptions,
} from "@/lib/supabase/cookie-options";

const externalDevnetHeaders = {
  "Cache-Control": "no-store, max-age=0",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Robots-Tag": "noindex, nofollow",
};

function isExternalDevnetPublicRoute(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const method = request.method.toUpperCase();

  if (/^\/t\/[0-9a-f-]{36}$/.test(pathname)) {
    return method === "GET" || method === "HEAD";
  }
  if (pathname === "/measure") {
    return method === "GET" || method === "HEAD";
  }
  if (pathname === "/api/wallet/challenges") return method === "POST";
  if (pathname === "/api/wallet/proofs") return method === "POST";
  if (pathname === "/api/wallet/consents") {
    return method === "GET" || method === "POST";
  }
  if (/^\/api\/wallet\/mappings\/[0-9a-f-]{36}$/.test(pathname)) {
    return method === "DELETE";
  }
  if (pathname === "/api/integrations/helius") return method === "POST";

  return false;
}

export async function updateSession(request: NextRequest) {
  if (!devnetReviewRequestAllowed(request)) {
    return new NextResponse(null, {
      status: 403,
      headers: externalDevnetHeaders,
    });
  }
  const externalDevnetRequest =
    process.env.EXTERNAL_DEVNET_PUBLIC_GATE === "1" &&
    request.headers.has("cf-ray");

  if (externalDevnetRequest && !isExternalDevnetPublicRoute(request)) {
    return new NextResponse(null, {
      status: 404,
      headers: externalDevnetHeaders,
    });
  }

  const participantWalletRoute =
    request.nextUrl.pathname === "/measure" ||
    request.nextUrl.pathname === "/api/wallet/challenges" ||
    request.nextUrl.pathname === "/api/wallet/proofs" ||
    request.nextUrl.pathname === "/api/wallet/consents" ||
    /^\/api\/wallet\/mappings\/[0-9a-f-]{36}$/.test(request.nextUrl.pathname);
  const visualFixtureRoute =
    (request.nextUrl.pathname.startsWith("/visual-tests/reporting/") ||
      request.nextUrl.pathname.startsWith("/visual-tests/reporting-studio/") ||
      request.nextUrl.pathname.startsWith("/visual-tests/operations/") ||
      request.nextUrl.pathname.startsWith("/visual-tests/readiness/") ||
      request.nextUrl.pathname.startsWith("/visual-tests/wallet-consent/") ||
      request.nextUrl.pathname === "/visual-tests/baskets/guided-flow" ||
      request.nextUrl.pathname === "/visual-tests/wallet-measurement" ||
      request.nextUrl.pathname === "/visual-tests/campaign-workspace") &&
    (process.env.NODE_ENV === "development" ||
      process.env.VERCEL_ENV === "preview" ||
      process.env.ENABLE_VISUAL_FIXTURES === "1");
  // This preview is local development only, matching its page-level guard.
  // Production/hosted fixture flags must not grant an authentication exception.
  const campaignFramePreview =
    request.nextUrl.pathname === "/visual-tests/campaign-frame" &&
    ["GET", "HEAD"].includes(request.method) &&
    process.env.NODE_ENV === "development" &&
    !process.env.VERCEL;

  if (
    request.nextUrl.pathname.startsWith("/t/") ||
    request.nextUrl.pathname === "/api/integrations/helius" ||
    request.nextUrl.pathname === "/api/internal/integrations/helius/health" ||
    request.nextUrl.pathname === "/api/inngest" ||
    participantWalletRoute ||
    visualFixtureRoute ||
    campaignFramePreview
  ) {
    return NextResponse.next({ request });
  }

  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!,
    {
      cookieOptions: supabaseCookieOptions(),
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet, headers) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );

          supabaseResponse = NextResponse.next({ request });

          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(
              name,
              value,
              boundedSupabaseCookieOptions(name, options),
            ),
          );

          Object.entries(headers).forEach(([key, value]) =>
            supabaseResponse.headers.set(key, value),
          );
        },
      },
    },
  );

  const { data, error } = await supabase.auth.getClaims();
  const claims = data?.claims;

  if (error) {
    return new NextResponse("Authentication service temporarily unavailable.", {
      status: 503,
      headers: {
        "Cache-Control":
          "private, no-cache, no-store, must-revalidate, max-age=0",
        Expires: "0",
        Pragma: "no-cache",
        "X-Content-Type-Options": "nosniff",
        "X-Robots-Tag": "noindex, nofollow",
      },
    });
  }

  if (
    !claims &&
    !request.nextUrl.pathname.startsWith("/login") &&
    !request.nextUrl.pathname.startsWith("/auth")
  ) {
    const url = new URL("/login", request.url);
    url.searchParams.set(
      "next",
      operatorReturnPath(
        `${request.nextUrl.pathname}${request.nextUrl.search}`,
      ),
    );
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}
