import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@fluentui/react-components";
import { AddRegular, ChevronDownRegular, ChevronUpRegular, FilterRegular } from "@fluentui/react-icons";
import { useLogger } from "../../core/logging";
import type { TranslationKey } from "../../localization/translations";
import type { Absence, AbsenceApprovalStatus, AbsenceDraft } from "../../models/absence";
import type { PublicHoliday } from "../../models/capacity";
import type { VacationRequestDraft, VacationRequestStatus } from "../../models/approval";
import type { DetailsPanelState } from "../../models/detailsPanel";
import type { PlanningEvent } from "../../models/planningEvent";
import type { ResourceSummary } from "../../models/resource";
import type { PlanningRepositories } from "../../repositories/planningRepositories";
import { approvalRepositories } from "../../repositories/defaultApprovalRepositories";
import { PlanningBootstrapStatus } from "../PlanningBootstrapStatus";
import {
  type AbsenceTimelineEditMode,
  absenceToPlanningEvent,
  calculateResourcesWithAbsences,
  createAbsenceFromDraft,
  editAbsenceOnTimeline,
  updateAbsenceFromDraft
} from "../../services/absenceCalculations";
import { calculateCapacity } from "../../services/capacityEngine";
import { getAbsenceTypeLabelByKey } from "../../data/absenceTypes";
import { createApprovalIntegrationService } from "../../services/approvalIntegrationService";
import { bootstrapPlanningState, invalidatePlanningBootstrapCache, type PlanningBootstrapState } from "../../services/planningBootstrapService";
import { getTeamAdminTeamSortOrder, getTeamIdForResource, getTeamColorsByTeamName, getDisplayConfigSnapshot, isApprovalExemptResource } from "../../features/team-admin/services/teamAdminApi";
import { getAssignedTeamColorStyle, getTeamColorStyle, resolveTeamColorKey } from "../../styles/teamColorPalette";
import { consumePendingVacationRequestId, storePendingVacationRequestId } from "../../services/vacationRequestDeepLink";
import { resolveActiveTeamId, resolveCurrentUserId } from "../../infrastructure/microsoft365/currentUser";
import { SidePanel } from "../detailsPanel/SidePanel";
import { groupResourcesByPerson, groupResourcesByPrimaryTeam } from "../teamGrouping/teamGroupingUtils";
import { PersonProfileCard } from "../../features/reports/components/PersonProfileCard";
import { createPersonProfile } from "../../features/reports/personProfile";
import { tryShowTeamsProfileCard } from "../../infrastructure/microsoft365/teamsProfileCard";
import { createTimelineDays, createTimelineDaysForDayCount, createTimelineMonths, createTimelineWeeks, getTimelineStart } from "./timelineDateUtils";
import { TimelineCalendar } from "./TimelineCalendar";
import { TimelineGrid } from "./TimelineGrid";
import { TimelineListView } from "./TimelineListView";
import { TimelineViewport } from "./TimelineViewport";
import type { HolidayCalendarTone } from "../../features/team-admin/services/holidayCalendarSlots";
import styles from "./Timeline.module.css";

interface TimelineProps {
  readonly locale: string;
  readonly repositories: PlanningRepositories;
  readonly t: (key: TranslationKey) => string;
}

type TimelinePeriod = "next30Days" | "nextThreeMonths" | "nextSixMonths" | "fullYear";
type TimelineGroupMode = "teams" | "people";
type TimelineViewMode = "gantt" | "list" | "calendar";
export type TimelineHolidayTone = HolidayCalendarTone;

