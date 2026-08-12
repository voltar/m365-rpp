import type { ReactNode } from "react";
import styles from "./DesignCard.module.css";

export type DesignCardStatus = "ready" | "foundation" | "reserved";

interface DesignCardProps {
  readonly icon: ReactNode;
  readonly title: string;
  readonly description: string;
  readonly status: string;
  readonly statusTone: DesignCardStatus;
}

export function DesignCard({ icon, title, description, status, statusTone }: DesignCardProps) {
  return (
    <article className={styles.card}>
      <div className={styles.cardHeader}>
        <span className={styles.iconFrame} aria-hidden="true">
          {icon}
        </span>
        <h3 className={styles.title}>{title}</h3>
      </div>
      <p className={styles.description}>{description}</p>
      <span className={`${styles.status} ${styles[statusTone]}`}>{status}</span>
    </article>
  );
}
