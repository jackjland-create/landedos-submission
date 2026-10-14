import { NextResponse, type NextRequest } from "next/server";

import { updateSession } from "@/lib/supabase/proxy";

export async function proxy(request: NextRequest) {
  if (
    process.env.LANDED_SUBMISSION_SNAPSHOT === "1" &&
    (request.nextUrl.pathname.startsWith("/t/") ||
      (!["GET", "HEAD", "OPTIONS"].includes(request.method) &&
        (request.nextUrl.pathname.startsWith("/api/") ||
          request.nextUrl.pathname.startsWith("/projects/"))))
  )
    return NextResponse.json(
      { error: "This synthetic submission is read-only." },
      { status: 403 },
    );
  if (
    process.env.LANDED_SUBMISSION_SNAPSHOT === "1" &&
    request.nextUrl.pathname.startsWith("/projects/helios")
  ) {
    return NextResponse.redirect(
      new URL("/projects/demo/overview", request.url),
    );
  }
  return updateSession(request);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
