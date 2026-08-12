import { useMemo, useState } from "react";
import { ArrowSortDownRegular, ArrowSortRegular, ArrowSortUpRegular } from "@fluentui/react-icons";
import type { TranslationKey } from "../../../localization/translations";
import type { Organization, ResourceSummary } from "../../../models/resource";
import { getResourceLocation, type ReportLocation } from "../personProfile";
import styles from "../ReportsPage.module.css";

type OrganizationFilter = "all" | Organization;
type LocationFilter = "all" | ReportLocation;
type SharedPlanningSortKey = "employee" | "organization" | "location" | "teamsRoles";
type SortDirection = "asc" | "desc";

interface OrganizationPlanningCardProps {
  readonly resources: readonly ResourceSummary[];
  readonly onPersonSelect: (resource: ResourceSummary, targetRect?: DOMRect) => void;
  readonly t: (key: TranslationKey) => string;
}

export function OrganizationPlanningCard({ resources, onPersonSelect, t }: OrganizationPlanningCardProps) {
  const [organizationFilter, setOrganizationFilter] = useState<OrganizationFilter>("all");
  const [locationFilter, setLocationFilter] = useState<LocationFilter>("all");
  const [teamFilter, setTeamFilter] = useState("all");
  const [sortKey, setSortKey] = useState<SharedPlanningSortKey>("employee");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");

  // Team options cover primary AND additional team assignments — otherwise teams
  // whose members are all primary elsewhere (e.g. M365) never show up.
  const teamOptions = useMemo(
    () => uniqueSorted(resources.flatMap((resource) => [resource.primaryTeam, ...resource.additionalTeams]).filter(Boolean)),
    [resources]
  );

  // EO-415: filter options derive from the configured values present in the data.
  const organizationOptions = useMemo(
    () => uniqueSorted(resources.map((resource) => resource.organization).filter(Boolean)),
    [resources]
  );
  const locationValues = useMemo(
    () => uniqueSorted(resources.map((resource) => getResourceLocation(resource) ?? "").filter(Boolean)),
    [resources]
  );

  const filteredResources = useMemo(() => {
    return [...resources]
      .filter((resource) => organizationFilter === "all" || resource.organization === organizationFilter)
      .filter((resource) => locationFilter === "all" || getResourceLocation(resource) === locationFilter)
      .filter((resource) => teamFilter === "all" || resource.primaryTeam === teamFilter || resource.additionalTeams.includes(teamFilter))
      .sort((first, second) => compareResources(first, second, sortKey, sortDirection));
  }, [locationFilter, organizationFilter, resources, sortDirection, sortKey, teamFilter]);

  const changeSort = (nextSortKey: SharedPlanningSortKey) => {
    if (nextSortKey === sortKey) {
      setSortDirection((currentDirection) => currentDirection === "asc" ? "desc" : "asc");
      return;
    }

    setSortKey(nextSortKey);
    setSortDirection("asc");
  };

  const renderSortableHeader = (label: string, nextSortKey: SharedPlanningSortKey) => (
    <button className={styles.reportSortHeader} onClick={() => changeSort(nextSortKey)} type="button">
      <span>{label}</span>
      {getSortIcon(sortKey === nextSortKey ? sortDirection : undefined)}
    </button>
  );

  const filterOptions: readonly { readonly key: OrganizationFilter; readonly label: string }[] = [
    { key: "all", label: t("reportsOrgFilterAll") },
    ...organizationOptions.map((organization) => ({ key: organization, label: organization }))
  ];

  const locationOptions: readonly { readonly key: LocationFilter; readonly label: string }[] = [
    { key: "all", label: t("reportsOrgFilterAll") },
    ...locationValues.map((location) => ({ key: location, label: location }))
  ];

  return (
    <section className={`${styles.panel} ${styles.sharedPlanningPanel}`} aria-label={t("reportsSharedPlanningTitle")}>
      <div className={styles.panelHeader}>
        <span className={styles.panelBadge}>4</span>
        <div>
          <h3 className={styles.panelTitle}>{t("reportsSharedPlanningTitle")}</h3>
          <p className={styles.panelSubtitle}>{t("reportsSharedPlanningSubtitle")}</p>
        </div>
      </div>

      <div className={styles.sharedPlanningFilters}>
        <div className={styles.filterGroup}>
          <span className={styles.filterLabel}>{t("reportsOrganizationLabel")}</span>
          <div className={styles.segmented} role="group" aria-label={t("reportsOrganizationLabel")}>
            {filterOptions.map((option) => (
              <button
                aria-pressed={organizationFilter === option.key}
                className={`${styles.segmentButton} ${organizationFilter === option.key ? styles.segmentButtonActive : ""}`}
                key={option.key}
                onClick={() => setOrganizationFilter(option.key)}
                type="button"
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
        <div className={styles.filterGroup}>
          <span className={styles.filterLabel}>{t("reportsTableLocation")}</span>
          <div className={styles.segmented} role="group" aria-label={t("reportsTableLocation")}>
            {locationOptions.map((option) => (
              <button
                aria-pressed={locationFilter === option.key}
                className={`${styles.segmentButton} ${locationFilter === option.key ? styles.segmentButtonActive : ""}`}
                key={option.key}
                onClick={() => setLocationFilter(option.key)}
                type="button"
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
        <label className={styles.filterGroup}>
          <span className={styles.filterLabel}>{t("reportsTeamFilter")}</span>
          <select className={styles.reportSelect} value={teamFilter} onChange={(event) => setTeamFilter(event.target.value)}>
            <option value="all">{t("reportsOrgFilterAll")}</option>
            {teamOptions.map((team) => (
              <option key={team} value={team}>
                {team}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className={styles.reportTableScroller}>
        <table className={styles.memberTable}>
          <thead>
            <tr>
              <th>{renderSortableHeader(t("reportsTableEmployee"), "employee")}</th>
              <th>{renderSortableHeader(t("reportsOrganizationLabel"), "organization")}</th>
              <th>{renderSortableHeader(t("reportsTableLocation"), "location")}</th>
              <th>{renderSortableHeader(t("reportsTableTeamsRoles"), "teamsRoles")}</th>
            </tr>
          </thead>
          <tbody>
            {filteredResources.map((resource) => (
              <tr key={resource.id}>
                <td>
                  <button
                    className={styles.memberButton}
                    onClick={(event) => onPersonSelect(resource, event.currentTarget.getBoundingClientRect())}
                    type="button"
                  >
                    <span aria-hidden className={styles.memberAvatar}>
                      {resource.initials}
                    </span>
                    <span className={styles.memberText}>
                      <span>{resource.displayName}</span>
                    </span>
                  </button>
                </td>
                <td>
                  <span className={styles.orgBadge}>{resource.organization}</span>
                </td>
                <td>
                  <span className={styles.locationCell}>
                    <span>{getResourceLocation(resource) ?? "–"}</span>
                  </span>
                </td>
                <td>
                  <span className={styles.chipRow}>
                    <span className={styles.chipPrimary}>{resource.primaryTeam}</span>
                    {resource.additionalTeams.map((team) => (
                      <span className={styles.chip} key={team}>
                        {team}
                      </span>
                    ))}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className={styles.filterHint}>{t("reportsFilterHint")}</p>
    </section>
  );
}

function uniqueSorted(values: readonly string[]): readonly string[] {
  return Array.from(new Set(values)).sort((first, second) => first.localeCompare(second));
}

function compareResources(
  first: ResourceSummary,
  second: ResourceSummary,
  sortKey: SharedPlanningSortKey,
  sortDirection: SortDirection
): number {
  const direction = sortDirection === "asc" ? 1 : -1;
  const result = getSortText(first, sortKey).localeCompare(getSortText(second, sortKey));

  return result * direction;
}

function getSortText(resource: ResourceSummary, sortKey: SharedPlanningSortKey): string {
  if (sortKey === "organization") {
    return resource.organization;
  }

  if (sortKey === "location") {
    return getResourceLocation(resource) ?? "";
  }

  if (sortKey === "teamsRoles") {
    return [resource.primaryTeam, ...resource.additionalTeams].join(", ");
  }

  return resource.displayName;
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
