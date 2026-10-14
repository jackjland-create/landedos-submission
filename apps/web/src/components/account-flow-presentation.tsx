"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import type {
  AccountFlowAction,
  AccountFlowMode,
} from "@/lib/auth/account-flow";
import { AuthPresentationFrame } from "./auth-presentation-frame";
import styles from "./sign-in-presentation.module.css";

export function AccountFlowPresentation({
  mode,
  action,
  signInHref,
  requestCodeHref,
  enterCodeHref,
}: {
  mode: AccountFlowMode;
  action: AccountFlowAction;
  signInHref: string;
  requestCodeHref: string;
  enterCodeHref: string;
}) {
  const [state, formAction, pending] = useActionState(action, {
    status: "idle",
  });
  const notice = useRef<HTMLParagraphElement>(null);
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [accountType, setAccountType] = useState("");
  const accountTypeRef = useRef<HTMLSelectElement>(null);
  useEffect(() => {
    // Keep the controlled select in sync after React's native action reset.
    if (accountTypeRef.current) accountTypeRef.current.value = accountType;
  }, [state, accountType]);
  useEffect(() => {
    if (state.message) notice.current?.focus();
  }, [state]);
  const isCreate = mode === "create";
  const isUpdate = mode === "update-password";
  const heading = isCreate
    ? "Request an account"
    : isUpdate
      ? "Set a new password"
      : "Recover your password";
  const terminal = ["sent", "complete", "restart"].includes(state.status);
  const failed = ["error", "restart"].includes(state.status);

  return (
    <AuthPresentationFrame>
      <header className={styles.heading}>
        <p className={styles.eyebrow}>Controlled access</p>
        <h1 id="sign-in-heading">{heading}</h1>
        <p>
          {isCreate
            ? "Tell us who you are. Confirming your email does not grant access to a workspace; membership is managed separately."
            : isUpdate
              ? "Enter the recovery code from your email and choose a new password. This does not change workspace permissions."
              : "Use your account email to request a one-time recovery code."}
        </p>
      </header>
      {state.message ? (
        <p
          ref={notice}
          tabIndex={-1}
          role={failed ? "alert" : "status"}
          className={`${styles.notice} ${failed ? styles.error : ""}`}
        >
          {state.message}
        </p>
      ) : null}
      {!terminal ? (
        <form
          className={styles.form}
          action={formAction}
          onReset={(event) => {
            // React actions reset native controls on a resolved error too. Preserve
            // non-secret fields, including the select, but clear password/code.
            event.preventDefault();
            for (const input of event.currentTarget.querySelectorAll<HTMLInputElement>(
              'input[type="password"], input[name="code"]',
            ))
              input.value = "";
          }}
        >
          {isCreate ? (
            <>
              <div className={styles.field}>
                <label htmlFor="fullName">
                  Full name
                  <span
                    className="required-field-marker"
                    aria-hidden="true"
                    title="Required"
                  />
                </label>
                <input
                  className={styles.input}
                  id="fullName"
                  name="fullName"
                  value={fullName}
                  onChange={(event) => setFullName(event.target.value)}
                  autoComplete="name"
                  required
                  maxLength={120}
                  placeholder="Your full name…"
                />
              </div>
              <div className={styles.field}>
                <label htmlFor="accountType">
                  Account type
                  <span
                    className="required-field-marker"
                    aria-hidden="true"
                    title="Required"
                  />
                </label>
                <select
                  ref={accountTypeRef}
                  className={styles.input}
                  id="accountType"
                  name="accountType"
                  value={accountType}
                  onChange={(event) => setAccountType(event.target.value)}
                  required
                >
                  <option value="" disabled>
                    Choose an account type
                  </option>
                  <option value="brand">Brand</option>
                  <option value="agency">Agency</option>
                </select>
              </div>
            </>
          ) : null}
          <div className={styles.field}>
            <label htmlFor="email">
              Work email
              <span
                className="required-field-marker"
                aria-hidden="true"
                title="Required"
              />
            </label>
            <input
              className={styles.input}
              id="email"
              name="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              type="email"
              autoComplete="email"
              required
              spellCheck={false}
              maxLength={254}
              placeholder="name@company.com…"
            />
          </div>
          {isUpdate ? (
            <div className={styles.field}>
              <label htmlFor="code">
                Recovery code
                <span
                  className="required-field-marker"
                  aria-hidden="true"
                  title="Required"
                />
              </label>
              <input
                className={styles.input}
                id="code"
                name="code"
                type="text"
                inputMode="numeric"
                autoComplete="one-time-code"
                required
                pattern="[0-9]{6,10}"
                minLength={6}
                maxLength={10}
                spellCheck={false}
                placeholder="Code from your email…"
              />
            </div>
          ) : null}
          {isCreate || isUpdate ? (
            <div className={styles.field}>
              <label htmlFor="password">
                {isUpdate ? "New password" : "Password"}
                <span
                  className="required-field-marker"
                  aria-hidden="true"
                  title="Required"
                />
              </label>
              <input
                className={styles.input}
                id="password"
                name="password"
                type="password"
                autoComplete="new-password"
                required
                minLength={10}
                maxLength={128}
                aria-describedby="new-password-hint"
                placeholder="At least 10 characters…"
              />
              <p id="new-password-hint" className={styles.hint}>
                Use 10–128 characters. You can paste from your password manager.
              </p>
            </div>
          ) : null}
          <button
            className="application-button application-button--hero"
            type="submit"
            disabled={pending}
          >
            {pending
              ? "Processing…"
              : isCreate
                ? "Request account"
                : isUpdate
                  ? "Update password"
                  : "Send recovery code"}
          </button>
          <span role="status">
            {pending ? "Your request is being processed." : ""}
          </span>
        </form>
      ) : null}
      {mode === "recover" && state.status === "sent" ? (
        <a
          className="application-button application-button--hero"
          href={enterCodeHref}
        >
          Enter recovery code
        </a>
      ) : null}
      {mode === "recover" && !terminal ? (
        <a className={styles.link} href={enterCodeHref}>
          Already have a code?
        </a>
      ) : null}
      {isUpdate && state.status !== "complete" ? (
        <a className={styles.link} href={requestCodeHref}>
          Request a fresh code
        </a>
      ) : null}
      <a className={styles.link} href={signInHref}>
        Back to sign-in
      </a>
    </AuthPresentationFrame>
  );
}
