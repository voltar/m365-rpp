import { useEffect, useMemo, useState } from "react";
import { Button } from "@fluentui/react-components";
import { PersonRegular } from "@fluentui/react-icons";
import { useLogger } from "../../core/logging";
import { capacityThresholds } from "../../data/capacityThresholds";
import { getRequiredStaffingByTeamName } from "../../data/teamRequiredStaffing";
import { getTeamAdminTeamSortOrder, getTeamColorsByTeamName } from "../../features/team-admin/services/teamAdminApi";
import type { TranslationKey } from "../../localization/translations";
import type { Absence, AbsenceDraft } from "../../models/absence";
import type { DetailsPanelState } from "../../models/detailsPanel";
import type { TeamCapacityWeek } from "../../models/teamCapacity";
import type { ResourceSummary } from "../../models/resource";
import type { PublicHoliday } from "../../models/capacity";
import type { PlanningRepositories } from "../../repositories/planningRepositories";
import { PlanningBootstrapStatus } from "../PlanningBootstrapStatus";
import { calculateResourcesWithAbsences } from "../../services/absenceCalculations";
import { calculateCapacity } from "../../services/capacityEngine";
import { bootstrapPlanningState, type PlanningBootstrapState } from "../../services/planningBootstrapService";
import { aggregateTeamCapacity } from "../../services/teamCapacityAggregation";
import { getAssignedTeamColorStyle } from "../../styles/teamColorPalette";
import { SidePanel } from "../detailsPanel/SidePanel";
import { createTimelineDays, getTimelineStart } from "../timeline/timelineDateUtils";
import styles from "./TeamCapacityDashboard.module.css";

interface TeamCapacityDashboardProps {
  readonly locale: string;
  readonly repositories: PlanningRepositories;
  readonly t: (key: TranslationKey) => string;
}

