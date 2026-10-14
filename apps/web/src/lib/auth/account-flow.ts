/** FND-04 / UI-03: public action state contains no credential or session data. */
export type AccountFlowMode = "create" | "recover" | "update-password";
export type AccountFlowState = {
  status: "idle" | "error" | "sent" | "complete" | "restart";
  message?: string;
};
export type AccountFlowAction = (
  previous: AccountFlowState,
  form: FormData,
) => Promise<AccountFlowState>;

export const accountFlowCopy = {
  disabled:
    "This account flow is not available. Return to sign-in or contact the Landed team.",
  invalid:
    "Check the fields and try again. Passwords must be 10–128 characters.",
  sent: "If this email is eligible, check your inbox for the next step. This does not grant workspace access.",
  codeSent:
    "If this email is eligible, a recovery code has been requested. Check your inbox, then enter the code and a new password.",
  unavailable:
    "We could not confirm the request. Check your inbox before trying again.",
  recoveryFailed:
    "Recovery could not be confirmed. Request a fresh code before trying again.",
  updateUnknown:
    "We could not confirm the password change. Try signing in, or request a fresh recovery code. Do not reuse this code.",
  complete: "Password updated. Sign in with your new password.",
} as const;
