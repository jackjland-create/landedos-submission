import styles from "@/components/measurement-setup.module.css";

export default function LoadingIntegrationSettings() {
  return (
    <section
      aria-busy="true"
      aria-label="Loading website and measurement settings"
      className={styles.page}
    >
      <p>Project settings</p>
      <h1>Loading website &amp; measurement…</h1>
    </section>
  );
}