export function Timeline({ locale, repositories, t }: TimelineProps) {
  const logger = useLogger();
  const timelineViewportRef = useRef<HTMLDivElement>(null);
  const [sourceResources, setSourceResources] = useState<readonly ResourceSummary[]>([]);
  const [absences, setAbsences] = useState<readonly Absence[]>([]);
  const [holidays, setHolidays] = useState<readonly PublicHoliday[]>([]);
  const [planningEvents, setPlanningEvents] = useState<readonly PlanningEvent[]>([]);
  const [bootstrapState, setBootstrapState] = useState<PlanningBootstrapState>({ status: "loading" });
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [collapsedGroupIds, setCollapsedGroupIds] = useState<ReadonlySet<string>>(() => new Set());
  const [detailsPanelState, setDetailsPanelState] = useState<DetailsPanelState>({ kind: "closed" });
  const [selectedPerson, setSelectedPerson] = useState<ResourceSummary>();
  const [period, setPeriod] = useState<TimelinePeriod>("nextThreeMonths");
  const [groupMode, setGroupMode] = useState<TimelineGroupMode>("teams");
  // EO-412: phones start in the list view — the gantt stays selectable via the control.
  const [viewMode, setViewMode] = useState<TimelineViewMode>(() =>
    typeof window !== "undefined" && window.innerWidth <= 560 ? "list" : "gantt"
  );
  const [isFilterVisible, setIsFilterVisible] = useState(false);
  const [filterText, setFilterText] = useState("");
  // EO-422: calendar view month navigation state.
  const [calendarYear, setCalendarYear] = useState(() => new Date().getFullYear());
  const [calendarMonth, setCalendarMonth] = useState(() => new Date().getMonth());
  const calendarMonthLabel = useMemo(
    () => new Intl.DateTimeFormat(locale, { month: "long", year: "numeric" }).format(new Date(calendarYear, calendarMonth, 1)),
    [calendarMonth, calendarYear, locale]
  );

  const navigateCalendarMonth = (offset: number) => {
    const target = new Date(calendarYear, calendarMonth + offset, 1);

    setCalendarYear(target.getFullYear());
    setCalendarMonth(target.getMonth());
  };
  const [currentUserGraphId, setCurrentUserGraphId] = useState<string>();
  const [submitNotice, setSubmitNotice] = useState<{ readonly kind: "success" | "error"; readonly text: string }>();
  const approvalService = useMemo(() => createApprovalIntegrationService(approvalRepositories, logger), [logger]);
  const days = useMemo(() => createDaysForPeriod(period), [period]);
  const months = useMemo(() => createTimelineMonths(days, locale), [days, locale]);
  const weeks = useMemo(() => createTimelineWeeks(days, locale, t("timelineCalendarWeekPrefix")), [days, locale, t]);
  const visibleDateKeys = useMemo(() => days.map((day) => day.key), [days]);
  const resources = useMemo(() => calculateResourcesWithAbsences(sourceResources, absences), [absences, sourceResources]);
  const resourcesById = useMemo(() => new Map(resources.map((resource) => [resource.id, resource])), [resources]);
  const absencesById = useMemo(() => new Map(absences.map((absence) => [absence.id, absence])), [absences]);
  const absencesByVacationRequestId = useMemo(
    () => new Map(absences.filter((absence) => absence.vacationRequestId).map((absence) => [absence.vacationRequestId as string, absence])),
    [absences]
  );
  const filteredResources = useMemo(() => filterResources(resources, filterText), [filterText, resources]);
  // Team ordering is persisted Team Admin state read imperatively at mount. It cannot change
  // while the Timeline is mounted (Team Admin is a separate route that remounts this component),
  // so it only needs to be resolved once per mount rather than tracking sourceResources.
  const teamSortOrder = useMemo(() => getTeamAdminTeamSortOrder(), []);
  const groups = useMemo(
    () => (groupMode === "teams" ? groupResourcesByPrimaryTeam(filteredResources, teamSortOrder) : groupResourcesByPerson(filteredResources, t("timelineGroupByPeople"))),
    [filteredResources, groupMode, t, teamSortOrder]
  );
  const capacity = useMemo(
    () => calculateCapacity({ resources: filteredResources, absences, dateKeys: days.map((day) => day.key), publicHolidays: holidays }, logger),
    [absences, days, filteredResources, holidays, logger]
  );
  const holidayTonesByDate = useMemo(() => createHolidayTonesByDate(holidays), [holidays]);
  const holidayLegendItems = useMemo(() => createHolidayLegendItems(holidays, t), [holidays, t]);
  const absenceEvents = useMemo(
    () => absences.map((absence) => absenceToPlanningEvent(absence, getAbsenceTypeLabelByKey(absence.type, t))),
    [absences, t]
  );
  const visibleResourceIds = useMemo(() => new Set(filteredResources.map((resource) => resource.id)), [filteredResources]);
  // EO-422: the calendar view navigates freely across months, so its events must
  // not be clipped to the selected period range (only to the visible resources).
  const calendarEvents = useMemo(
    () => [...planningEvents, ...absenceEvents].filter((event) => visibleResourceIds.has(event.resourceId)),
    [absenceEvents, planningEvents, visibleResourceIds]
  );
  const events = useMemo(
    () => [...planningEvents, ...absenceEvents].filter((event) => visibleResourceIds.has(event.resourceId) && isEventInVisibleRange(event, days)),
    [absenceEvents, days, planningEvents, visibleResourceIds]
  );
  const periodLabel = t(periodLabelKeyByPeriod[period]);

  // EO-423: event color mode (byType / byTeam) from tenant-wide display settings.
  const eventColorMode = getDisplayConfigSnapshot().eventColorMode;
  const teamColorsByTeamName = useMemo(() => getTeamColorsByTeamName(), []);
  const teamColorByResourceId = useMemo(() => {
    const map = new Map<string, { readonly background: string; readonly border: string; readonly text: string }>();
    resources.forEach((resource) => {
      const teamName = resource.primaryTeam;
      const assignedColor = teamColorsByTeamName.get(teamName);
      map.set(resource.id, getAssignedTeamColorStyle(teamName, assignedColor));
    });
    return map;
  }, [resources, teamColorsByTeamName]);

  useEffect(() => {
    let isCancelled = false;

    setBootstrapState({ status: "loading" });

    bootstrapPlanningState(repositories, logger, "Timeline", { forceRefresh: loadAttempt > 0 })
      .then((state) => {
        if (isCancelled) {
          return;
        }

        setBootstrapState(state);

        if (state.status === "ready" || state.status === "empty") {
          setSourceResources(state.snapshot.resources);
          setAbsences(state.snapshot.absences);
          setHolidays(state.snapshot.publicHolidays);
          setPlanningEvents(state.snapshot.planningEvents);
        }
      });

    return () => {
      isCancelled = true;
    };
  }, [loadAttempt, logger, repositories]);

  // Resolve the signed-in user (Teams host identity) for form defaults and actor context.
  useEffect(() => {
    resolveCurrentUserId(logger).then((userId) => setCurrentUserGraphId(userId));
  }, [logger]);

  const toggleGroup = useCallback((groupId: string) => {
    setCollapsedGroupIds((current) => {
      const next = new Set(current);

      if (next.has(groupId)) {
        next.delete(groupId);
      } else {
        next.add(groupId);
      }

      return next;
    });
  }, []);

  const openResourceDetails = useCallback((resource: ResourceSummary, targetRect?: DOMRect) => {
    void (async () => {
      // Inside Teams the native profile card is shown; the in-app card stays as
      // the fallback for browser access and mock data.
      if (targetRect && (await tryShowTeamsProfileCard(resource, targetRect, logger))) {
        return;
      }

      setSelectedPerson(resource);
    })();
  }, [logger]);

  const openEventDetails = useCallback((event: PlanningEvent) => {
    if (event.absenceId) {
      const absence = absencesById.get(event.absenceId);
      const resource = resourcesById.get(event.resourceId);

      if (absence && resource) {
        setDetailsPanelState({ kind: "absenceEdit", absence, resource });
        return;
      }
    }

    setDetailsPanelState({ kind: "event", event });
  }, [absencesById, resourcesById]);

  const openCreateAbsence = useCallback((resource: ResourceSummary, date: string) => {
    setDetailsPanelState({ kind: "absenceCreate", resource, date });
  }, []);

  // The signed-in user's resource row: Teams host identity first (api mode uses
  // Graph object ids), then the mock development identity.
  const findCurrentUserResource = () =>
    resources.find((resource) => resource.id === currentUserGraphId)
    ?? resources.find((resource) => resource.id === currentUserResourceId);

  const showSubmitNotice = useCallback((kind: "success" | "error", text: string) => {
    setSubmitNotice({ kind, text });

    if (kind === "success") {
      window.setTimeout(() => setSubmitNotice(undefined), 8_000);
    }
  }, []);

  const persistAbsence = useCallback(async (absence: Absence, operation: string): Promise<boolean> => {
    const result = await repositories.absences.saveAbsence(absence);

    if (!result.ok) {
      logger.warn("Absence could not be persisted.", {
        source: "ui",
        component: "Timeline",
        operation,
        details: {
          absenceId: absence.id,
          employeeId: absence.employeeId,
          errorCode: result.error.code,
          errorMessage: result.error.message,
          apiCode: result.error.details?.apiCode
        }
      });
      const detail =
        (typeof result.error.details?.apiCode === "string" && result.error.details.apiCode)
        || result.error.message
        || result.error.code;
      showSubmitNotice("error", `${t("absencePersistError")} (${detail})`);

      return false;
    }

    // The bootstrap snapshot is cached per repository composition; without
    // invalidation a remount would render the stale snapshot without this absence.
    invalidatePlanningBootstrapCache(repositories);

    return true;
  }, [logger, repositories, t, showSubmitNotice]);

  const saveAbsence = useCallback((draft: AbsenceDraft) => {
    if (detailsPanelState.kind === "absenceEdit") {
      const updatedAbsence = withApprovalExemptionStatus(updateAbsenceFromDraft(detailsPanelState.absence, draft));
      setAbsences((current) => current.map((absence) => (absence.id === updatedAbsence.id ? updatedAbsence : absence)));
      void persistAbsence(updatedAbsence, "updateAbsence");
      logger.info("Absence updated.", {
        source: "ui",
        component: "Timeline",
        operation: "updateAbsence",
        details: { absenceId: updatedAbsence.id, employeeId: updatedAbsence.employeeId }
      });
      setDetailsPanelState({ kind: "closed" });
      return;
    }

    const createdAbsence = withApprovalExemptionStatus(createAbsenceFromDraft(draft));
    setAbsences((current) => [...current, createdAbsence]);
    void persistAbsence(createdAbsence, "createAbsence");
    logger.info("Absence created.", {
      source: "ui",
      component: "Timeline",
      operation: "createAbsence",
      details: { absenceId: createdAbsence.id, employeeId: createdAbsence.employeeId }
    });
    setDetailsPanelState({ kind: "closed" });
  }, [detailsPanelState, logger, persistAbsence]);

  const requestAbsenceApproval = useCallback(async (draft: AbsenceDraft, options?: { readonly selectedApproverId?: string }) => {
    const panelState = detailsPanelState;
    const requestDraft = await createVacationRequestDraftFromAbsenceDraft(draft, resources);
    const actorId = currentUserGraphId ?? currentUserId;
    const saveResult = await approvalService.saveDraft(requestDraft, actorId);

    if (!saveResult.ok) {
      logger.warn("Vacation request draft could not be saved.", {
        source: "ui",
        component: "Timeline",
        operation: "saveVacationRequestDraft",
        details: { employeeId: draft.employeeId, errorCode: saveResult.error.code, errorMessage: saveResult.error.message }
      });
      showSubmitNotice("error", formatApprovalError(t("approvalSubmitError"), saveResult.error));
      return;
    }

    const submitResult = await approvalService.submitVacationRequest(saveResult.value, {
      requesterDisplayName: resources.find((resource) => resource.id === draft.employeeId)?.displayName ?? draft.employeeId,
      requesterPlanningRole: "employee",
      requesterUserType: "member"
    }, options);

    if (!submitResult.ok) {
      logger.warn("Vacation request could not be submitted.", {
        source: "ui",
        component: "Timeline",
        operation: "submitVacationRequest",
        details: { employeeId: draft.employeeId, errorCode: submitResult.error.code, errorMessage: submitResult.error.message }
      });
      showSubmitNotice("error", formatApprovalError(t("approvalSubmitError"), submitResult.error));
      return;
    }

    const approvalStatus = toAbsenceApprovalStatus(submitResult.value.request.status);
    const vacationRequestId = submitResult.value.request.id;
    const requestedAbsence: Absence = panelState.kind === "absenceEdit"
      ? { ...updateAbsenceFromDraft(panelState.absence, draft), approvalStatus, vacationRequestId }
      : { ...createAbsenceFromDraft(draft), approvalStatus, vacationRequestId };

    setAbsences((current) => {
      if (panelState.kind === "absenceEdit") {
        return current.map((absence) => (absence.id === requestedAbsence.id ? requestedAbsence : absence));
      }

      return [...current, requestedAbsence];
    });

    const persisted = await persistAbsence(requestedAbsence, "submitVacationRequest");

    if (persisted) {
      showSubmitNotice(
        "success",
        submitResult.value.request.status === "pendingApproval"
          ? t("approvalSubmitPending")
          : t("approvalSubmitAutoApproved")
      );
    }

    logger.info("Vacation request submitted from absence side panel.", {
      source: "ui",
      component: "Timeline",
      operation: "submitVacationRequest",
      details: {
        employeeId: draft.employeeId,
        absenceId: requestedAbsence.id,
        requestId: submitResult.value.request.id,
        status: submitResult.value.request.status
      }
    });
    setDetailsPanelState({ kind: "closed" });
  }, [approvalService, currentUserGraphId, detailsPanelState, logger, persistAbsence, resources, t]);

  const deleteAbsence = useCallback((absenceId: string) => {
    setAbsences((current) => current.filter((absence) => absence.id !== absenceId));
    void repositories.absences.deleteAbsence(absenceId);
    logger.info("Absence deleted.", {
      source: "ui",
      component: "Timeline",
      operation: "deleteAbsence",
      details: { absenceId }
    });
    setDetailsPanelState({ kind: "closed" });
  }, [logger, repositories]);

  const editTimelineAbsence = useCallback((event: PlanningEvent, mode: AbsenceTimelineEditMode, halfDayDelta: number) => {
    if (!event.absenceId) {
      return;
    }

    const absence = absencesById.get(event.absenceId);

    if (!absence) {
      return;
    }

    logger.debug("Timeline absence edit started.", {
      source: "ui",
      component: "Timeline",
      operation: mode,
      details: { absenceId: absence.id, halfDayDelta }
    });

    const result = editAbsenceOnTimeline(absence, mode, halfDayDelta, visibleDateKeys);

    if (!result.absence || !result.validation.isValid) {
      logger.warn("Timeline absence edit validation failed.", {
        source: "ui",
        component: "Timeline",
        operation: mode,
        details: { absenceId: absence.id, errors: result.validation.errors }
      });
      return;
    }

    setAbsences((current) => current.map((candidate) => (candidate.id === result.absence?.id ? result.absence : candidate)));
    void repositories.absences.saveAbsence(result.absence);
    logger.info("Timeline absence edited.", {
      source: "ui",
      component: "Timeline",
      operation: mode,
      details: { absenceId: result.absence.id, duration: result.absence.duration }
    });
  }, [absencesById, logger, repositories, visibleDateKeys]);

  const openDefaultCreateAbsence = useCallback(() => {
    // Default to the signed-in user; other people remain selectable in the form.
    const defaultResource = findCurrentUserResource() ?? filteredResources[0];
    const defaultDay = days.find((day) => day.isToday) ?? days[0];

    if (!defaultResource || !defaultDay) {
      return;
    }

    openCreateAbsence(defaultResource, defaultDay.key);
  }, [days, filteredResources, openCreateAbsence, resources, currentUserGraphId]);

  const scrollViewportToDayIndex = useCallback((dayIndex: number, behavior: ScrollBehavior) => {
    window.requestAnimationFrame(() => {
      const viewport = timelineViewportRef.current;

      if (!viewport || dayIndex < 0) {
        return;
      }

      const styles = window.getComputedStyle(viewport);
      const resourceColumnWidth = readPixelVariable(styles, "--timeline-resource-column", 280);
      const dayColumnWidth = readPixelVariable(styles, "--timeline-day-column", 36);
      const dayColumnCenter = resourceColumnWidth + dayIndex * dayColumnWidth + dayColumnWidth / 2;
      const visibleTimelineWidth = Math.max(0, viewport.clientWidth - resourceColumnWidth);
      const targetLeft = Math.max(0, dayColumnCenter - resourceColumnWidth - visibleTimelineWidth / 2);

      viewport.scrollTo({
        left: targetLeft,
        behavior
      });
    });
  }, []);

  const scrollViewportToToday = useCallback((behavior: ScrollBehavior) => {
    scrollViewportToDayIndex(days.findIndex((day) => day.isToday), behavior);
  }, [days, scrollViewportToDayIndex]);

  const scrollToToday = useCallback(() => {
    if (viewMode === "calendar") {
      const today = new Date();
      setCalendarYear(today.getFullYear());
      setCalendarMonth(today.getMonth());
      return;
    }

    if (viewMode !== "gantt") {
      setViewMode("gantt");
    }

    scrollViewportToToday("smooth");
  }, [scrollViewportToToday, viewMode]);

  // The timeline range includes the past 12 months; position the viewport on
  // today initially and whenever the range or view changes.
  useEffect(() => {
    if (viewMode === "gantt" && bootstrapState.status === "ready") {
      scrollViewportToToday("auto");
    }
  }, [days, viewMode, bootstrapState.status]);

  // EO-421R: an Outlook event deep link targets the absence entry itself — open
  // its details panel and scroll the timeline to its start date. When the linked
  // absence no longer exists (rejected/deleted), fall back to "Meine Anträge".
  useEffect(() => {
    if (bootstrapState.status !== "ready") {
      return;
    }

    const requestId = consumePendingVacationRequestId();

    if (!requestId) {
      return;
    }

    const absence = absencesByVacationRequestId.get(requestId) ?? absencesById.get(requestId);
    const resource = absence ? resourcesById.get(absence.employeeId) : undefined;

    if (!absence || !resource) {
      storePendingVacationRequestId(requestId);
      window.location.hash = "/approvals";
      return;
    }

    setDetailsPanelState({ kind: "absenceEdit", absence, resource });
    scrollViewportToDayIndex(days.findIndex((day) => day.key === absence.startDate), "smooth");
  }, [absencesById, absencesByVacationRequestId, bootstrapState.status, days, resourcesById, scrollViewportToDayIndex]);

  if (bootstrapState.status !== "ready") {
    return (
      <section className={styles.frame} aria-label={t("timelineAriaLabel")}>
        <PlanningBootstrapStatus state={bootstrapState} onRetry={() => setLoadAttempt((current) => current + 1)} t={t} />
      </section>
    );
  }

  return (
    <>
      <section className={styles.frame} aria-label={t("timelineAriaLabel")}>
        <div className={styles.toolbar}>
          <div className={styles.toolbarText}>
            <span className={styles.toolbarTitle}>{t("timelineTitle")}</span>
            <span className={styles.toolbarMeta}>{periodLabel}</span>
          </div>
          {/* EO-421: controls live in the title row to maximize vertical space. */}
          <div className={styles.toolbarControls} aria-label={t("timelineAriaLabel")}>
            <select
              aria-label={t("timelinePeriodLabel")}
              title={t("timelinePeriodLabel")}
              value={period}
              onChange={(event) => setPeriod(event.target.value as TimelinePeriod)}
            >
              <option value="next30Days">{t("timelinePeriodNext30Days")}</option>
              <option value="nextThreeMonths">{t("timelinePeriodNextThreeMonths")}</option>
              <option value="nextSixMonths">{t("timelinePeriodNextSixMonths")}</option>
              <option value="fullYear">{t("timelinePeriodFullYear")}</option>
            </select>
            <select
              aria-label={t("timelineGroupByLabel")}
              title={t("timelineGroupByLabel")}
              value={groupMode}
              onChange={(event) => setGroupMode(event.target.value as TimelineGroupMode)}
            >
              <option value="teams">{t("timelineGroupByTeams")}</option>
              <option value="people">{t("timelineGroupByPeople")}</option>
            </select>
            <select
              aria-label={t("timelineViewLabel")}
              title={t("timelineViewLabel")}
              value={viewMode}
              onChange={(event) => setViewMode(event.target.value as TimelineViewMode)}
            >
              <option value="gantt">{t("timelineViewGantt")}</option>
              <option value="list">{t("timelineViewList")}</option>
              {/* EO-422: calendar (month) view */}
              <option value="calendar">📅 {t("timelineViewCalendar")}</option>
            </select>
            <Button size="small" onClick={scrollToToday}>{t("timelineToday")}</Button>
            {/* EO-422R: calendar month navigation lives in the toolbar (Outlook order),
                so the calendar itself needs no extra chrome row. */}
            {viewMode === "calendar" ? (
              <>
                <Button
                  size="small"
                  appearance="subtle"
                  icon={<ChevronUpRegular />}
                  aria-label={t("timelineCalendarPrev")}
                  onClick={() => navigateCalendarMonth(-1)}
                />
                <Button
                  size="small"
                  appearance="subtle"
                  icon={<ChevronDownRegular />}
                  aria-label={t("timelineCalendarNext")}
                  onClick={() => navigateCalendarMonth(1)}
                />
                <span className={styles.toolbarMonthLabel}>{calendarMonthLabel}</span>
              </>
            ) : null}
            <Button
              appearance={isFilterVisible || filterText ? "primary" : "secondary"}
              size="small"
              icon={<FilterRegular />}
              onClick={() => setIsFilterVisible((current) => !current)}
            >
              {t("timelineFilter")}
            </Button>
          </div>
          <Button
            appearance="primary"
            icon={<AddRegular />}
            onClick={openDefaultCreateAbsence}
          >
            {t("absenceNew")}
          </Button>
        </div>
        {submitNotice ? (
          <div
            className={`${styles.submitNotice} ${submitNotice.kind === "error" ? styles.submitNoticeError : styles.submitNoticeSuccess}`}
            role={submitNotice.kind === "error" ? "alert" : "status"}
          >
            <span>{submitNotice.text}</span>
            <button aria-label={t("personCardClose")} onClick={() => setSubmitNotice(undefined)} type="button">×</button>
          </div>
        ) : null}
        {isFilterVisible ? (
          <div className={styles.filterBar}>
            <input
              aria-label={t("timelineFilterLabel")}
              type="search"
              value={filterText}
              onChange={(event) => setFilterText(event.target.value)}
              placeholder={t("timelineFilterPlaceholder")}
            />
          </div>
        ) : null}
        {viewMode === "calendar" ? (
          <TimelineCalendar
            year={calendarYear}
            month={calendarMonth}
            events={calendarEvents}
            locale={locale}
            resources={filteredResources}
            holidayTonesByDate={holidayTonesByDate}
            eventColorMode={eventColorMode}
            teamColorByResourceId={teamColorByResourceId}
            onOpenEvent={openEventDetails}
            t={t}
          />
        ) : viewMode === "gantt" ? (
          <TimelineViewport ref={timelineViewportRef}>
            <TimelineGrid
              days={days}
              collapsedGroupIds={collapsedGroupIds}
              employeeColumnLabel={t("timelineEmployeeColumn")}
              events={events}
              groups={groups}
              holidayTonesByDate={holidayTonesByDate}
              capacityByEmployeeId={capacity.byEmployeeId}
              months={months}
              eventColorMode={eventColorMode}
              teamColorByResourceId={teamColorByResourceId}
              onCreateAbsence={openCreateAbsence}
              onTimelineEdit={editTimelineAbsence}
              onOpenEvent={openEventDetails}
              onOpenResource={openResourceDetails}
              onToggleGroup={toggleGroup}
              t={t}
              weeks={weeks}
            />
          </TimelineViewport>
        ) : (
          <TimelineListView events={events} groups={groups} eventColorMode={eventColorMode} teamColorByResourceId={teamColorByResourceId} onOpenEvent={openEventDetails} onOpenResource={openResourceDetails} t={t} />
        )}
        {/* EO-421: the legend is a slim footer line instead of control-bar chrome. */}
        <div className={styles.legend}>
          {holidayLegendItems.map((item) => (
            <span key={`${item.tone}-${item.label}`}>
              <i className={getLegendToneClass(item.tone)} />
              {item.label}
            </span>
          ))}
          {/* EO-423: in by-team mode, show team colors in the legend */}
          {eventColorMode === "byTeam" && Array.from(teamColorsByTeamName.entries()).map(([teamName, colorKey]) => {
            const style = getTeamColorStyle(resolveTeamColorKey(teamName, colorKey));
            return (
              <span key={teamName}>
                <i className={styles.legendTeamColor} style={{ background: style.background, borderColor: style.border }} />
                {teamName}
              </span>
            );
          })}
        </div>
      </section>
      <SidePanel
        state={detailsPanelState}
        resources={resources}
        isApprovalExemptResource={(resource) => isApprovalExemptResource(resource.id)}
        onClose={() => setDetailsPanelState({ kind: "closed" })}
        onDeleteAbsence={deleteAbsence}
        onRequestAbsenceApproval={requestAbsenceApproval}
        onSaveAbsence={saveAbsence}
        t={t}
      />
      {selectedPerson ? (
        <PersonProfileCard
          profile={createPersonProfile(selectedPerson)}
          onClose={() => setSelectedPerson(undefined)}
          t={t}
        />
      ) : null}
    </>
  );
}

