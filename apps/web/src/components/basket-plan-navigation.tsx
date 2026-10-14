import styles from "./basket-plan-navigation.module.css";

/** Section navigation, not a readiness assessment or a second builder. */
export function BasketPlanNavigation() {
  const sections = [
    {
      href: "#basket-strategy",
      label: "Purpose & measurement",
      detail: "Goal, audience and success rule",
    },
    {
      href: "#basket-outcome",
      label: "Outcome target",
      detail: "Baseline and numerical target",
    },
    {
      href: "#basket-roster",
      label: "Creators & terms",
      detail: "Packages, deliverables and fees",
    },
    {
      href: "#basket-timing",
      label: "Dates",
      detail: "Campaign and measurement windows",
    },
    {
      href: "#basket-plan-review",
      label: "Review",
      detail: "One saved plan before approval",
    },
  ];

  return (
    <nav
      id="basket-plan-navigation"
      aria-label="Basket planning sections"
      className={styles.root}
    >
      {sections.map((section, index) => (
        <a href={section.href} key={section.href}>
          <span>{String(index + 1).padStart(2, "0")}</span>
          <strong>{section.label}</strong>
          <small>{section.detail}</small>
        </a>
      ))}
    </nav>
  );
}
