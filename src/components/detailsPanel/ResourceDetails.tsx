import { Avatar } from "@fluentui/react-components";
import type { TranslationKey } from "../../localization/translations";
import type { ResourceSummary } from "../../models/resource";
import { DetailField } from "./DetailField";
import { DetailSection } from "./DetailSection";
import styles from "./DetailsPanel.module.css";

interface ResourceDetailsProps {
  readonly resource: ResourceSummary;
  readonly t: (key: TranslationKey) => string;
}

export function ResourceDetails({ resource, t }: ResourceDetailsProps) {
  return (
    <>
      <div className={styles.identity}>
        <Avatar name={resource.displayName} initials={resource.initials} color="colorful" size={48} />
        <div className={styles.identityText}>
          <span className={styles.identityName}>{resource.displayName}</span>
          <span className={styles.identityMeta}>{resource.organization}</span>
        </div>
      </div>
      <DetailSection title={t("detailsResourceSection")}>
        <DetailField label={t("detailsOrganisation")} value={resource.organization} />
        {resource.location ? (
          <DetailField label={t("personCardWorkLocation")} value={resource.location} />
        ) : null}
        <DetailField label={t("detailsPrimaryTeam")} value={resource.primaryTeam} />
        <DetailField label={t("detailsSecondaryTeams")} value={resource.additionalTeams.join(", ")} />
        <DetailField
          label={t("detailsVacation")}
          value={`${resource.vacation.annualEntitlement} | ${resource.vacation.booked} | ${resource.vacation.remaining}`}
        />
      </DetailSection>
    </>
  );
}