function withApprovalExemptionStatus(absence: Absence): Absence {
  return isApprovalExemptResource(absence.employeeId)
    ? { ...absence, approvalStatus: "approved" }
    : absence;
}

function readPixelVariable(styles: CSSStyleDeclaration, name: string, fallback: number): number {
  const value = Number.parseFloat(styles.getPropertyValue(name));

  return Number.isFinite(value) && value > 0 ? value : fallback;
}

// The visible range always includes the past 12 months (scrollable); the selected
// period controls how far the range extends into the future. The viewport is
// auto-positioned on today.
const timelinePastMonths = 12;

function createDaysForPeriod(period: TimelinePeriod) {
  const futureStart = getTimelineStart();
  const pastStart = new Date(futureStart.getFullYear(), futureStart.getMonth() - timelinePastMonths, 1);

  if (period === "next30Days") {
    const pastDayCount = Math.round((futureStart.getTime() - pastStart.getTime()) / (24 * 60 * 60 * 1000));

    return createTimelineDaysForDayCount(pastStart, pastDayCount + 30);
  }

  if (period === "nextSixMonths") {
    return createTimelineDays(pastStart, timelinePastMonths + 6);
  }

  if (period === "fullYear") {
    return createTimelineDays(pastStart, timelinePastMonths + 12);
  }

  return createTimelineDays(pastStart, timelinePastMonths + 3);
}

