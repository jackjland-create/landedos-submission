import type { HTMLAttributes, ReactNode } from "react";
import { ApplicationProcess } from "@landed/ui";

import styles from "./application-ui.module.css";

/** Scoped foundation: never remaps legacy page variables or business state. */
export function ApplicationTheme({
  children,
  theme = "light",
  className = "",
  ...props
}: HTMLAttributes<HTMLDivElement> & { theme?: "light" | "dark" }) {
  return (
    <div
      {...props}
      className={`${styles.theme} ${className}`.trim()}
      data-theme={theme}
    >
      {children}
    </div>
  );
}

export function ApplicationPanel({
  children,
  className = "",
  ...props
}: HTMLAttributes<HTMLElement>) {
  return (
    <section {...props} className={`${styles.panel} ${className}`.trim()}>
      {children}
    </section>
  );
}

export function ApplicationState({
  state,
  title,
  detail,
  children,
}: {
  state: "loading" | "empty" | "error" | "permission";
  title: string;
  detail: string;
  children?: ReactNode;
}) {
  return (
    <ApplicationPanel aria-label={title}>
      <div className={styles.state}>
        <div
          role={
            state === "loading"
              ? undefined
              : state === "error"
                ? "alert"
                : "status"
          }
        >
          {state === "loading" ? (
            <ApplicationProcess label={title} />
          ) : (
            <h2>{title}</h2>
          )}
          <p>{detail}</p>
        </div>
        {children}
      </div>
    </ApplicationPanel>
  );
}
