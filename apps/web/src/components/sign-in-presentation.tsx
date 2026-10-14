"use client";

import { useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import styles from "./sign-in-presentation.module.css";
import { AuthPresentationFrame } from "./auth-presentation-frame";

export type SignInPresentationProps = {
  loginAction: (formData: FormData) => Promise<void>;
  requestAccessAction: (formData: FormData) => Promise<void>;
  returnPath: string;
  isReturning: boolean;
  error?: string;
  message?: string;
  createAccountHref?: string;
  recoverPasswordHref?: string;
};

function SubmitActions({
  loginAction,
  requestAccessAction,
  createAccountHref,
}: Pick<
  SignInPresentationProps,
  "loginAction" | "requestAccessAction" | "createAccountHref"
>) {
  const { pending, action } = useFormStatus();
  return (
    <div className={styles.actions}>
      <button
        className="application-button application-button--hero"
        type="submit"
        formAction={loginAction}
        disabled={pending}
      >
        {pending && action === loginAction ? "Signing in…" : "Sign in"}
      </button>
      {createAccountHref ? (
        <a className="application-button" href={createAccountHref}>
          Request access
        </a>
      ) : (
        <button
          className="application-button"
          type="submit"
          formAction={requestAccessAction}
          disabled={pending}
        >
          {pending && action === requestAccessAction
            ? "Requesting access…"
            : "Request access"}
        </button>
      )}
      <span className={styles.status} role="status">
        {pending ? "Your request is being processed." : ""}
      </span>
    </div>
  );
}

/** BRD-06 / UI-03: presentation only; server actions own authentication and redirects. */
export function SignInPresentation(props: SignInPresentationProps) {
  const [showPassword, setShowPassword] = useState(false);
  const errorRef = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (props.error) errorRef.current?.focus();
  }, [props.error]);

  return (
    <AuthPresentationFrame>
      <header className={styles.heading}>
        <p className={styles.eyebrow}>Authorized team members</p>
        <h1 id="sign-in-heading">Sign in</h1>
        <p>
          Use your invited work email. New accounts require email confirmation
          before access is granted.
        </p>
      </header>
      {props.error ? (
        <p
          ref={errorRef}
          tabIndex={-1}
          role="alert"
          className={`${styles.notice} ${styles.error}`}
        >
          {props.error}
        </p>
      ) : null}
      {props.message ? (
        <p role="status" className={styles.notice}>
          {props.message}
        </p>
      ) : null}
      <form className={styles.form}>
        <input name="next" type="hidden" value={props.returnPath} />
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
            autoComplete="email"
            id="email"
            name="email"
            placeholder="name@company.com…"
            required
            spellCheck={false}
            type="email"
          />
        </div>
        <div className={styles.field}>
          <label htmlFor="password">
            Password
            <span
              className="required-field-marker"
              aria-hidden="true"
              title="Required"
            />
          </label>
          <div className={styles.password}>
            <input
              autoComplete="current-password"
              id="password"
              minLength={10}
              name="password"
              placeholder="10 characters minimum…"
              required
              type={showPassword ? "text" : "password"}
              aria-describedby="password-hint"
            />
            <button
              type="button"
              className={styles.reveal}
              aria-label={showPassword ? "Hide password" : "Show password"}
              aria-controls="password"
              aria-pressed={showPassword}
              onClick={() => setShowPassword(!showPassword)}
            >
              {showPassword ? "Hide" : "Show"}
            </button>
          </div>
          <p id="password-hint" className={styles.hint}>
            At least 10 characters.
          </p>
        </div>
        <SubmitActions
          loginAction={props.loginAction}
          requestAccessAction={props.requestAccessAction}
          createAccountHref={props.createAccountHref}
        />
        {props.recoverPasswordHref ? (
          <a className={styles.link} href={props.recoverPasswordHref}>
            Forgot password?
          </a>
        ) : null}
        {props.isReturning ? (
          <p className={styles.returnNote}>
            After sign-in, you’ll return to the page you were reviewing.
          </p>
        ) : null}
      </form>
    </AuthPresentationFrame>
  );
}