function filterResources(resources: readonly ResourceSummary[], filterText: string): readonly ResourceSummary[] {
  const normalizedFilter = filterText.trim().toLocaleLowerCase();

  if (!normalizedFilter) {
    return resources;
  }

  return resources.filter((resource) =>
    [resource.displayName, resource.primaryTeam, resource.organization, ...resource.additionalTeams]
      .join(" ")
      .toLocaleLowerCase()
      .includes(normalizedFilter)
  );
}

function toAbsenceApprovalStatus(status: VacationRequestStatus): AbsenceApprovalStatus {
  if (status === "approved") {
    return "approved";
  }

  if (status === "rejected") {
    return "rejected";
  }

  if (status === "submitted" || status === "pendingApproval") {
    return "pendingApproval";
  }

  return "draft";
}

function formatApprovalError(
  baseMessage: string,
  error: { readonly code: string; readonly message?: string; readonly details?: Record<string, unknown> }
): string {
  const apiCode = typeof error.details?.apiCode === "string" ? error.details.apiCode : undefined;
  const detail = apiCode || error.message || error.code;
  return `${baseMessage} (${detail})`;
}

async function createVacationRequestDraftFromAbsenceDraft(
  draft: AbsenceDraft,
  resources: readonly ResourceSummary[]
): Promise<VacationRequestDraft> {
  const resource = resources.find((candidate) => candidate.id === draft.employeeId);

  return {
    teamId: await resolveApprovalTeamId(resource),
    userId: resolveApprovalUserId(resource),
    absenceType: draft.type,
    startDate: draft.startDate,
    startHalf: draft.startHalf,
    endDate: draft.endDate,
    endHalf: draft.endHalf,
    comment: draft.comment,
    // Default off: Outlook write-back is opt-in (team policy can still require it later).
    syncToOutlook: false
  };
}

