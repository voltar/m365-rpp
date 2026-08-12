import styles from "./ResourceSummaryPanel.module.css";
import type { Organization } from "../../models/resource";

interface OrganisationBadgeProps {
  readonly organization: Organization;
}

export function OrganisationBadge({ organization }: OrganisationBadgeProps) {
  // EO-415: organisations are configured values; only show a badge when one is set.
  if (!organization) {
    return null;
  }

  return <span className={`${styles.badge} ${styles.organization}`}>{organization}</span>;
}
