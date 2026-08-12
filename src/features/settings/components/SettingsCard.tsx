import type { ReactNode } from "react";
import styles from "../MySettingsPage.module.css";

interface SettingsCardProps {
  readonly title: string;
  readonly description?: string;
  readonly wide?: boolean;
  readonly children: ReactNode;
}

export function SettingsCard({ title, description, wide, children }: SettingsCardProps) {
  return (
    <section className={`${styles.card} ${wide ? styles.wide : ""}`} aria-label={title}>
      <div className={styles.cardHeader}>
        <h3 className={styles.cardTitle}>{title}</h3>
        {description ? <p className={styles.cardDescription}>{description}</p> : null}
      </div>
      {children}
    </section>
  );
}