async function resolveApprovalTeamId(resource: ResourceSummary | undefined): Promise<string> {
  // Prefer internal planning team id (Team Admin), then the active M365 host group id
  // (list filter expands host → internal teams), then the display name as last resort.
  if (resource) {
    const internalTeamId = getTeamIdForResource(resource.id);
    if (internalTeamId) {
      return internalTeamId;
    }
  }

  try {
    const hostTeamId = await resolveActiveTeamId();
    if (hostTeamId) {
      return hostTeamId;
    }
  } catch {
    // fall through
  }

  return resource?.primaryTeam || "unknown";
}

function resolveApprovalUserId(resource: ResourceSummary | undefined): string {
  return resource?.id.replace("resource-", "") ?? "unknown";
}

function isEventInVisibleRange(event: PlanningEvent, days: readonly { readonly key: string }[]): boolean {
  const firstDay = days[0]?.key;
  const lastDay = days[days.length - 1]?.key;

  if (!firstDay || !lastDay) {
    return false;
  }

  return event.startDate <= lastDay && event.endDate >= firstDay;
}

function createHolidayTonesByDate(holidays: readonly PublicHoliday[]): ReadonlyMap<string, TimelineHolidayTone> {
  const tones = new Map<string, TimelineHolidayTone>();

  holidays.forEach((holiday) => {
    const tone = resolveHolidayTone(holiday.location);

    if (!tone) {
      return;
    }

    const existing = tones.get(holiday.date);

    if (!existing || tonePriority(tone) < tonePriority(existing)) {
      tones.set(holiday.date, tone);
    }
  });

  return tones;
}

