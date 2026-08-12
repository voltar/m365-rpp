import { useEffect, useMemo, useState } from "react";
import { useLogger } from "../../core/logging";
import { capacityThresholds } from "../../data/capacityThresholds";
import { getRequiredStaffingByTeamName } from "../../data/teamRequiredStaffing";
import type { TranslationKey } from "../../localization/translations";
import type { Absence, AbsenceDraft } from "../../models/absence";
import type { PublicHoliday } from "../../models/capacity";
import type { DetailsPanelState } from "../../models/detailsPanel";
import type { ResourceSummary } from "../../models/resource";
import type { PlanningRepositories } from "../../repositories/planningRepositories";
import { PlanningBootstrapStatus } from "../../components/PlanningBootstrapStatus";
import { SidePanel } from "../../components/detailsPanel/SidePanel";
import { createTimelineDays, getTimelineStart } from "../../components/timeline/timelineDateUtils";
import { calculateResourcesWithAbsences, createAbsenceFromDraft } from "../../services/absenceCalculations";
import { calculateCapacity } from "../../services/capacityEngine";
import { bootstrapPlanningState, type PlanningBootstrapState } from "../../services/planningBootstrapService";
import { aggregateTeamCapacity } from "../../services/teamCapacityAggregation";
import { MyAbsencesSummaryCard } from "./components/MyAbsencesSummaryCard";
import { OrganizationPlanningCard } from "./components/OrganizationPlanningCard";
import { PersonProfileCard } from "./components/PersonProfileCard";
import { UnderstaffingAnalysisCard } from "./components/UnderstaffingAnalysisCard";
import { createPersonProfile } from "./personProfile";
import { tryShowTeamsProfileCard } from "../../infrastructure/microsoft365/teamsProfileCard";
import { resolveCurrentUserId } from "../../infrastructure/microsoft365/currentUser";
import styles from "./ReportsPage.module.css";

interface ReportsPageProps {
  readonly locale: string;
  readonly repositories: PlanningRepositories;
  readonly t: (key: TranslationKey) => string;
}

export function ReportsPage({ locale, repositories, t }: ReportsPageProps) {
  const logger = useLogger();
  const [sourceResources, setSourceResources] = useState<readonly ResourceSummary[]>([]);
  const [absences, setAbsences] = useState<readonly Absence[]>([]);
  const [holidays, setHolidays] = useState<readonly PublicHoliday[]>([]);
  const [bootstrapState, setBootstrapState] = useState<PlanningBootstrapState>({ status: "loading" });
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [selectedPerson, setSelectedPerson] = useState<ResourceSummary>();
  const [detailsPanelState, setDetailsPanelState] = useState<DetailsPanelState>({ kind: "closed" });
  const [currentUserGraphId, setCurrentUserGraphId] = useState<string>();

  useEffect(() => {
    resolveCurrentUserId(logger).then((userId) => setCurrentUserGraphId(userId));
  }, [logger]);

  const days = useMemo(() => createTimelineDays(getTimelineStart(), 3), []);
  const resources = useMemo(() => calculateResourcesWithAbsences(sourceResources, absences), [absences, sourceResources]);
  // The signed-in user's resource row: Teams host identity first (api mode), then mock fallback.
  const currentUserResourceId = useMemo(() => {
    const byGraphId = currentUserGraphId && resources.find((resource) => resource.id === currentUserGraphId);

    return (byGraphId || resources.find((resource) => resource.id === "resource-alex-mueller"))?.id
      ?? "resource-alex-mueller";
  }, [currentUserGraphId, resources]);
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
        logger
      }),
    [capacity.byEmployeeId, locale, logger, resources, t]
  );

  useEffect(() => {
    let isCancelled = false;

    setBootstrapState({ status: "loading" });

    bootstrapPlanningState(repositories, logger, "ReportsPage", { forceRefresh: loadAttempt > 0 })
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

  const selectPerson = (resource: ResourceSummary, targetRect?: DOMRect) => {
    void (async () => {
      // Inside Teams the native profile card is shown; the in-app card stays as
      // the fallback for browser access and mock data.
      if (targetRect && (await tryShowTeamsProfileCard(resource, targetRect, logger))) {
        return;
      }

      setSelectedPerson(resource);
    })();
  };

  const openNewAbsence = () => {
    const currentUserResource = resources.find((resource) => resource.id === currentUserResourceId) ?? resources[0];

    if (!currentUserResource) {
      return;
    }

    setDetailsPanelState({
      kind: "absenceCreate",
      resource: currentUserResource,
      date: new Date().toISOString().slice(0, 10)
    });
  };

  const saveAbsence = (draft: AbsenceDraft) => {
    const createdAbsence = createAbsenceFromDraft(draft);
    setAbsences((current) => [...current, createdAbsence]);
    void repositories.absences.saveAbsence(createdAbsence);
    logger.info("Absence created from reports view.", {
      source: "ui",
      component: "ReportsPage",
      operation: "createAbsence",
      details: { absenceId: createdAbsence.id, employeeId: createdAbsence.employeeId }
    });
    setDetailsPanelState({ kind: "closed" });
  };

  if (bootstrapState.status !== "ready" || resources.length === 0) {
    return <PlanningBootstrapStatus state={bootstrapState} onRetry={() => setLoadAttempt((current) => current + 1)} t={t} />;
  }

  return (
    <>
      <div className={styles.page}>
        <OrganizationPlanningCard resources={resources} onPersonSelect={selectPerson} t={t} />
        <UnderstaffingAnalysisCard teamSummaries={teamSummaries} t={t} />
        <MyAbsencesSummaryCard
          absences={absences}
          currentUserResourceId={currentUserResourceId}
          locale={locale}
          onNewAbsence={openNewAbsence}
          t={t}
        />
      </div>
      {selectedPerson ? (
        <PersonProfileCard
          profile={createPersonProfile(selectedPerson)}
          onClose={() => setSelectedPerson(undefined)}
          t={t}
        />
      ) : null}
      <SidePanel
        state={detailsPanelState}
        resources={resources}
        onClose={() => setDetailsPanelState({ kind: "closed" })}
        onDeleteAbsence={() => undefined}
        onSaveAbsence={saveAbsence}
        t={t}
      />
    </>
  );
}
