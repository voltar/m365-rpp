import styles from "./DetailsPanel.module.css";

interface DetailFieldProps {
  readonly label: string;
  readonly value: string;
}

export function DetailField({ label, value }: DetailFieldProps) {
  return (
    <div className={styles.field}>
      <span className={styles.label}>{label}</span>
      <span className={styles.value}>{value}</span>
    </div>
  );
}
