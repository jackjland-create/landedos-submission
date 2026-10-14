"use server";

import { z } from "zod";
import {
  accountFlowCopy as copy,
  type AccountFlowState,
} from "@/lib/auth/account-flow";
import {
  accountFlowsEnabled,
  recoveryEnabled,
  createAccountAuthClient,
  confirmationUrl,
} from "@/lib/auth/account-flow.server";

const emailSchema = z.email().max(254);
const passwordSchema = z.string().min(10).max(128);
const createSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  fullName: z.string().trim().min(1).max(120),
  accountType: z.enum(["brand", "agency"]),
});
const recoverySchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  code: z.string().regex(/^\d{6,10}$/),
});
const failure = (message: string): AccountFlowState => ({
  status: "error",
  message,
});
const emailFrom = (form: FormData) => String(form.get("email") ?? "").trim();

export async function createAccount(
  _previous: AccountFlowState,
  form: FormData,
): Promise<AccountFlowState> {
  if (!accountFlowsEnabled()) return failure(copy.disabled);
  const parsed = createSchema.safeParse({
    email: emailFrom(form),
    password: form.get("password"),
    fullName: form.get("fullName"),
    accountType: form.get("accountType"),
  });
  if (!parsed.success) return failure(copy.invalid);
  try {
    const redirectTo = confirmationUrl();
    const client = createAccountAuthClient();
    const { email, password, fullName, accountType } = parsed.data;
    const { error } = await client.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: redirectTo,
        // Editable profile metadata only. Never creates membership/permissions.
        data: { full_name: fullName, account_type: accountType },
      },
    });
    if (error) return failure(copy.unavailable);
    return { status: "sent", message: copy.sent };
  } catch {
    return failure(copy.unavailable);
  }
}

export async function requestRecoveryCode(
  _previous: AccountFlowState,
  form: FormData,
): Promise<AccountFlowState> {
  if (!recoveryEnabled()) return failure(copy.disabled);
  const email = emailSchema.safeParse(emailFrom(form));
  if (!email.success) return failure("Enter a valid work email.");
  try {
    const client = createAccountAuthClient();
    const { error } = await client.auth.resetPasswordForEmail(email.data);
    // Account-specific provider errors must not reveal whether an email exists.
    if (error && (!error.status || error.status === 429 || error.status >= 500))
      return failure(copy.unavailable);
    return { status: "sent", message: copy.codeSent };
  } catch {
    return failure(copy.unavailable);
  }
}

export async function recoverPassword(
  _previous: AccountFlowState,
  form: FormData,
): Promise<AccountFlowState> {
  if (!recoveryEnabled()) return failure(copy.disabled);
  const parsed = recoverySchema.safeParse({
    email: emailFrom(form),
    password: form.get("password"),
    code: form.get("code"),
  });
  if (!parsed.success) return failure(copy.invalid);
  let verified = false;
  try {
    const client = createAccountAuthClient();
    const { data, error } = await client.auth.verifyOtp({
      email: parsed.data.email,
      token: parsed.data.code,
      type: "recovery",
    });
    if (
      error ||
      !data.user ||
      !data.session ||
      data.session.user.id !== data.user.id ||
      data.user.email?.toLowerCase() !== parsed.data.email.toLowerCase()
    ) {
      return { status: "restart", message: copy.recoveryFailed };
    }
    verified = true;
    // Same per-request client; no ordinary-session fallback. Verification consumes
    // the provider's one-time code. These two operations are not atomic.
    const result = await client.auth.updateUser({
      password: parsed.data.password,
    });
    if (result.error || result.data.user?.id !== data.user.id)
      return { status: "restart", message: copy.updateUnknown };
    return { status: "complete", message: copy.complete };
  } catch {
    return {
      status: "restart",
      message: verified ? copy.updateUnknown : copy.recoveryFailed,
    };
  }
}
