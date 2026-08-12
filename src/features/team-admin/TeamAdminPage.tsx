import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, ColorSwatch, Input, Popover, PopoverSurface, PopoverTrigger, Spinner, SwatchPicker, Tooltip } from "@fluentui/react-components";
import { useLogger } from "../../core/logging";
import type { TranslationKey } from "../../localization/translations";
import { invalidatePlanningBootstrapCache } from "../../services/planningBootstrapService";
import { OrganisationLocationCard } from "./components/OrganisationLocationCard";
import { ApprovalPolicyCard } from "./components/ApprovalPolicyCard";
import { AbsenceEntryTypesCard } from "./components/AbsenceEntryTypesCard";
import { TeamManagementCard } from "./components/TeamManagementCard";
import { DisplaySettingsCard } from "./components/DisplaySettingsCard";
import { TeamMembersTable } from "./components/TeamMembersTable";
import { TeamSelector } from "./components/TeamSelector";
import { TeamSettingsCard } from "./components/TeamSettingsCard";
import {
  allTeamsId,
  createTeam,
  deleteTeam,
  getAccessInfo,
  getAllTeamDetails,
  getManagedTeams,
  getTeamDetails,
  patchAllTeamMembers,
  patchTeamSettings,
  removeMemberFromPlanning as removeMemberFromPlanningApi,
  reorderTeam,
  renameTeam,
  setTeamColor,
  setTeamOrganization,
  setTeamRequiredStaffing,
  TeamAdminValidationError,
  type AccessInfo
} from "./services/teamAdminApi";
import {
  createDefaultHolidaySlots,
  defaultToneForSlot,
  getHolidayCalendarToneStyle,
  holidayCalendarToneKeys,
  refreshHolidayCalendarSlotsWithFeedback,
  sanitizeHolidaySlots,
  type HolidayCalendarSlot,
  type HolidayCalendarTone,
  type HolidaySourceType,
  type MicrosoftHolidayPreset
} from "./services/holidayCalendarSlots";
import type { TeamAdminValidationCode } from "./services/teamAdminApi";
import type {
  TeamAdminDetails,
  TeamAdminAbsenceEntryType,
  TeamAdminMember,
  TeamAdminOutlookSyncPolicy,
  TeamAdminSummary
} from "./types/teamSettings";
import styles from "./TeamAdminPage.module.css";

interface TeamAdminPageProps {
  readonly t: (key: TranslationKey) => string;
}

const teamManagementErrorKeys: Record<TeamAdminValidationCode, TranslationKey> = {
  teamNameRequired: "teamAdminTeamNameRequired",
  teamNameDuplicate: "teamAdminTeamNameDuplicate",
  teamHasMembers: "teamAdminTeamHasMembers",
  lastTeam: "teamAdminTeamLastTeam"
};

const calendarToneStyles: Readonly<Record<HolidayCalendarTone, { readonly background: string; readonly border: string; readonly text: string }>> =
  Object.fromEntries(holidayCalendarToneKeys.map((tone) => [tone, getHolidayCalendarToneStyle(tone)])) as Readonly<
    Record<HolidayCalendarTone, { readonly background: string; readonly border: string; readonly text: string }>
  >;