export function TeamCapacityDashboard({ locale, repositories, t }: TeamCapacityDashboardProps) {
  const logger = useLogger();
  const [sourceResources, setSourceResources] = useState<readonly ResourceSummary[]>([]);
  const [absences, setAbsences] = useState<readonly Absence[]>([]);
  const [holidays, setHolidays] = useState<readonly PublicHoliday[]>([]);
  const [bootstrapState, setBootstrapState] = useState<PlanningBootstrapState>({ status: "loading" });
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [selectedTeamId, setSelectedTeamId] = useState<string>();
  const [selectedWeekKey, setSelectedWeekKey] = useState<string>();
  const [detailsPanelState, setDetailsPanelState] = useState<DetailsPanelState>({ kind: "closed" });
  const [periodMonths, setPeriodMonths] = useState(3);
  const days = useMemo(() => createTimelineDays(getTimelineStart(), periodMonths), [periodMonths]);
  const resources = useMemo(() => calculateResourcesWithAbsences(sourceResources, absences), [absences, sourceResources]);
  const capacity = useMemo(
    () => calculateCapacity({ resources, absences, dateKeys: days.map((day) => day.key), publicHolidays: holidays }, logger),
    [absences, days, holidays, logger, resources]
  );
  const teamSummaries = useMemo(
    () =>
      aggregateTeamCapacity({
        resources,
        capacityByEmployeeId: capacity.byEmployeeId,
        locale,
        calendarWeekPrefix: t("timelineCalendarWeekPrefix"),
        thresholds: capacityThresholds,
        requiredStaffingByTeamName: getRequiredStaffingByTeamName(),
        // FR-413.2: all Team Admin teams appear, even without assigned members.
        additionalTeamNames: Array.from(getTeamAdminTeamSortOrder().keys()),
        logger
      }),
    [capacity.byEmployeeId, locale, logger, resources, t]
  );
  const selectedTeam = teamSummaries.find((team) => team.teamId === selectedTeamId) ?? teamSummaries[0];
  const selectedWeek = selectedTeam?.weeks.find((week) => week.key === selectedWeekKey) ?? selectedTeam?.weeks[0];
  const teamCapacityRows = useMemo(() => teamSummaries.map(getTeamCapacityRow), [teamSummaries]);
  const teamColorsByTeamName = useMemo(() => getTeamColorsByTeamName(), []);
  const selectedTeamColorStyle = useMemo(
    () =>
      getAssignedTeamColorStyle(
        selectedTeam?.teamName ?? "",
        selectedTeam ? teamColorsByTeamName.get(selectedTeam.teamName) : undefined
      ),
    [selectedTeam, teamColorsByTeamName]
  );

  useEffect(() => {
    let isCancelled = false;

    setBootstrapState({ status: "loading" });

    bootstrapPlanningState(repositories, logger, "TeamCapacityDashboard", { forceRefresh: loadAttempt > 0 })
      .then((state) => {
        if (isCancelled) {
          return;
        }

        setBootstrapState(state);

        if (state.status === "ready" || state.status === "empty") {
          setSourceResources(state.snapshot.resources);
          setAbsences(state.snapshot.absences);
          setHolidays(state.snapshot.publicHolidays);
        }
      });

    return () => {
      isCancelled = true;
    };
  }, [loadAttempt, logger, repositories]);

  const openResourceDetails = (resource: ResourceSummary) => {
    setDetailsPanelState({ kind: "resource", resource });
  };

  const noopSaveAbsence = (() => undefined) as (draft: AbsenceDraft) => void;
  const noopDeleteAbsence = (() => undefined) as (absenceId: string) => void;

  if (!selectedTeam || !selectedWeek) {
    return <PlanningBootstrapStatus state={bootstrapState} onRetry={() => setLoadAttempt((current) => current + 1)} t={t} />;
  }

  return (
    <>
      <section className={styles.dashboard} aria-labelledby="team-capacity-dashboard-title">
        <PlanningBootstrapStatus state={bootstrapState} onRetry={() => setLoadAttempt((current) => current + 1)} t={t} />
        <section className={styles.topPanel}>
          <div className={styles.topPanelHeader}>
            <div>
              <div className={styles.panelTitleRow}>
                <span className={styles.panelBadge}>3</span>
                <div>
                  <h3 id="team-capacity-dashboard-title">{t("teamCapacityDashboardTitle")}</h3>
                  <p>{t("teamCapacityDashboardDescription")}</p>
                </div>
              </div>
            </div>
            <div className={styles.panelActions}>
              <label className={styles.teamSelect}>
                <span>{t("timelinePeriodLabel")}</span>
                <select
                  value={periodMonths}
                  aria-label={t("timelinePeriodLabel")}
                  onChange={(event) => setPeriodMonths(Number(event.target.value))}
                >
                  <option value={3}>{t("timelinePeriodNextThreeMonths")}</option>
                  <option value={6}>{t("timelinePeriodNextSixMonths")}</option>
                  <option value={12}>{t("timelinePeriodFullYear")}</option>
                </select>
              </label>
            </div>
          </div>
          <div className={styles.capacitySnapshot} role="table" aria-label={t("teamCapacityDashboardTitle")}>
            <div className={styles.snapshotHeader} role="row">
              <span role="columnheader">{t("teamCapacityTeamLabel")}</span>
              <span role="columnheader">{t("teamCapacityUtilization")}</span>
              <span role="columnheader">{t("teamCapacityCriticalWeeksShort")}</span>
            </div>
            {teamCapacityRows.map((row) => {
              const teamColorStyle = getAssignedTeamColorStyle(row.team.teamName, teamColorsByTeamName.get(row.team.teamName));

              return (
                <button
                  className={`${styles.snapshotRow} ${row.team.teamId === selectedTeam.teamId ? styles.snapshotRowSelected : ""}`}
                  key={row.team.teamId}
                  onClick={() => {
                    setSelectedTeamId(row.team.teamId);
                    setSelectedWeekKey(row.firstCriticalWeekKey ?? row.team.weeks[0]?.key);
                  }}
                  role="row"
                  style={{ borderLeft: `3px solid ${teamColorStyle.border}` }}
                  type="button"
                >
                  <span className={styles.teamCell} role="cell">
                    <i style={{ background: teamColorStyle.background }} />
                    <strong>{row.team.teamName}</strong>
                  </span>
                  <span className={styles.utilizationCell} role="cell">
                    <strong>{row.averageAvailability}%</strong>
                    <span className={styles.utilizationTrack}>
                      <span style={{ width: `${row.averageAvailability}%`, background: teamColorStyle.background }} />
                    </span>
                  </span>
                  <span className={styles.criticalCell} role="cell">
                    {row.criticalWeekLabels.length > 0 ? row.criticalWeekLabels.join(", ") : "-"}
                  </span>
                </button>
              );
            })}
          </div>
        </section>

        <section
          className={`${styles.teamDetailPanel} ${styles[selectedWeek.status]}`}
          style={{ borderLeftColor: selectedTeamColorStyle.border }}
        >
          <div className={styles.topPanelHeader}>
            <div>
              <span className={styles.eyebrow}>{t("teamCapacityTeamLabel")}</span>
              <h4>{selectedTeam.teamName}</h4>
              <p>{selectedWeek.label} · {selectedWeek.dateInterval}</p>
            </div>
            <label className={styles.teamSelect}>
              <span>{t("teamCapacityTeamLabel")}</span>
              <select value={selectedTeam.teamId} onChange={(event) => setSelectedTeamId(event.target.value)}>
                {teamSummaries.map((team) => (
                  <option key={team.teamId} value={team.teamId}>
                    {team.teamName}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className={styles.teamDetailBody}>
            <div className={styles.heroMetric}>
              <span>{selectedWeek.label}</span>
              <strong>{selectedWeek.availableCapacity}</strong>
              <small>{t("teamCapacityAvailable")} · {selectedWeek.dateInterval}</small>
            </div>
            <div className={styles.panelMetricGrid}>
              <CapacityMetric label={t("teamCapacityMembers")} value={selectedTeam.resources.length} />
              <CapacityMetric label={t("teamCapacityAbsentPersons")} value={selectedWeek.affectedResources.length} />
              <CapacityMetric label={t("teamCapacityAbsenceDays")} value={selectedWeek.absenceCapacity} />
              <CapacityMetric label={t("teamCapacityUtilization")} value={`${selectedWeek.availabilityPercentage}%`} />
              <CapacityMetric label={t("teamCapacityNominal")} value={selectedWeek.nominalCapacity} />
              <CapacityMetric
                label={t("teamCapacityRequiredStaffing")}
                value={selectedTeam.requiredStaffing && selectedTeam.requiredStaffing > 0 ? selectedTeam.requiredStaffing : "-"}
                tone={selectedWeek.understaffed ? "critical" : undefined}
              />
              <CapacityMetric label={t("teamCapacityStatus")} value={t(statusLabelKeyByStatus[selectedWeek.status])} tone={selectedWeek.status} />
            </div>
          </div>
        </section>

        <section className={styles.weekOverview} aria-label={t("teamCapacityWeeklyOverview")}>
          <div className={styles.sectionHeader}>
            <h4>{t("teamCapacityWeeklyOverview")}</h4>
            <span>{t("teamCapacityDashboardTitle")}</span>
          </div>
          <div className={styles.weekGrid}>
          {selectedTeam.weeks.map((week) => (
            <button
              className={`${styles.weekCard} ${styles[week.status]} ${week.key === selectedWeek.key ? styles.selected : ""}`}
              key={week.key}
              onClick={() => setSelectedWeekKey(week.key)}
              style={{ borderLeftColor: selectedTeamColorStyle.border }}
              type="button"
            >
              <span className={styles.weekLabel}>{week.label}</span>
              <span className={styles.weekDates}>{week.dateInterval}</span>
              <span className={styles.capacityValue}>{week.availableCapacity}</span>
              <span className={styles.capacityMeta}>{t("teamCapacityAvailable")}</span>
              <span className={styles.status}>{t(statusLabelKeyByStatus[week.status])}</span>
            </button>
          ))}
          </div>
        </section>

        <div className={styles.tableShell}>
          <table className={styles.capacityTable}>
            <thead>
              <tr>
                <th>{t("teamCapacityMetric")}</th>
                {selectedTeam.weeks.map((week) => (
                  <th key={week.key}>
                    <button className={styles.weekHeaderButton} onClick={() => setSelectedWeekKey(week.key)} type="button">
                      <span>{week.label}</span>
                      <small>{week.dateInterval}</small>
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <CapacityRow label={t("teamCapacityAvailableDays")} values={selectedTeam.weeks.map((week) => week.availableCapacity)} />
              <CapacityRow label={t("teamCapacityAbsenceDays")} values={selectedTeam.weeks.map((week) => week.absenceCapacity)} />
              <CapacityRow label={t("teamCapacityUtilization")} values={selectedTeam.weeks.map((week) => `${week.availabilityPercentage}%`)} />
              <tr>
                <th>{t("teamCapacityStatus")}</th>
                {selectedTeam.weeks.map((week) => (
                  <td key={week.key}>
                    <button className={`${styles.statusPill} ${styles[week.status]}`} onClick={() => setSelectedWeekKey(week.key)} type="button">
                      {t(statusLabelKeyByStatus[week.status])}
                    </button>
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>

        <section className={styles.affectedPanel} aria-labelledby="affected-resources-title">
          <div>
            <h4 id="affected-resources-title">{selectedWeek.label} · {t("teamCapacityAffectedResources")}</h4>
            <p>{selectedWeek.dateInterval}</p>
          </div>
          <div className={styles.peopleList}>
            {selectedWeek.affectedResources.length > 0 ? (
              selectedWeek.affectedResources.map((resource) => (
                <Button key={resource.id} icon={<PersonRegular />} appearance="secondary" onClick={() => openResourceDetails(resource)}>
                  {resource.displayName}
                </Button>
              ))
            ) : (
              <span className={styles.empty}>{t("teamCapacityNoAffectedResources")}</span>
            )}
          </div>
        </section>
      </section>
      <SidePanel
        state={detailsPanelState}
        resources={resources}
        onClose={() => setDetailsPanelState({ kind: "closed" })}
        onDeleteAbsence={noopDeleteAbsence}
        onSaveAbsence={noopSaveAbsence}
        t={t}
      />
    </>
  );
}

interface CapacityMetricProps {
  readonly label: string;
  readonly value: string | number;
  readonly tone?: TeamCapacityWeek["status"];
}

function CapacityMetric({ label, value, tone }: CapacityMetricProps) {
  return (
    <div className={`${styles.metric} ${tone ? styles[tone] : ""}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

interface CapacityRowProps {
  readonly label: string;
  readonly values: readonly (string | number)[];
}

function CapacityRow({ label, values }: CapacityRowProps) {
  return (
    <tr>
      <th>{label}</th>
      {values.map((value, index) => (
        <td key={`${label}-${index}`}>{value}</td>
      ))}
    </tr>
  );
}

const statusLabelKeyByStatus = {
  ok: "teamCapacityStatusOk",
  warning: "teamCapacityStatusWarning",
  critical: "teamCapacityStatusCritical"
} as const satisfies Record<TeamCapacityWeek["status"], TranslationKey>;

interface TeamCapacityRow {
  readonly team: {
    readonly teamId: string;
    readonly teamName: string;
    readonly weeks: readonly TeamCapacityWeek[];
  };
  readonly averageAvailability: number;
  readonly criticalWeekLabels: readonly string[];
  readonly firstCriticalWeekKey?: string;
  readonly status: TeamCapacityWeek["status"];
}

function getTeamCapacityRow(team: { readonly teamId: string; readonly teamName: string; readonly weeks: readonly TeamCapacityWeek[] }): TeamCapacityRow {
  const averageAvailability = Math.round(
    team.weeks.reduce((sum, week) => sum + week.availabilityPercentage, 0) / Math.max(1, team.weeks.length)
  );
  const criticalWeeks = team.weeks.filter((week) => week.status === "critical");
  const warningWeeks = team.weeks.filter((week) => week.status === "warning");

  return {
    team,
    averageAvailability,
    criticalWeekLabels: criticalWeeks.map((week) => week.label),
    firstCriticalWeekKey: criticalWeeks[0]?.key,
    status: criticalWeeks.length > 0 ? "critical" : warningWeeks.length > 0 ? "warning" : "ok"
  };
}
