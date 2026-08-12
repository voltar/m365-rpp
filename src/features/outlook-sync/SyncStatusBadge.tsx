import type { OutlookSyncStatus } from "../../models/approval";
import type { TranslationKey } from "../../localization/translations";
import styles from "./SyncStatusBadge.module.css";

interface SyncStatusBadgeProps {
  readonly status: OutlookSyncStatus;
  readonly t: (key: TranslationKey) => string;
}

export function SyncStatusBadge({ status, t }: SyncStatusBadgeProps) {
  return <span className={`${styles.badge} ${styles[status]}`}>{t(statusLabelByStatus[status])}</span>;
}

const statusLabelByStatus = {
  notRequired: "outlookSyncStatusNotRequired",
  pending: "outlookSyncStatusPending",
  synced: "outlookSyncStatusSynced",
  failed: "outlookSyncStatusFailed"
} as const satisfies Record<OutlookSyncStatus, TranslationKey>;
