import type { ReactNode } from "react";
import styles from "./sign-in-presentation.module.css";

export function AuthPresentationFrame({ children }: { children: ReactNode }) {
  return (
    <main className={styles.screen}>
      <section className={styles.brand} aria-label="Landed OS">
        <span className={styles.wordmark} translate="no">
          LANDED<span>/OS</span>
        </span>
        <div className={styles.pitch}>
          <p className={styles.eyebrow}>Private preview · Solana</p>
          <p className={styles.headline}>Evidence before claims.</p>
          <p className={styles.lede}>
            The operating system for KOL discovery, commercial planning and
            defensible onchain attribution.
          </p>
        </div>
        <p className={styles.footnote}>Controlled access</p>
      </section>
      <section className={styles.panel} aria-labelledby="sign-in-heading">
        <div className={styles.column}>{children}</div>
      </section>
    </main>
  );
}
