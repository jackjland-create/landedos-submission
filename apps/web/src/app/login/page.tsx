import { login, signup } from "./actions";
import { operatorReturnPath } from "@/lib/auth/return-path";
import { SignInPresentation } from "@/components/sign-in-presentation";
import { AccountFlowPresentation } from "@/components/account-flow-presentation";
import {
  accountFlowsEnabled,
  recoveryEnabled,
} from "@/lib/auth/account-flow.server";
import {
  createAccount,
  requestRecoveryCode,
  recoverPassword,
} from "./account-actions";

type LoginPageProps = {
  searchParams: Promise<{
    error?: string;
    message?: string;
    next?: string;
    mode?: string;
  }>;
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const { error, message, next, mode } = await searchParams;
  const returnPath = operatorReturnPath(next);
  const isReturning = next !== undefined;
  const flows = accountFlowsEnabled();
  const recovery = recoveryEnabled();
  const href = (flow?: string) =>
    `/login?${new URLSearchParams({ next: returnPath, ...(flow ? { mode: flow } : {}) })}`;
  if (
    (mode === "create" && flows) ||
    ((mode === "recover" || mode === "update-password") && recovery)
  ) {
    return (
      <AccountFlowPresentation
        mode={mode}
        action={
          mode === "create"
            ? createAccount
            : mode === "recover"
              ? requestRecoveryCode
              : recoverPassword
        }
        signInHref={href()}
        requestCodeHref={href("recover")}
        enterCodeHref={href("update-password")}
      />
    );
  }

  return (
    <SignInPresentation
      loginAction={login}
      requestAccessAction={signup}
      returnPath={returnPath}
      isReturning={isReturning}
      error={error}
      message={message}
      createAccountHref={flows ? href("create") : undefined}
      recoverPasswordHref={recovery ? href("recover") : undefined}
    />
  );
}
