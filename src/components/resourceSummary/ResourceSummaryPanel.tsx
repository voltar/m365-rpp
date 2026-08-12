import { useSyncExternalStore } from "react";
import type { ResourceSummary } from "../../models/resource";
import type { TranslationKey } from "../../localization/translations";
import { getDisplayConfigSnapshot, subscribeDisplayConfig } from "../../features/team-admin/services/teamAdminApi";
import { OrganisationBadge } from "./OrganisationBadge";
import { ResourceAvatar } from "./ResourceAvatar";
import { VacationSummary } from "./VacationSummary";
import styles from "./ResourceSummaryPanel.module.css";

interface ResourceSummaryPanelProps {
  readonly resource: ResourceSummary;
  readonly rowIndex: number;
  readonly t: (key: TranslationKey) => string;
  readonly onOpen: (resource: ResourceSummary, targetRect?: DOMRect) => void;
}

export function ResourceSummaryPanel({ resource, rowIndex, t, onOpen }: ResourceSummaryPanelProps) {
  // EO-421: the vacation metric row is a tenant-wide Team Admin display setting.
  const { showVacationSummary } = useSyncExternalStore(subscribeDisplayConfig, getDisplayConfigSnapshot);
  const competencies = resource.additionalTeams.filter((team) => team !== resource.primaryTeam);
  const visibleCompetencies = competencies.slice(0, 3);
  const hiddenCompetencyCount = competencies.length - visibleCompetencies.length;
  const hiddenCompetencies = competencies.slice(3).join(", ");

  return (
    <button
      className={styles.panel}
      onClick={(event) => onOpen(resource, event.currentTarget.getBoundingClientRect())}
      style={{ gridColumn: 1, gridRow: rowIndex }}
      type="button"
    >
      <ResourceAvatar resource={resource} />
      <div className={styles.content}>
        <div className={styles.topLine}>
          <span className={styles.name}>{resource.displayName}</span>
          <OrganisationBadge organization={resource.organization} />
        </div>
        <div className={styles.competencyLine} aria-label={t("resourceCompetencies")}>
          {visibleCompetencies.map((competency) => (
            <span className={styles.competency} key={competency}>
              {competency}
            </span>
          ))}
          {hiddenCompetencyCount > 0 ? (
            <span className={`${styles.competency} ${styles.overflow}`} title={hiddenCompetencies}>
              +{hiddenCompetencyCount}
            </span>
          ) : null}
        </div>
        {showVacationSummary ? (
          <VacationSummary
            balance={resource.vacation}
            label={t("resourceVacationSummary")}
            iconLabel={t("resourceVacationIcon")}
            entitlementLabel={t("resourceVacationEntitlement")}
            bookedLabel={t("resourceVacationBooked")}
            remainingLabel={t("resourceVacationRemaining")}
            entitlementTooltip={t("resourceVacationEntitlementTooltip")}
            bookedTooltip={t("resourceVacationBookedTooltip")}
            remainingTooltip={t("resourceVacationRemainingTooltip")}
            daysLabel={t("detailsDays")}
          />
        ) : null}
      </div>
    </button>
  );
}