interface HolidayLegendItem {
  readonly tone: TimelineHolidayTone;
  readonly label: string;
}

function createHolidayLegendItems(
  holidays: readonly PublicHoliday[],
  t: (key: TranslationKey) => string
): readonly HolidayLegendItem[] {
  const itemsByTone = new Map<TimelineHolidayTone, HolidayLegendItem>();

  holidays.forEach((holiday) => {
    const tone = resolveHolidayTone(holiday.location);

    if (!tone || itemsByTone.has(tone)) {
      return;
    }

    itemsByTone.set(tone, {
      tone,
      label: resolveHolidayLegendLabel(holiday.location, tone, t)
    });
  });

  return Array.from(itemsByTone.values()).sort((a, b) => tonePriority(a.tone) - tonePriority(b.tone));
}

function resolveHolidayTone(location: string | undefined): TimelineHolidayTone | undefined {
  if (!location) {
    return "publicHoliday1";
  }

  const parts = location.split(":");
  const toneCandidate = parts[parts.length - 1];

  if (isHolidayTone(toneCandidate)) {
    return toneCandidate;
  }

  const baseLocation = parts[0];

  if (baseLocation.startsWith("public-")) {
    return (`publicHoliday${clampToneIndex(baseLocation)}`) as TimelineHolidayTone;
  }

  function isHolidayTone(value: string | undefined): value is TimelineHolidayTone {
    return value === "publicHoliday1"
      || value === "publicHoliday2"
      || value === "publicHoliday3"
      || value === "schoolHoliday1"
      || value === "schoolHoliday2"
      || value === "schoolHoliday3";
  }

  if (baseLocation.startsWith("school-")) {
    return (`schoolHoliday${clampToneIndex(baseLocation)}`) as TimelineHolidayTone;
  }

  if (baseLocation === "SG") {
    return "schoolHoliday1";
  }

  if (baseLocation === "Dübendorf") {
    return "schoolHoliday2";
  }

  if (baseLocation === "Custom") {
    return "schoolHoliday3";
  }

  return "schoolHoliday3";
}

