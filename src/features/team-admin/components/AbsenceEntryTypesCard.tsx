import { useMemo, useState } from "react";
import { Button } from "@fluentui/react-components";
import { AddRegular, ArrowSortDownRegular, ArrowSortRegular, ArrowSortUpRegular, DeleteRegular } from "@fluentui/react-icons";
import type { TranslationKey } from "../../../localization/translations";
import type { TeamAdminAbsenceEntryType } from "../types/teamSettings";
import styles from "../TeamAdminPage.module.css";

type EntryTypeSortKey = "name" | "active" | "requiresApproval" | "consumesVacationBalance";
type SortDirection = "asc" | "desc";

interface AbsenceEntryTypesCardProps {
  readonly entryTypes: readonly TeamAdminAbsenceEntryType[];
  readonly onEntryTypeChange: (key: TeamAdminAbsenceEntryType["key"], update: (entryType: TeamAdminAbsenceEntryType) => TeamAdminAbsenceEntryType) => void;
  readonly onEntryTypeAdd: (label: string) => void;
  readonly onEntryTypeDelete: (key: TeamAdminAbsenceEntryType["key"]) => void;
  readonly t: (key: TranslationKey) => string;
}

export function AbsenceEntryTypesCard({ entryTypes, onEntryTypeAdd, onEntryTypeChange, onEntryTypeDelete, t }: AbsenceEntryTypesCardProps) {
  const [newEntryTypeLabel, setNewEntryTypeLabel] = useState("");
  const [sortKey, setSortKey] = useState<EntryTypeSortKey>("name");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const sortedEntryTypes = useMemo(
    () => sortEntryTypes(entryTypes, sortKey, sortDirection, t),
    [entryTypes, sortDirection, sortKey, t]
  );
  const addEntryType = () => {
    const label = newEntryTypeLabel.trim();

    if (!label) {
      return;
    }

    onEntryTypeAdd(label);
    setNewEntryTypeLabel("");
  };
  const changeSort = (nextSortKey: EntryTypeSortKey) => {
    if (nextSortKey === sortKey) {
      setSortDirection((currentDirection) => currentDirection === "asc" ? "desc" : "asc");
      return;
    }

    setSortKey(nextSortKey);
    setSortDirection("asc");
  };

  const renderSortableHeader = (label: string, nextSortKey: EntryTypeSortKey) => (
    <button className={styles.sortHeader} onClick={() => changeSort(nextSortKey)} type="button">
      <span>{label}</span>
      {getSortIcon(sortKey === nextSortKey ? sortDirection : undefined)}
    </button>
  );

  return (
    <section className={`${styles.card} ${styles.wide}`} aria-label={t("teamAdminAbsenceEntryTypes")}>
      <div className={styles.cardHeader}>
        <h3 className={styles.cardTitle}>{t("teamAdminAbsenceEntryTypes")}</h3>
        <p className={styles.cardDescription}>{t("teamAdminAbsenceEntryTypesDescription")}</p>
        <p className={styles.cardDescription}>{t("teamAdminAbsenceEntryTypesSaveHint")}</p>
      </div>
      <div className={styles.entryTypeAddRow}>
        <label className={styles.field}>
          <span>{t("teamAdminEntryTypeNew")}</span>
          <input
            onChange={(event) => setNewEntryTypeLabel(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                addEntryType();
              }
            }}
            placeholder={t("teamAdminEntryTypeNewPlaceholder")}
            value={newEntryTypeLabel}
          />
        </label>
        <Button appearance="secondary" icon={<AddRegular />} onClick={addEntryType}>
          {t("teamAdminEntryTypeAdd")}
        </Button>
      </div>
      <div className={styles.entryTypeGrid}>
        <span className={styles.entryTypeHeader}>{renderSortableHeader(t("teamAdminEntryTypeName"), "name")}</span>
        <span className={styles.entryTypeHeader}>{renderSortableHeader(t("teamAdminEntryTypeActive"), "active")}</span>
        <span className={styles.entryTypeHeader}>{renderSortableHeader(t("teamAdminEntryTypeRequiresApproval"), "requiresApproval")}</span>
        <span className={styles.entryTypeHeader}>{renderSortableHeader(t("teamAdminEntryTypeConsumesVacation"), "consumesVacationBalance")}</span>
        <span className={styles.entryTypeHeader}>{t("teamAdminEntryTypeActions")}</span>
        {sortedEntryTypes.map((entryType) => (
          <div className={styles.entryTypeRow} key={entryType.key}>
            <label className={styles.entryTypeName}>
              <input
                onChange={(event) => onEntryTypeChange(entryType.key, (current) => ({ ...current, label: event.target.value, labelKey: undefined }))}
                value={entryType.labelKey ? t(entryType.labelKey) : entryType.label ?? ""}
              />
            </label>
            <label className={styles.compactCheckbox}>
              <input
                checked={entryType.active}
                onChange={(event) => onEntryTypeChange(entryType.key, (current) => ({ ...current, active: event.target.checked }))}
                type="checkbox"
              />
            </label>
            <label className={styles.compactCheckbox}>
              <input
                checked={entryType.requiresApproval}
                onChange={(event) => onEntryTypeChange(entryType.key, (current) => ({ ...current, requiresApproval: event.target.checked }))}
                type="checkbox"
              />
            </label>
            <label className={styles.compactCheckbox}>
              <input
                checked={entryType.consumesVacationBalance}
                onChange={(event) => onEntryTypeChange(entryType.key, (current) => ({ ...current, consumesVacationBalance: event.target.checked }))}
                type="checkbox"
              />
            </label>
            <div className={styles.entryTypeActions}>
              <Button
                appearance="subtle"
                aria-label={t("teamAdminEntryTypeDelete")}
                icon={<DeleteRegular />}
                onClick={() => onEntryTypeDelete(entryType.key)}
              />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function sortEntryTypes(
  entryTypes: readonly TeamAdminAbsenceEntryType[],
  sortKey: EntryTypeSortKey,
  sortDirection: SortDirection,
  t: (key: TranslationKey) => string
): readonly TeamAdminAbsenceEntryType[] {
  return [...entryTypes].sort((first, second) => {
    const direction = sortDirection === "asc" ? 1 : -1;
    const result = compareEntryTypeValue(first, second, sortKey, t);

    return result * direction;
  });
}

function compareEntryTypeValue(
  first: TeamAdminAbsenceEntryType,
  second: TeamAdminAbsenceEntryType,
  sortKey: EntryTypeSortKey,
  t: (key: TranslationKey) => string
): number {
  if (sortKey === "name") {
    return getEntryTypeLabel(first, t).localeCompare(getEntryTypeLabel(second, t));
  }

  return Number(first[sortKey]) - Number(second[sortKey]);
}

function getEntryTypeLabel(entryType: TeamAdminAbsenceEntryType, t: (key: TranslationKey) => string): string {
  return entryType.labelKey ? t(entryType.labelKey) : entryType.label ?? "";
}

function getSortIcon(direction: SortDirection | undefined) {
  if (direction === "asc") {
    return <ArrowSortUpRegular />;
  }

  if (direction === "desc") {
    return <ArrowSortDownRegular />;
  }

  return <ArrowSortRegular />;
}
