import type { ReactNode } from "react";
import styles from "./DetailsPanel.module.css";

interface DetailSectionProps {
  readonly title: string;
  readonly children: ReactNode;
}

export function DetailSection({ title, children }: DetailSectionProps) {
  return (
    <section className={styles.section}>
      <h3 className={styles.sectionTitle}>{title}</h3>
      {children}
    </section>
  );
}
