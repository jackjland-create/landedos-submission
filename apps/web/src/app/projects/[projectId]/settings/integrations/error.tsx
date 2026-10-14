"use client";
import { ApplicationButton } from "@landed/ui";
import styles from "@/components/measurement-setup.module.css";

export default function IntegrationSettingsError({
  reset,
}: {
  error: Error;
  reset: () => void;
}) {
  return (
    <section className={styles.page}>
      <p>Project settings</p>
      <h1>Website &amp; measurement is unavailable.</h1>
      <p>
        We couldn’t load the settings. Nothing was changed. Retry to check the
        current state.
      </p>
      <div>
        <ApplicationButton onClick={reset}>Retry settings</ApplicationButton>
      </div>
    </section>
  );
}
