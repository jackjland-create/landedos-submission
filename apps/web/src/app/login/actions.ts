"use server";

import { redirect } from "next/navigation";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import { loginPathFor, operatorReturnPath } from "@/lib/auth/return-path";

const credentialsSchema = z.object({
  email: z.email(),
  password: z.string().min(10).max(128),
});

function readCredentials(formData: FormData) {
  return credentialsSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
}

export async function login(formData: FormData) {
  const returnPath = operatorReturnPath(formData.get("next"));
  const credentials = readCredentials(formData);

  if (!credentials.success) {
    redirect(loginPathFor(returnPath, "Enter a valid email and password"));
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(credentials.data);

  if (error) {
    redirect(loginPathFor(returnPath, "The credentials could not be verified"));
  }

  redirect(returnPath);
}

export async function signup(formData: FormData) {
  // SOL-05 / SEC-02: the temporary closed-input runtime may reauthenticate an
  // existing operator, never create a new account or renew session authority.
  if (process.env.LANDED_LOCAL_DEVNET_INPUT_LOCK || process.env.LANDED_SUBMISSION_SNAPSHOT === "1")
    redirect("/login?error=Account+creation+is+unavailable+in+closed+review");
  const credentials = readCredentials(formData);

  if (!credentials.success) {
    redirect("/login?error=Use+a+valid+email+and+at+least+10+characters");
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signUp({
    ...credentials.data,
    options: {
      emailRedirectTo: `${process.env.NEXT_PUBLIC_APP_URL}/auth/confirm`,
    },
  });

  if (error) {
    redirect("/login?error=The+preview+account+could+not+be+created");
  }

  redirect("/login?message=Check+your+email+to+confirm+the+preview+account");
}