export function TeamAdminPage({ t }: TeamAdminPageProps) {
  const logger = useLogger();
  const [teams, setTeams] = useState<readonly TeamAdminSummary[]>([]);
  const [selectedTeamId, setSelectedTeamId] = useState("");
  const [details, setDetails] = useState<TeamAdminDetails>();
  const [teamLeadUserId, setTeamLeadUserId] = useState("");
  const [defaultApproverUserId, setDefaultApproverUserId] = useState("");
  const [backupApproverUserId, setBackupApproverUserId] = useState("");
  const [allowUserOverride, setAllowUserOverride] = useState(true);
  const [outlookSync, setOutlookSync] = useState<TeamAdminOutlookSyncPolicy>("optional");
  const [absenceEntryTypes, setAbsenceEntryTypes] = useState<readonly TeamAdminAbsenceEntryType[]>([]);
  const [memberDrafts, setMemberDrafts] = useState<readonly TeamAdminMember[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [calendarYear, setCalendarYear] = useState(() => new Date().getFullYear());
  const [holidaySlots, setHolidaySlots] = useState<readonly HolidayCalendarSlot[]>(() => createDefaultHolidaySlots());
  const [refreshingHolidaySlotIds, setRefreshingHolidaySlotIds] = useState<ReadonlySet<string>>(() => new Set());
  const [toast, setToast] = useState<string>();
  const [error, setError] = useState<string>();
  const [accessInfo, setAccessInfo] = useState<AccessInfo>();
  const lastSavedSignature = useRef("");
  /** Serializes autosaves so an older in-flight PATCH cannot re-create a just-removed member. */
  const saveInFlightRef = useRef(false);
  const saveQueuedRef = useRef(false);
  const saveSnapshotRef = useRef({
    teamLeadUserId: "",
    defaultApproverUserId: "",
    backupApproverUserId: "",
    allowUserOverride: true,
    outlookSync: "optional" as TeamAdminOutlookSyncPolicy,
    memberDrafts: [] as readonly TeamAdminMember[],
    absenceEntryTypes: [] as readonly TeamAdminAbsenceEntryType[],
    removedMemberIds: [] as readonly string[],
    details: undefined as TeamAdminDetails | undefined,
    isAllTeamsView: false
  });

  useEffect(() => {
    getAccessInfo().then(setAccessInfo);
  }, []);

  useEffect(() => {
    let isCancelled = false;

    // EO-420: the previously resolved activeTeamId is the M365 host-group id and never
    // matches internal planning team ids — the server already scopes managedTeams to
    // the host team, so simply select the first team.
    getManagedTeams()
      .then((managedTeams) => {
        if (isCancelled) {
          return;
        }

        setTeams(managedTeams);
        const selectedActiveTeamId = managedTeams[0]?.teamId ?? "";
        setSelectedTeamId(selectedActiveTeamId);

        if (!selectedActiveTeamId) {
          setIsLoading(false);
          // Do not set error - we want to show the empty management card instead
        }
      })
      .catch((loadError: unknown) => {
        logger.error("Managed teams could not be loaded.", {
          source: "team-admin",
          component: "TeamAdminPage",
          operation: "loadTeams"
        }, loadError);
        setError(t("teamAdminLoadError"));
        setIsLoading(false);
      });

    return () => {
      isCancelled = true;
    };
  }, [logger, t]);

  useEffect(() => {
    if (!selectedTeamId) {
      return;
    }

    let isCancelled = false;
    setIsLoading(true);
    setError(undefined);

    const loadDetails = selectedTeamId === allTeamsId ? getAllTeamDetails : () => getTeamDetails(selectedTeamId);

    loadDetails()
      .then((loadedDetails) => {
        if (!isCancelled) {
          applyDetails(loadedDetails);
        }
      })
      .catch((loadError: unknown) => {
        logger.error("Team admin details could not be loaded.", {
          source: "team-admin",
          component: "TeamAdminPage",
          operation: "loadDetails",
          details: { teamId: selectedTeamId }
        }, loadError);
        setError(t("teamAdminLoadError"));
      })
      .finally(() => {
        if (!isCancelled) {
          setIsLoading(false);
        }
      });

    return () => {
      isCancelled = true;
    };
  }, [logger, selectedTeamId, t]);

  const applyDetails = (loadedDetails: TeamAdminDetails) => {
    setDetails(loadedDetails);
    setTeamLeadUserId(loadedDetails.settings.teamLeadUserId);
    setDefaultApproverUserId(loadedDetails.settings.defaultApproverUserId);
    setBackupApproverUserId(loadedDetails.settings.backupApproverUserId ?? "");
    setAllowUserOverride(loadedDetails.settings.approvalPolicy.allowUserOverride);
    setOutlookSync(loadedDetails.settings.approvalPolicy.outlookSync);
    setAbsenceEntryTypes(loadedDetails.absenceEntryTypes);
    setMemberDrafts(loadedDetails.members);
    setRemovedMemberIds([]);
    lastSavedSignature.current = createSettingsSignature(
      loadedDetails.settings.teamLeadUserId,
      loadedDetails.settings.defaultApproverUserId,
      loadedDetails.settings.backupApproverUserId ?? "",
      loadedDetails.settings.approvalPolicy.allowUserOverride,
      loadedDetails.settings.approvalPolicy.outlookSync,
      loadedDetails.members,
      loadedDetails.absenceEntryTypes,
      []
    );
    setToast(undefined);
  };

  const defaultApproverOptions = useMemo(
    () => details?.allowedApprovers ?? [],
    [details]
  );
  const backupApproverOptions = details?.allowedApprovers ?? [];
  const isAllTeamsView = selectedTeamId === allTeamsId;

  useEffect(() => {
    const firstApproverUserId = defaultApproverOptions[0]?.userId;

    if (!firstApproverUserId) {
      return;
    }

    const defaultApproverIds = new Set(defaultApproverOptions.map((approver) => approver.userId));
    const backupApproverIds = new Set(backupApproverOptions.map((approver) => approver.userId));

    if (backupApproverIds.size > 0 && !backupApproverIds.has(teamLeadUserId)) {
      setTeamLeadUserId(backupApproverOptions[0].userId);
    }

    if (!defaultApproverIds.has(defaultApproverUserId)) {
      setDefaultApproverUserId(firstApproverUserId);
    }

    if (backupApproverUserId && !backupApproverIds.has(backupApproverUserId)) {
      setBackupApproverUserId("");
    }
  }, [backupApproverOptions, backupApproverUserId, defaultApproverOptions, defaultApproverUserId, teamLeadUserId]);

  const updateMemberDraft = (userId: string, update: (member: TeamAdminMember) => TeamAdminMember) => {
    setMemberDrafts((currentMembers) =>
      currentMembers.map((member) => member.userId === userId ? update(member) : member)
    );
  };

  const changeMemberPrimaryTeam = (userId: string, primaryTeamId: string) => {
    const primaryTeamName = details?.teamOptions.find((team) => team.teamId === primaryTeamId)?.teamName ?? primaryTeamId;
    updateMemberDraft(userId, (member) => ({
      ...member,
      primaryTeamId,
      primaryTeamName,
      additionalPositions: member.additionalPositions.filter((position) => position !== primaryTeamName)
    }));
  };

  const changeMemberPositions = (userId: string, positions: readonly string[]) => {
    const validTeamNames = new Set(details?.teamOptions.map((team) => team.teamName) ?? []);

    updateMemberDraft(userId, (member) => ({
      ...member,
      additionalPositions: positions
        .filter((position) => position !== member.primaryTeamName)
        .filter((position) => validTeamNames.has(position))
    }));
  };

  // Members removed in the UI but not yet saved — backend deletes host-scoped
  // assignments when primaryTeamId and additional teams are empty.
  const [removedMemberIds, setRemovedMemberIds] = useState<readonly string[]>([]);

  const addMemberToSelectedTeam = (userId: string) => {
    const selectedTeamName = details?.team.teamName;
    const member =
      details?.assignableMembers.find((candidate) => candidate.userId === userId)
      ?? details?.members.find((candidate) => candidate.userId === userId);

    if (!selectedTeamName || !member) {
      return;
    }

    const additionalPositions = member.additionalPositions.includes(selectedTeamName)
      ? member.additionalPositions
      : [...member.additionalPositions, selectedTeamName];

    setRemovedMemberIds((current) => current.filter((id) => id !== userId));
    setMemberDrafts((currentMembers) => [
      ...currentMembers.filter((candidate) => candidate.userId !== userId),
      {
        ...member,
        additionalPositions
      }
    ]);
  };

  const removeMemberFromPlanning = (userId: string) => {
    const previousDrafts = memberDrafts;
    // Optimistic UI only — do not touch removedMemberIds (that would trigger the debounced
    // full settings PATCH and race with the dedicated remove API).
    setMemberDrafts((currentMembers) => currentMembers.filter((member) => member.userId !== userId));

    // Hard-delete immediately. Entra-deleted orphans only show as a GUID and must leave
    // TeamAdminMemberAssignments in the same click.
    void (async () => {
      try {
        setError(undefined);
        setIsSaving(true);
        const result = await removeMemberFromPlanningApi(userId);
        invalidatePlanningBootstrapCache();
        if (selectedTeamId) {
          applyDetails(await (selectedTeamId === allTeamsId ? getAllTeamDetails() : getTeamDetails(selectedTeamId)));
        }
        setTeams(await getManagedTeams());
        setToast(
          result.removedAssignments > 0
            ? t("teamAdminSavedToast")
            : t("teamAdminMemberRemoveEmpty")
        );
      } catch (removeError: unknown) {
        // Roll the row back so a failed API call does not look like a successful remove.
        setMemberDrafts(previousDrafts);
        logger.error("Team admin member could not be removed.", {
          source: "team-admin",
          component: "TeamAdminPage",
          operation: "removeMember",
          details: {
            userId,
            teamId: selectedTeamId,
            message: removeError instanceof Error ? removeError.message : String(removeError)
          }
        }, removeError);
        setError(t("teamAdminMemberRemoveError"));
      } finally {
        setIsSaving(false);
      }
    })();
  };

  const changeMemberApprovalExempt = (userId: string, approvalExempt: boolean) => {
    updateMemberDraft(userId, (member) => ({ ...member, approvalExempt }));
  };

  const changeMemberEmploymentPercentage = (userId: string, employmentPercentage: number) => {
    updateMemberDraft(userId, (member) => ({ ...member, employmentPercentage: normalizePercentage(employmentPercentage) }));
  };

  const changeMemberVacationBalance = (userId: string, vacationBalance: number) => {
    updateMemberDraft(userId, (member) => ({ ...member, vacationBalance: normalizeVacationBalance(vacationBalance) }));
  };

  const changeMemberEffectiveApprover = (userId: string, effectiveApproverUserId: string) => {
    const effectiveApprover = backupApproverOptions.find((approver) => approver.userId === effectiveApproverUserId);

    if (!effectiveApprover) {
      return;
    }

    updateMemberDraft(userId, (member) => ({ ...member, effectiveApproverUserId, effectiveApprover }));
  };

  const changeAbsenceEntryType = (
    key: TeamAdminAbsenceEntryType["key"],
    update: (entryType: TeamAdminAbsenceEntryType) => TeamAdminAbsenceEntryType
  ) => {
    setAbsenceEntryTypes((currentEntryTypes) =>
      currentEntryTypes.map((entryType) => entryType.key === key ? update(entryType) : entryType)
    );
  };

  const addAbsenceEntryType = (label: string) => {
    const normalizedLabel = label.trim();

    if (!normalizedLabel) {
      return;
    }

    const keyBase = normalizedLabel
      .toLocaleLowerCase()
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "") || "custom-entry-type";
    const existingKeys = new Set(absenceEntryTypes.map((entryType) => entryType.key));
    let key = `custom-${keyBase}`;
    let suffix = 2;

    while (existingKeys.has(key)) {
      key = `custom-${keyBase}-${suffix}`;
      suffix += 1;
    }

    setAbsenceEntryTypes((currentEntryTypes) => [
      ...currentEntryTypes,
      {
        key,
        label: normalizedLabel,
        active: true,
        requiresApproval: true,
        consumesVacationBalance: false
      }
    ]);
  };

  const deleteAbsenceEntryType = (key: TeamAdminAbsenceEntryType["key"]) => {
    setAbsenceEntryTypes((currentEntryTypes) => currentEntryTypes.filter((entryType) => entryType.key !== key));
  };

  const runTeamManagement = async (operation: string, action: () => Promise<string | undefined>) => {
    setToast(undefined);
    setError(undefined);

    try {
      const nextSelectedTeamId = await action();
      invalidatePlanningBootstrapCache();
      setTeams(await getManagedTeams());

      if (nextSelectedTeamId && nextSelectedTeamId !== selectedTeamId) {
        setSelectedTeamId(nextSelectedTeamId);
      } else if (selectedTeamId) {
        applyDetails(await (selectedTeamId === allTeamsId ? getAllTeamDetails() : getTeamDetails(selectedTeamId)));
      }

      setToast(t("teamAdminTeamManagementUpdatedToast"));
    } catch (managementError: unknown) {
      if (managementError instanceof TeamAdminValidationError) {
        setError(t(teamManagementErrorKeys[managementError.code]));
        return;
      }

      logger.error("Team management operation failed.", {
        source: "team-admin",
        component: "TeamAdminPage",
        operation,
        details: { teamId: selectedTeamId }
      }, managementError);
      setError(t("teamAdminSaveError"));
    }
  };

  const handleTeamCreate = (teamName: string, organization: string) =>
    runTeamManagement("createTeam", async () => {
      const createdTeam = await createTeam(teamName, organization);
      return createdTeam.teamId;
    });

  const handleTeamRename = (teamId: string, teamName: string) =>
    runTeamManagement("renameTeam", async () => {
      await renameTeam(teamId, teamName);
      return undefined;
    });

  const handleTeamOrganizationChange = (teamId: string, organization: string) =>
    runTeamManagement("setTeamOrganization", async () => {
      await setTeamOrganization(teamId, organization);
      return undefined;
    });

  const handleTeamRequiredStaffingChange = (teamId: string, requiredStaffing: number) =>
    runTeamManagement("setTeamRequiredStaffing", async () => {
      await setTeamRequiredStaffing(teamId, requiredStaffing);
      return undefined;
    });

  const handleTeamColorChange = (teamId: string, color: string) =>
    runTeamManagement("setTeamColor", async () => {
      await setTeamColor(teamId, color);
      return undefined;
    });

  const handleTeamReorder = (teamId: string, targetTeamId: string) =>
    runTeamManagement("reorderTeam", async () => {
      await reorderTeam(teamId, targetTeamId);
      return undefined;
    });

  const handleTeamDelete = (teamId: string) =>
    runTeamManagement("deleteTeam", async () => {
      await deleteTeam(teamId);

      if (teamId !== selectedTeamId) {
        return undefined;
      }

      const remainingTeams = await getManagedTeams();
      return remainingTeams[0]?.teamId;
    });

  // Keep the latest editor state in a ref so serialized saves always flush the newest
  // removal list, even when an earlier PATCH is still in flight.
  saveSnapshotRef.current = {
    teamLeadUserId,
    defaultApproverUserId,
    backupApproverUserId,
    allowUserOverride,
    outlookSync,
    memberDrafts,
    absenceEntryTypes,
    removedMemberIds,
    details,
    isAllTeamsView
  };

  const save = useCallback(async (showSavedToast = true) => {
    if (saveInFlightRef.current) {
      saveQueuedRef.current = true;
      return;
    }

    saveInFlightRef.current = true;
    setIsSaving(true);
    if (showSavedToast) {
      setToast(undefined);
    }
    setError(undefined);

    try {
      do {
        saveQueuedRef.current = false;
        const snapshot = saveSnapshotRef.current;
        const activeDetails = snapshot.details;

        if (!activeDetails) {
          break;
        }

        const signature = createSettingsSignature(
          snapshot.teamLeadUserId,
          snapshot.defaultApproverUserId,
          snapshot.backupApproverUserId,
          snapshot.allowUserOverride,
          snapshot.outlookSync,
          snapshot.memberDrafts,
          snapshot.absenceEntryTypes,
          snapshot.removedMemberIds
        );

        if (signature === lastSavedSignature.current) {
          continue;
        }

        // Removals: empty primary + no additional teams deletes host-scoped assignments (API).
        const memberAssignments = [
          ...snapshot.memberDrafts.map((member) => ({
            userId: member.userId,
            primaryTeamId: member.primaryTeamId,
            additionalPositions: member.additionalPositions,
            approvalExempt: member.approvalExempt,
            employmentPercentage: member.employmentPercentage,
            vacationBalance: member.vacationBalance,
            effectiveApproverUserId: member.effectiveApproverUserId
          })),
          ...snapshot.removedMemberIds.map((userId) => ({
            userId,
            primaryTeamId: "",
            additionalPositions: [] as readonly string[],
            approvalExempt: false,
            employmentPercentage: 100,
            vacationBalance: 0,
            effectiveApproverUserId: undefined as string | undefined
          }))
        ];
        const patchedAbsenceEntryTypes = snapshot.absenceEntryTypes.map((entryType) => ({
          key: entryType.key,
          label: entryType.label,
          labelKey: entryType.labelKey,
          active: entryType.active,
          requiresApproval: entryType.requiresApproval,
          consumesVacationBalance: entryType.consumesVacationBalance
        }));
        const updatedDetails = snapshot.isAllTeamsView
          ? await patchAllTeamMembers({
              memberAssignments,
              absenceEntryTypes: patchedAbsenceEntryTypes
            })
          : await patchTeamSettings(activeDetails.team.teamId, {
              teamLeadUserId: snapshot.teamLeadUserId,
              defaultApproverUserId: snapshot.defaultApproverUserId,
              backupApproverUserId: snapshot.backupApproverUserId || undefined,
              approvalPolicy: {
                allowUserOverride: snapshot.allowUserOverride,
                outlookSync: snapshot.outlookSync
              },
              memberAssignments,
              absenceEntryTypes: patchedAbsenceEntryTypes
            });

        // If the user changed more fields while this PATCH was in flight, skip applying a
        // stale server snapshot and loop to flush the latest local state.
        if (saveQueuedRef.current) {
          continue;
        }

        applyDetails(updatedDetails);
        lastSavedSignature.current = createSettingsSignature(
          updatedDetails.settings.teamLeadUserId,
          updatedDetails.settings.defaultApproverUserId,
          updatedDetails.settings.backupApproverUserId ?? "",
          updatedDetails.settings.approvalPolicy.allowUserOverride,
          updatedDetails.settings.approvalPolicy.outlookSync,
          updatedDetails.members,
          updatedDetails.absenceEntryTypes,
          []
        );
        invalidatePlanningBootstrapCache();
        setTeams(await getManagedTeams());
        if (showSavedToast) {
          setToast(t("teamAdminSavedToast"));
        }
      } while (saveQueuedRef.current);
    } catch (saveError: unknown) {
      const activeTeamId = saveSnapshotRef.current.details?.team.teamId;
      logger.error("Team admin settings could not be saved.", {
        source: "team-admin",
        component: "TeamAdminPage",
        operation: "save",
        details: { teamId: activeTeamId }
      }, saveError);
      setError(t("teamAdminSaveError"));
    } finally {
      saveInFlightRef.current = false;
      setIsSaving(false);
      if (saveQueuedRef.current) {
        saveQueuedRef.current = false;
        void save(false);
      }
    }
  }, [logger, t]);

  useEffect(() => {
    if (!details || !details.canEdit || isLoading) {
      return;
    }

    const signature = createSettingsSignature(
      teamLeadUserId,
      defaultApproverUserId,
      backupApproverUserId,
      allowUserOverride,
      outlookSync,
      memberDrafts,
      absenceEntryTypes,
      removedMemberIds
    );

    if (signature === lastSavedSignature.current) {
      return;
    }

    const saveTimeout = window.setTimeout(() => {
      void save(false);
    }, 700);

    return () => window.clearTimeout(saveTimeout);
  }, [
    absenceEntryTypes,
    allowUserOverride,
    backupApproverUserId,
    defaultApproverUserId,
    details,
    isLoading,
    isAllTeamsView,
    memberDrafts,
    removedMemberIds,
    outlookSync,
    save,
    teamLeadUserId
  ]);

  useEffect(() => {
    const storageKey = `teamAdmin.holidaySlots.${selectedTeamId || "default"}`;

    try {
      const persisted = window.localStorage.getItem(storageKey);

      if (!persisted) {
        setHolidaySlots(createDefaultHolidaySlots());
        return;
      }

      const parsed = JSON.parse(persisted) as HolidayCalendarSlot[];
      setHolidaySlots(sanitizeHolidaySlots(parsed));
    } catch {
      setHolidaySlots(createDefaultHolidaySlots());
    }
  }, [selectedTeamId]);

  useEffect(() => {
    const storageKey = `teamAdmin.holidaySlots.${selectedTeamId || "default"}`;

    try {
      window.localStorage.setItem(storageKey, JSON.stringify(sanitizeHolidaySlots(holidaySlots)));
    } catch {
      // Ignore storage errors; slot configuration falls back to defaults.
    }
  }, [holidaySlots, selectedTeamId]);

  // EO-454: Auto-refresh all enabled holiday slots when calendar year changes
  useEffect(() => {
    const autoRefreshTimeout = window.setTimeout(async () => {
      if (!details || !details.canEdit || isLoading) {
        return;
      }

      const enabledSlots = holidaySlots.filter((slot) => slot.enabled);

      if (enabledSlots.length === 0) {
        return;
      }

      setRefreshingHolidaySlotIds((currentIds) => new Set([...currentIds, ...enabledSlots.map((s) => s.id)]));
      setToast(undefined);
      setError(undefined);

      try {
        const feedbackList = await refreshHolidayCalendarSlotsWithFeedback(calendarYear, enabledSlots);

        invalidatePlanningBootstrapCache();

        // Aggregate feedback into user-friendly summary message
        const successCount = feedbackList.filter((f) => f.status === "success").length;
        const warningCount = feedbackList.filter((f) => f.status === "warning").length;
        const noChangeCount = feedbackList.filter((f) => f.status === "no-change").length;
        const errorCount = feedbackList.filter((f) => f.status === "error").length;

        if (successCount > 0 || warningCount > 0) {
          let summary = "";
          if (successCount > 0) summary += `✓ ${successCount} Kalender aktualisiert`;
          if (warningCount > 0) summary += (summary ? ", " : "") + `⚠ ${warningCount} mit Warnung`;
          if (noChangeCount > 0) summary += (summary ? ", " : "") + `ℹ ${noChangeCount} unverändert`;

          setToast(`Jahreswechsel ${calendarYear}: ${summary}`);

          logger.info(`Holiday calendars auto-refreshed on year change`, {
            source: "team-admin",
            component: "TeamAdminPage",
            operation: "autoRefreshOnYearChange",
            details: { year: calendarYear, successCount, warningCount, noChangeCount, errorCount }
          });
        } else if (errorCount > 0) {
          setError(`${errorCount} Kalender konnten nicht aktualisiert werden`);
        }
      } catch (error) {
        logger.error("Auto-refresh of holiday calendars failed on year change.", {
          source: "team-admin",
          component: "TeamAdminPage",
          operation: "autoRefreshOnYearChange",
          details: { calendarYear, slotCount: enabledSlots.length }
        }, error);
      } finally {
        setRefreshingHolidaySlotIds(() => new Set());
      }
    }, 500); // Debounce to avoid rapid successive refreshes

    return () => window.clearTimeout(autoRefreshTimeout);
  }, [calendarYear, details, isLoading, holidaySlots]);

  const updateHolidaySlot = (slotId: string, update: (slot: HolidayCalendarSlot) => HolidayCalendarSlot) => {
    setHolidaySlots((currentSlots) =>
      currentSlots.map((slot) => (slot.id === slotId ? update(slot) : slot))
    );
  };

  const refreshHolidaySlot = async (slotId: string) => {
    const slot = holidaySlots.find((candidate) => candidate.id === slotId);

    if (!slot) {
      return;
    }

    setRefreshingHolidaySlotIds((currentIds) => new Set(currentIds).add(slotId));
    setToast(undefined);
    setError(undefined);

    try {
      const feedbackList = await refreshHolidayCalendarSlotsWithFeedback(calendarYear, [slot], [slot.kind]);
      const slotFeedback = feedbackList[0];

      if (!slotFeedback) {
        setError(t("teamAdminCalendarRefreshError"));
        return;
      }

      invalidatePlanningBootstrapCache();

      // Build user-friendly toast message based on feedback status
      let toastMessage: string;
      if (slotFeedback.status === "success") {
        toastMessage = `✓ ${slotFeedback.displayLabel}: ${slotFeedback.entryCount} Einträge aktualisiert`;
      } else if (slotFeedback.status === "warning") {
        toastMessage = `⚠ ${slotFeedback.displayLabel}: ${slotFeedback.entryCount} Einträge (Warnung: Jahr-Mismatch)`;
      } else if (slotFeedback.status === "no-change") {
        toastMessage = `ℹ ${slotFeedback.displayLabel}: Keine neuen Einträge`;
      } else {
        toastMessage = `✗ ${slotFeedback.displayLabel}: ${slotFeedback.message}`;
      }

      setToast(toastMessage);
      logger.info(`Holiday calendar refresh completed: ${slotFeedback.message}`, {
        source: "team-admin",
        component: "TeamAdminPage",
        operation: "refreshHolidaySlot",
        details: { slotId, status: slotFeedback.status, entryCount: slotFeedback.entryCount, year: calendarYear }
      });
    } catch (calendarError: unknown) {
      logger.error("Holiday calendar could not be refreshed.", {
        source: "team-admin",
        component: "TeamAdminPage",
        operation: "refreshHolidaySlot",
        details: { calendarYear, slotId, kind: slot.kind }
      }, calendarError);
      setError(t("teamAdminCalendarRefreshError"));
    } finally {
      setRefreshingHolidaySlotIds((currentIds) => {
        const next = new Set(currentIds);
        next.delete(slotId);
        return next;
      });
    }
  };

  // EO-418 (d): deep links reach this page even without the role — show a clear
  // denial naming the required role instead of an empty admin surface.
  if (accessInfo && !accessInfo.isTeamOwner) {
    return (
      <section className={styles.page} aria-label={t("teamAdminAccessDeniedTitle")}>
        <div className={styles.error} role="alert">
          <strong>{t("teamAdminAccessDeniedTitle")}</strong>
          <p>{t("teamAdminAccessDeniedDescription")}</p>
        </div>
      </section>
    );
  }

  // EO-420: while the access check is still in flight, keep showing the spinner —
  // a verified owner of a team without structures must reach the creation card
  // below instead of a misleading access-denied state.
  if ((isLoading || !accessInfo) && !details) {
    return <Spinner label={t("teamAdminLoading")} />;
  }

  if (error && !details) {
    return <div className={styles.error} role="alert">{error}</div>;
  }

  // No managed teams yet - show the management card directly so user can create the first team
  if (!details || teams.length === 0) {
    return (
      <section className={styles.page} aria-label={t("teamAdminTitle")}>
        {toast ? (
          <div className={styles.toast} role="status" aria-live="polite">
            {toast}
          </div>
        ) : null}
        {error ? <div className={styles.error} role="alert">{error}</div> : null}
        
        <TeamManagementCard
          teams={teams}
          onTeamCreate={handleTeamCreate}
          onTeamRename={handleTeamRename}
          onTeamOrganizationChange={handleTeamOrganizationChange}
          onTeamColorChange={handleTeamColorChange}
          onTeamRequiredStaffingChange={handleTeamRequiredStaffingChange}
          onTeamReorder={handleTeamReorder}
          onTeamDelete={handleTeamDelete}
          t={t}
        />
      </section>
    );
  }

  // FR-413.6: the save button is only actionable while there are unsaved changes
  // (auto-save runs debounced anyway; the button forces an immediate save).
  const hasUnsavedChanges = createSettingsSignature(
    teamLeadUserId,
    defaultApproverUserId,
    backupApproverUserId,
    allowUserOverride,
    outlookSync,
    memberDrafts,
    absenceEntryTypes,
    removedMemberIds
  ) !== lastSavedSignature.current;

  return (
    <section className={styles.page} aria-label={t("teamAdminTitle")}>
      {toast ? (
        <div className={styles.toast} role="status" aria-live="polite">
          {toast}
        </div>
      ) : null}
      {error ? <div className={styles.error} role="alert">{error}</div> : null}
      <div className={styles.autoSaveStatus} role="status" aria-live="polite">
        {isSaving ? t("teamAdminAutoSaveSaving") : t("teamAdminAutoSaveEnabled")}
      </div>

      <div className={styles.grid}>
        <TeamSelector
          teams={teams}
          selectedTeamId={selectedTeamId}
          onSelectedTeamChange={setSelectedTeamId}
          t={t}
        />
        {isAllTeamsView ? (
          <section className={styles.card} aria-label={t("teamAdminAllTeams")}>
            <div className={styles.cardHeader}>
              <h3 className={styles.cardTitle}>{t("teamAdminAllTeams")}</h3>
              <p className={styles.cardDescription}>{t("teamAdminAllTeamsDescription")}</p>
            </div>
          </section>
        ) : (
          <>
            <TeamSettingsCard
              backupApproverOptions={backupApproverOptions}
              defaultApproverOptions={defaultApproverOptions}
              details={details}
              teamLeadUserId={teamLeadUserId}
              defaultApproverUserId={defaultApproverUserId}
              backupApproverUserId={backupApproverUserId}
              onTeamLeadChange={setTeamLeadUserId}
              onDefaultApproverChange={setDefaultApproverUserId}
              onBackupApproverChange={setBackupApproverUserId}
              t={t}
            />
            <ApprovalPolicyCard
              allowUserOverride={allowUserOverride}
              outlookSync={outlookSync}
              onAllowUserOverrideChange={setAllowUserOverride}
              onOutlookSyncChange={setOutlookSync}
              t={t}
            />
          </>
        )}
        <TeamMembersTable
          approverOptions={backupApproverOptions}
          members={memberDrafts}
          assignableMembers={details.assignableMembers}
          teamOptions={details.teamOptions}
          canEdit={details.canEdit}
          onMemberAdd={addMemberToSelectedTeam}
          onMemberRemove={removeMemberFromPlanning}
          onMemberPrimaryTeamChange={changeMemberPrimaryTeam}
          onMemberPositionsChange={changeMemberPositions}
          onMemberApprovalExemptChange={changeMemberApprovalExempt}
          onMemberEmploymentPercentageChange={changeMemberEmploymentPercentage}
          onMemberVacationBalanceChange={changeMemberVacationBalance}
          onMemberEffectiveApproverChange={changeMemberEffectiveApprover}
          t={t}
        />
        <AbsenceEntryTypesCard
          entryTypes={absenceEntryTypes}
          onEntryTypeAdd={addAbsenceEntryType}
          onEntryTypeChange={changeAbsenceEntryType}
          onEntryTypeDelete={deleteAbsenceEntryType}
          t={t}
        />
        <DisplaySettingsCard canEdit={details.canEdit} onError={setError} t={t} />
        <TeamManagementCard
          teams={teams}
          onTeamCreate={handleTeamCreate}
          onTeamRename={handleTeamRename}
          onTeamOrganizationChange={handleTeamOrganizationChange}
          onTeamColorChange={handleTeamColorChange}
          onTeamRequiredStaffingChange={handleTeamRequiredStaffingChange}
          onTeamReorder={handleTeamReorder}
          onTeamDelete={handleTeamDelete}
          t={t}
        />
        <section className={`${styles.card} ${styles.wide}`} aria-labelledby="holiday-calendar-settings-title">
          <div className={styles.cardHeader}>
            <h3 className={styles.cardTitle} id="holiday-calendar-settings-title">{t("teamAdminHolidayCalendarsTitle")}</h3>
            <p className={styles.cardDescription}>{t("teamAdminHolidayCalendarsDescription")}</p>
          </div>
          <div className={styles.schoolHolidaySyncRow}>
            <label className={styles.field}>
              <span>{t("teamAdminSchoolHolidaySyncYear")}</span>
              <input
                min="2022"
                max="2035"
                type="number"
                value={calendarYear}
                onChange={(event) => setCalendarYear(Number(event.currentTarget.value))}
              />
            </label>
          </div>

          <div className={styles.tableScroller}>
            <table className={styles.table}>
              <thead>
                <tr>
                  <th>{t("teamAdminTeamManagementName")}</th>
                  <th>{t("teamAdminCalendarSourceType")}</th>
                  <th>{t("teamAdminCalendarSourceUrl")}</th>
                  <th>Microsoft preset</th>
                  <th>{t("teamAdminTeamColor")}</th>
                  <th>Aktiv</th>
                  <th>{t("teamAdminCalendarRefreshButton")}</th>
                </tr>
              </thead>
              <tbody>
                {holidaySlots.map((slot) => (
                  <tr key={slot.id}>
                    <td>
                      <Input
                        value={slot.displayLabel}
                        disabled={!details.canEdit}
                        onChange={(_, data) => updateHolidaySlot(slot.id, (current) => ({ ...current, displayLabel: data.value }))}
                      />
                    </td>
                    <td>
                      <select
                        className={styles.tableControl}
                        value={slot.sourceType}
                        disabled={!details.canEdit}
                        onChange={(event) => {
                          const sourceType = event.currentTarget.value as HolidaySourceType;
                          updateHolidaySlot(slot.id, (current) => ({ ...current, sourceType }));
                        }}
                      >
                        <option value="microsoft">Microsoft</option>
                        <option value="json">JSON</option>
                        <option value="ics">ICS</option>
                      </select>
                    </td>
                    <td>
                      <Input
                        value={slot.sourceUrl ?? ""}
                        placeholder={t("teamAdminCalendarSourceUrlPlaceholder")}
                        disabled={!details.canEdit || slot.sourceType === "microsoft"}
                        onChange={(_, data) => updateHolidaySlot(slot.id, (current) => ({ ...current, sourceUrl: data.value }))}
                      />
                    </td>
                    <td>
                      <select
                        className={styles.tableControl}
                        value={slot.microsoftPreset ?? ""}
                        disabled={!details.canEdit || slot.sourceType !== "microsoft"}
                        onChange={(event) => {
                          const microsoftPreset = event.currentTarget.value as MicrosoftHolidayPreset;
                          updateHolidaySlot(slot.id, (current) => ({ ...current, microsoftPreset }));
                        }}
                      >
                        {slot.kind === "public" ? (
                          <option value="zurich-public">Zürich (Feiertage)</option>
                        ) : (
                          <>
                            <option value="st-gallen-school">St. Gallen (Schulferien)</option>
                            <option value="zurich-school">Zürich/Dübendorf (Schulferien)</option>
                          </>
                        )}
                      </select>
                    </td>
                    <td>
                    <Popover positioning="below-start" trapFocus>
                      <PopoverTrigger disableButtonEnhancement>
                        <button
                          aria-label={`${t("teamAdminTeamColor")} ${slot.displayLabel}`}
                          className={styles.teamColorCompactButton}
                          disabled={!details.canEdit}
                          type="button"
                        >
                          <span
                            aria-hidden="true"
                            className={styles.teamColorCompactSwatch}
                            style={calendarToneStyles[slot.tone]}
                          />
                        </button>
                      </PopoverTrigger>
                      <PopoverSurface className={styles.teamColorPopover}>
                        <div className={styles.teamColorPopoverHeader}>
                          <span>{t("teamAdminTeamColor")}</span>
                          <span
                            aria-label={`${t("teamAdminTeamColor")} ${slot.displayLabel}`}
                            className={styles.teamColorPopoverPreview}
                            style={calendarToneStyles[slot.tone]}
                          />
                        </div>
                        <SwatchPicker
                          aria-label={`${t("teamAdminTeamColor")} ${slot.displayLabel}`}
                          layout="grid"
                          selectedValue={slot.tone}
                          shape="rounded"
                          size="small"
                          spacing="small"
                          onSelectionChange={(_event, data) => {
                            const tone = data.selectedValue as HolidayCalendarTone;
                            updateHolidaySlot(slot.id, (current) => ({ ...current, tone }));
                          }}
                        >
                          {holidayCalendarToneKeys.map((tone) => (
                            <Tooltip key={tone} content={slot.displayLabel} relationship="label">
                              <ColorSwatch value={tone} color={calendarToneStyles[tone].background} />
                            </Tooltip>
                          ))}
                        </SwatchPicker>
                        <Button
                          appearance="subtle"
                          onClick={() => updateHolidaySlot(slot.id, (current) => ({ ...current, tone: defaultToneForSlot(current.id, current.kind) }))}
                        >
                          {t("teamAdminTeamColorAuto")}
                        </Button>
                      </PopoverSurface>
                    </Popover>
                    </td>
                    <td>
                    <label className={styles.checkboxRow}>
                      <input
                        checked={slot.enabled}
                        disabled={!details.canEdit}
                        onChange={(event) => {
                            const enabled = event.currentTarget.checked;
                            updateHolidaySlot(slot.id, (current) => ({ ...current, enabled }));
                          }}
                          type="checkbox"
                        />
                      </label>
                    </td>
                    <td className={styles.entryTypeActions}>
                      <Button
                        appearance="secondary"
                        disabled={!details.canEdit || refreshingHolidaySlotIds.has(slot.id)}
                        aria-busy={refreshingHolidaySlotIds.has(slot.id)}
                        onClick={() => void refreshHolidaySlot(slot.id)}
                      >
                        {t("teamAdminCalendarRefreshButton")}
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      <OrganisationLocationCard canEdit={details.canEdit} t={t} />

      <div className={styles.actions}>
        <Button appearance="secondary" disabled={isSaving || !details.canEdit || !hasUnsavedChanges} onClick={() => void save()}>
          {t("teamAdminSaveChanges")}
        </Button>
      </div>
    </section>
  );
}

function normalizePercentage(value: number): number {
  return Number.isFinite(value) ? Math.min(150, Math.max(0, Math.round(value))) : 100;
}

function normalizeVacationBalance(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.round(value * 2) / 2) : 0;
}

function createSettingsSignature(
  teamLeadUserId: string,
  defaultApproverUserId: string,
  backupApproverUserId: string,
  allowUserOverride: boolean,
  outlookSync: TeamAdminOutlookSyncPolicy,
  memberDrafts: readonly TeamAdminMember[],
  absenceEntryTypes: readonly TeamAdminAbsenceEntryType[],
  removedMemberIds: readonly string[] = []
): string {
  return JSON.stringify({
    teamLeadUserId,
    defaultApproverUserId,
    backupApproverUserId,
    allowUserOverride,
    outlookSync,
    memberDrafts: memberDrafts.map((member) => ({
      userId: member.userId,
      primaryTeamId: member.primaryTeamId,
      additionalPositions: member.additionalPositions,
      approvalExempt: member.approvalExempt,
      employmentPercentage: member.employmentPercentage,
      vacationBalance: member.vacationBalance,
      effectiveApproverUserId: member.effectiveApproverUserId
    })),
    removedMemberIds: [...removedMemberIds].sort(),
    absenceEntryTypes: absenceEntryTypes.map((entryType) => ({
      key: entryType.key,
      label: entryType.label,
      labelKey: entryType.labelKey,
      active: entryType.active,
      requiresApproval: entryType.requiresApproval,
      consumesVacationBalance: entryType.consumesVacationBalance
    }))
  });
}
