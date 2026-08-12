import type { ReactNode } from "react";
import styles from "./PageScaffold.module.css";

interface PageScaffoldProps {
  readonly children: ReactNode;
}

export function PageScaffold({ children }: PageScaffoldProps) {
  return <section className={styles.page}>{children}</section>;
}

export const pageScaffoldStyles = styles;
