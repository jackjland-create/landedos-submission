import type { ButtonHTMLAttributes, ReactNode } from "react";

type Tone = "default" | "verified" | "forecast" | "action" | "danger";

export function Eyebrow({ children }: { children: ReactNode }) {
  return <span className="eyebrow">{children}</span>;
}

export function Status({
  children,
  tone = "default",
}: {
  children: ReactNode;
  tone?: Tone;
}) {
  return (
    <span className={`status status--${tone}`}>
      <span className="status__dot" aria-hidden="true" />
      {children}
    </span>
  );
}

export function MetricCard({
  detail,
  label,
  tone = "default",
  value,
}: {
  detail?: string;
  label: string;
  tone?: Tone;
  value: string;
}) {
  return (
    <article className={`metric metric--${tone}`}>
      <span className="metric__label">{label}</span>
      <strong className="metric__value">{value}</strong>
      {detail ? <span className="metric__detail">{detail}</span> : null}
    </article>
  );
}

export function ActionButton({
  children,
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button className={`action-button ${className}`.trim()} {...props}>
      {children}
    </button>
  );
}

// FND-05: hosts apply ApplicationTheme. Legacy primitives stay unchanged.
export function ApplicationButton({
  children,
  className = "",
  variant = "neutral",
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "hero" | "progress" | "attention" | "neutral" | "destructive";
}) {
  return (
    <button
      {...props}
      className={`application-button application-button--${variant} ${className}`.trim()}
      type={type}
    >
      {children}
    </button>
  );
}

export function ApplicationStatus({
  children,
  state = "pending",
  tone = "neutral",
}: {
  children: ReactNode;
  state?: "confirmed" | "pending" | "unavailable";
  tone?: "neutral" | "progress" | "attention" | "blocked" | "info";
}) {
  return (
    <span
      className={`application-status application-status--${tone}`}
      data-status-state={state}
    >
      <span className="application-status__dot" aria-hidden="true" />
      {children}
    </span>
  );
}

export function ApplicationProcess({ label }: { label: string }) {
  // Mount only during the caller's actual finite process, never idle or fake progress.
  return (
    <span className="application-process" role="status">
      <span className="application-process__orb" aria-hidden="true" />
      {label}
    </span>
  );
}

/** Controlled by the owning page; no separate global preference or URL rewrite. */
export function ApplicationThemeToggle({
  theme,
  onChange,
}: {
  theme: "light" | "dark";
  onChange: (theme: "light" | "dark") => void;
}) {
  return (
    <ApplicationButton
      role="switch"
      aria-label="Dark mode"
      aria-checked={theme === "dark"}
      onClick={() => onChange(theme === "dark" ? "light" : "dark")}
    >
      Dark mode
      <span aria-hidden="true">{theme === "dark" ? "On" : "Off"}</span>
    </ApplicationButton>
  );
}