function clampToneIndex(location: string): 1 | 2 | 3 {
  const index = Number.parseInt(location.split("-")[1]?.slice(0, 1) ?? "1", 10);

  if (!Number.isFinite(index)) {
    return 1;
  }

  return Math.min(3, Math.max(1, index)) as 1 | 2 | 3;
}

function tonePriority(tone: TimelineHolidayTone): number {
  const order: Record<TimelineHolidayTone, number> = {
    publicHoliday1: 1,
    publicHoliday2: 2,
    publicHoliday3: 3,
    schoolHoliday1: 4,
    schoolHoliday2: 5,
    schoolHoliday3: 6
  };

  return order[tone];
}

function getLegendToneClass(tone: TimelineHolidayTone): string {
  const classByTone: Record<TimelineHolidayTone, string> = {
    publicHoliday1: styles.legendHoliday,
    publicHoliday2: styles.legendHoliday2,
    publicHoliday3: styles.legendHoliday3,
    schoolHoliday1: styles.legendSg,
    schoolHoliday2: styles.legendDubendorf,
    schoolHoliday3: styles.legendSchool3
  };

  return classByTone[tone];
}

function resolveHolidayLegendLabel(
  location: string | undefined,
  tone: TimelineHolidayTone,
  t: (key: TranslationKey) => string
): string {
  if (!location) {
    return t("timelineLegendPublicHoliday");
  }

  const parts = location.split(":");

  if (parts.length > 1) {
    const encoded = parts[1];

    try {
      const decoded = decodeURIComponent(encoded);
      if (decoded.trim().length > 0) {
        return decoded;
      }
    } catch {
      // Ignore malformed label encoding and fall back to defaults.
    }
  }

  if (tone === "schoolHoliday1") {
    return t("timelineLegendSchoolHolidaySg");
  }

  if (tone === "schoolHoliday2") {
    return t("timelineLegendSchoolHolidayDubendorf");
  }

  return t("timelineLegendPublicHoliday");
}

const periodLabelKeyByPeriod = {
  next30Days: "timelinePeriodNext30Days",
  nextThreeMonths: "timelinePeriodNextThreeMonths",
  nextSixMonths: "timelinePeriodNextSixMonths",
  fullYear: "timelinePeriodFullYear"
} as const satisfies Record<TimelinePeriod, TranslationKey>;

const currentUserId = "gianni-zanetti";
const currentUserResourceId = `resource-${currentUserId}`;
