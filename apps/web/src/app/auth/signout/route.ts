import { revalidatePath } from "next/cache";
import { type NextRequest, NextResponse } from "next/server";

import { logError } from "@/lib/observability";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();

  if (data?.claims) {
    const { error } = await supabase.auth.signOut({ scope: "local" });

    if (error) {
      const reference = logError({
        event: "auth_signout_failed",
        error,
        projectId: "helios",
      });
      const url = new URL("/login", request.url);
      url.searchParams.set("error", "The preview session could not be closed");
      url.searchParams.set("reference", reference);

      return NextResponse.redirect(url, { status: 303 });
    }
  }

  revalidatePath("/", "layout");

  const url = new URL("/login", request.url);
  url.searchParams.set("message", "Preview session closed");

  return NextResponse.redirect(url, { status: 303 });
}
