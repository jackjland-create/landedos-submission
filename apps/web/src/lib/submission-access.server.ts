import "server-only";
import { notFound, redirect } from "next/navigation";
import { createClient } from "./supabase/server";
import { project } from "./demo-data";
export function submissionEnabled() {
  return process.env.LANDED_SUBMISSION_SNAPSHOT === "1";
}
export async function authorizeSubmission() {
  const client = await createClient();
  const { data, error } = await client.auth.getUser();
  if (error || !data.user)
    redirect("/login?next=%2Fprojects%2Fdemo%2Foverview");
  const access = await client
    .from("projects")
    .select("id")
    .eq("id", project.databaseId)
    .maybeSingle();
  if (access.error || !access.data) notFound();
  return data.user.email ?? "Judge";
}
