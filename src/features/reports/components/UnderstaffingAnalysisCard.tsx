import { useMemo, useState } from "react";
import { capacityThresholds } from "../../../data/capacityThresholds";
import type { TranslationKey } from "../../../localization/translations";
import type { TeamCapacitySummary } from "../../../models/teamCapacity";
import styles from "../ReportsPage.module.css";

interface CriticalTeamPoint {
  readonly teamName: string;
  readonly availableCapacity: number;
  readonly minDailyAvailable?: number;
  readonly requiredStaffing?: number;
  readonly affectedResourceCount: number;
}

interface WeeklyUtilizationPoint {
  readonly key: string;
  readonly label: string;
  readonly weekNumber: string;
  readonly utilization: number;
  readonly critical: boolean;
  readonly criticalTeams: readonly CriticalTeamPoint[];
}

interface UnderstaffingAnalysisCardProps {
  readonly teamSummaries: readonly TeamCapacitySummary[];
  readonly t: (key: TranslationKey) => string;
}

const chartWidth = 560;
const chartHeight = 210;
const chartLeft = 40;
const chartRight = 12;
const chartTop = 10;
const chartBottom = 30;
const maxPercentage = 120;

export function UnderstaffingAnalysisCard({ teamSummaries, t }: UnderstaffingAnalysisCardProps) {
  const [selectedCriticalWeekKey, setSelectedCriticalWeekKey] = useState<string>();
  const weeklyPoints = useMemo(() => calculateWeeklyUtilization(teamSummaries), [teamSummaries]);
  const warningCount = useMemo(
    () =>
      teamSummaries.reduce(
        (count, team) => count + team.weeks.filter((week) => week.status === "warning").length,
        0
      ),
    [teamSummaries]
  );
  const criticalWeeks = weeklyPoints.filter((point) => point.critical);
  const selectedCriticalWeek = criticalWeeks.find((point) => point.key === selectedCriticalWeekKey) ?? criticalWeeks[0];
  const overallUtilization = weeklyPoints.length > 0
    ? Math.round(weeklyPoints.reduce((sum, point) => sum + point.utilization, 0) / weeklyPoints.length)
    : 0;

  const plotWidth = chartWidth - chartLeft - chartRight;
  const plotHeight = chartHeight - chartTop - chartBottom;
  const xForIndex = (index: number) =>
    chartLeft + (weeklyPoints.length > 1 ? (index * plotWidth) / (weeklyPoints.length - 1) : plotWidth / 2);
  const yForPercentage = (percentage: number) =>
    chartTop + plotHeight - (Math.min(percentage, maxPercentage) / maxPercentage) * plotHeight;
  const linePoints = weeklyPoints
    .map((point, index) => `${xForIndex(index).toFixed(1)},${yForPercentage(point.utilization).toFixed(1)}`)
    .join(" ");
  const bandWidth = weeklyPoints.length > 1 ? plotWidth / (weeklyPoints.length - 1) : plotWidth;

  return (
    <section className={styles.panel} aria-label={t("reportsAnalysisTitle")}>
      <div className={styles.panelHeader}>
        <span className={styles.panelBadge}>5</span>
        <div>
          <h3 className={styles.panelTitle}>{t("reportsAnalysisTitle")}</h3>
          <p className={styles.panelSubtitle}>{t("reportsAnalysisSubtitle")}</p>
        </div>
      </div>

      <div className={styles.kpiRow}>
        <div className={styles.kpi}>
          <span className={`${styles.kpiValue} ${styles.kpiCritical}`}>{criticalWeeks.length}</span>
          <span className={styles.kpiLabel}>{t("reportsCriticalWeeks")}</span>
          <span className={styles.kpiHint}>{t("reportsCriticalWeeksHint")}</span>
        </div>
        <div className={styles.kpi}>
          <span className={`${styles.kpiValue} ${styles.kpiWarning}`}>{warningCount}</span>
          <span className={styles.kpiLabel}>{t("reportsWarnings")}</span>
          <span className={styles.kpiHint}>{t("reportsWarningsHint")}</span>
        </div>
        <div className={styles.kpi}>
          <span className={`${styles.kpiValue} ${styles.kpiOk}`}>{overallUtilization}%</span>
          <span className={styles.kpiLabel}>{t("reportsUtilization")}</span>
          <span className={styles.kpiHint}>{t("reportsUtilizationHint")}</span>
        </div>
      </div>

      <p className={styles.chartTitle}>{t("reportsChartTitle")}</p>
      <svg
        aria-label={t("reportsChartTitle")}
        className={styles.chart}
        role="img"
        viewBox={`0 0 ${chartWidth} ${chartHeight}`}
      >
        {weeklyPoints.map((point, index) =>
          point.critical ? (
            <rect
              fill="var(--app-danger-bg)"
              height={plotHeight}
              key={`band-${point.key}`}
              opacity={0.6}
              width={bandWidth}
              x={xForIndex(index) - bandWidth / 2}
              y={chartTop}
            />
          ) : null
        )}
        {[0, 20, 40, 60, 80, 100, 120].map((percentage) => (
          <g key={`grid-${percentage}`}>
            <line
              stroke="var(--app-border)"
              strokeWidth={1}
              x1={chartLeft}
              x2={chartWidth - chartRight}
              y1={yForPercentage(percentage)}
              y2={yForPercentage(percentage)}
            />
            <text fill="var(--app-text-muted)" fontSize={9} textAnchor="end" x={chartLeft - 5} y={yForPercentage(percentage) + 3}>
              {percentage}%
            </text>
          </g>
        ))}
        <line
          stroke="var(--app-text-muted)"
          strokeDasharray="5 4"
          strokeWidth={1.5}
          x1={chartLeft}
          x2={chartWidth - chartRight}
          y1={yForPercentage(capacityThresholds.critical)}
          y2={yForPercentage(capacityThresholds.critical)}
        />
        <line
          stroke="var(--app-warning-text)"
          strokeDasharray="5 4"
          strokeWidth={1.5}
          x1={chartLeft}
          x2={chartWidth - chartRight}
          y1={yForPercentage(capacityThresholds.warning)}
          y2={yForPercentage(capacityThresholds.warning)}
        />
        {weeklyPoints.length > 0 ? (
          <polyline fill="none" points={linePoints} stroke="var(--app-brand-bg)" strokeWidth={2} />
        ) : null}
        {weeklyPoints.map((point, index) => (
          <circle
            cx={xForIndex(index)}
            cy={yForPercentage(point.utilization)}
            fill={point.critical ? "var(--app-danger-text)" : "var(--app-brand-bg)"}
            key={`dot-${point.key}`}
            onClick={point.critical ? () => setSelectedCriticalWeekKey(point.key) : undefined}
            role={point.critical ? "button" : undefined}
            r={2.6}
            tabIndex={point.critical ? 0 : undefined}
          />
        ))}
        {weeklyPoints.map((point, index) => (
          <text
            fill="var(--app-text-muted)"
            fontSize={9}
            key={`label-${point.key}`}
            textAnchor="middle"
            x={xForIndex(index)}
            y={chartHeight - 8}
          >
            {t("timelineCalendarWeekPrefix")} {point.weekNumber}
          </text>
        ))}
        <text fill="var(--app-text-muted)" fontSize={9} textAnchor="start" x={chartLeft} y={chartHeight - 8} />
      </svg>

      <div className={styles.legendRow}>
        <span className={styles.legendItem}>
          <span className={styles.legendSwatch} /> {t("reportsLegendUtilization")}
        </span>
        <span className={styles.legendItem}>
          <span className={`${styles.legendSwatch} ${styles.legendSwatchMin}`} /> {t("reportsLegendMinStaffing")}
        </span>
        <span className={styles.legendItem}>
          <span className={`${styles.legendSwatch} ${styles.legendSwatchWarning}`} /> {t("reportsLegendWarnThreshold")}
        </span>
      </div>

      <div className={styles.criticalWeeksRow}>
        <span className={styles.criticalWeeksLabel}>{t("reportsCriticalWeeksLabel")}</span>
        <span className={styles.weekChipGroup}>
          {criticalWeeks.length > 0 ? (
            criticalWeeks.map((point) => (
              <button
                className={`${styles.weekChip} ${selectedCriticalWeek?.key === point.key ? styles.weekChipActive : ""}`}
                key={`chip-${point.key}`}
                onClick={() => setSelectedCriticalWeekKey(point.key)}
                type="button"
              >
                {point.label}
              </button>
            ))
          ) : (
            <span className={styles.noCriticalWeeks}>{t("reportsNoCriticalWeeks")}</span>
          )}
        </span>
      </div>

      {selectedCriticalWeek ? (
        <div className={styles.criticalWeekDetails}>
          <div>
            <span className={styles.criticalWeekDetailsTitle}>
              {selectedCriticalWeek.label} · {t("reportsCriticalTeams")}
            </span>
            <span className={styles.criticalWeekDetailsMeta}>
              {t("reportsCriticalWeekUtilization")}: {selectedCriticalWeek.utilization}%
            </span>
          </div>
          <div className={styles.criticalTeamList}>
            {selectedCriticalWeek.criticalTeams.map((team) => (
              <div className={styles.criticalTeamItem} key={`${selectedCriticalWeek.key}-${team.teamName}`}>
                <strong>{team.teamName}</strong>
                <span>
                  {t("reportsMinimumAvailable")}: {team.minDailyAvailable ?? "-"} / {team.requiredStaffing ?? "-"}
                </span>
                <span>{t("reportsAvailableCapacity")}: {team.availableCapacity}</span>
                <span>{t("teamCapacityAffectedResources")}: {team.affectedResourceCount}</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}

function calculateWeeklyUtilization(teamSummaries: readonly TeamCapacitySummary[]): readonly WeeklyUtilizationPoint[] {
  const referenceWeeks = teamSummaries[0]?.weeks ?? [];

  return referenceWeeks.map((referenceWeek, weekIndex) => {
    let nominal = 0;
    let available = 0;
    const criticalTeams: CriticalTeamPoint[] = [];

    teamSummaries.forEach((team) => {
      const week = team.weeks[weekIndex];

      if (!week) {
        return;
      }

      nominal += week.nominalCapacity;
      available += week.availableCapacity;

      if (week.status === "critical") {
        criticalTeams.push({
          teamName: team.teamName,
          availableCapacity: week.availableCapacity,
          minDailyAvailable: week.minDailyAvailable,
          requiredStaffing: team.requiredStaffing,
          affectedResourceCount: week.affectedResources.length
        });
      }
    });

    return {
      key: referenceWeek.key,
      label: referenceWeek.label,
      weekNumber: referenceWeek.key.split("-")[1] ?? referenceWeek.label,
      utilization: nominal > 0 ? Math.round((available / nominal) * 100) : 0,
      critical: criticalTeams.length > 0,
      criticalTeams
    };
  });
}
