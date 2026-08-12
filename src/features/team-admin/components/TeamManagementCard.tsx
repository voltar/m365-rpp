import { type DragEvent, useEffect, useMemo, useState } from "react";
import { Button, ColorSwatch, Input, Popover, PopoverSurface, PopoverTrigger, SwatchPicker, Tooltip } from "@fluentui/react-components";
import { AddRegular, ArrowSortDownRegular, ArrowSortRegular, ArrowSortUpRegular, DeleteRegular, ReOrderDotsVerticalRegular } from "@fluentui/react-icons";
import type { TranslationKey } from "../../../localization/translations";
import type { TeamAdminSummary } from "../types/teamSettings";
import { getOrgConfig } from "../services/teamAdminApi";
import {
  getAssignedTeamColorStyle,
  getTeamColorStyle,
  isHexColor,
  isTeamColorKey,
  teamColorKeys,
  teamColorLabelKeyByKey
} from "../../../styles/teamColorPalette";
import styles from "../TeamAdminPage.module.css";

const recentTeamColorsStorageKey = "teamAdmin.recentTeamColors";
const maxRecentTeamColors = 6;

function loadRecentTeamColors(): readonly string[] {
  if (typeof window === "undefined") {
    return [];
  }

  try {
    const raw = window.localStorage.getItem(recentTeamColorsStorageKey);

    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw);

    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .map((value) => (typeof value === "string" ? value.trim().toLowerCase() : ""))
      .filter((value): value is string => isHexColor(value))
      .filter((value, index, allValues) => allValues.indexOf(value) === index)
      .slice(0, maxRecentTeamColors);
  } catch {
    return [];
  }
}

function persistRecentTeamColors(colors: readonly string[]) {
  if (typeof window === "undefined") {
    return;
  }

  window.localStorage.setItem(recentTeamColorsStorageKey, JSON.stringify(colors));
}

type TeamSortKey = "order" | "name" | "organization" | "memberCount" | "requiredStaffing";
type SortDirection = "asc" | "desc";

interface TeamManagementCardProps {
  readonly teams: readonly TeamAdminSummary[];
  readonly onTeamCreate: (teamName: string, organization: string) => void;
  readonly onTeamRename: (teamId: string, teamName: string) => void;
  readonly onTeamOrganizationChange: (teamId: string, organization: string) => void;
  readonly onTeamColorChange: (teamId: string, color: string) => void;
  readonly onTeamRequiredStaffingChange: (teamId: string, requiredStaffing: number) => void;
  readonly onTeamReorder: (teamId: string, targetTeamId: string) => void;
  readonly onTeamDelete: (teamId: string) => void;
  readonly t: (key: TranslationKey) => string;
}

export function TeamManagementCard({
  teams,
  onTeamCreate,
  onTeamRename,
  onTeamOrganizationChange,
  onTeamColorChange,
  onTeamRequiredStaffingChange,
  onTeamReorder,
  onTeamDelete,
  t
}: TeamManagementCardProps) {
  const [newTeamName, setNewTeamName] = useState("");
  const [newTeamOrganization, setNewTeamOrganization] = useState<string>("");
  // EO-415: organisation options come from the configured list; organisation values
  // already assigned to teams stay selectable even if they were removed from the list.
  const [configuredOrganisations, setConfiguredOrganisations] = useState<readonly string[]>([]);

  useEffect(() => {
    getOrgConfig()
      .then((config) => setConfiguredOrganisations(config.organisations.map((organisation) => organisation.name)))
      .catch(() => setConfiguredOrganisations([]));
  }, []);

  const organizationOptions = useMemo(() => {
    const values = new Set<string>(configuredOrganisations);

    teams.forEach((team) => {
      if (team.organization) {
        values.add(team.organization);
      }
    });

    return Array.from(values).sort((first, second) => first.localeCompare(second));
  }, [configuredOrganisations, teams]);

  useEffect(() => {
    if (!newTeamOrganization && organizationOptions.length > 0) {
      setNewTeamOrganization(organizationOptions[0]);
    }
  }, [newTeamOrganization, organizationOptions]);
  const [nameDrafts, setNameDrafts] = useState<Readonly<Record<string, string>>>({});
  const [staffingDrafts, setStaffingDrafts] = useState<Readonly<Record<string, string>>>({});
  const [colorHexDrafts, setColorHexDrafts] = useState<Readonly<Record<string, string>>>({});
  const [recentTeamColors, setRecentTeamColors] = useState<readonly string[]>(() => loadRecentTeamColors());
  const [sortKey, setSortKey] = useState<TeamSortKey>("order");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const [draggedTeamId, setDraggedTeamId] = useState<string>();
  const sortedTeams = useMemo(
    () => sortTeams(teams, sortKey, sortDirection),
    [sortDirection, sortKey, teams]
  );

  const addTeam = () => {
    const teamName = newTeamName.trim();

    if (!teamName) {
      return;
    }

    onTeamCreate(teamName, newTeamOrganization);
    setNewTeamName("");
  };

  const commitRename = (team: TeamAdminSummary) => {
    const draft = nameDrafts[team.teamId];

    setNameDrafts((currentDrafts) => {
      const remainingDrafts = { ...currentDrafts };
      delete remainingDrafts[team.teamId];
      return remainingDrafts;
    });

    if (draft !== undefined && draft.trim() && draft.trim() !== team.teamName) {
      onTeamRename(team.teamId, draft.trim());
    }
  };

  const commitRequiredStaffing = (team: TeamAdminSummary) => {
    const draft = staffingDrafts[team.teamId];

    setStaffingDrafts((currentDrafts) => {
      const remainingDrafts = { ...currentDrafts };
      delete remainingDrafts[team.teamId];
      return remainingDrafts;
    });

    if (draft === undefined) {
      return;
    }

    const requiredStaffing = Number.parseInt(draft, 10);
    const normalizedValue = Number.isNaN(requiredStaffing) ? 0 : Math.max(0, requiredStaffing);

    if (normalizedValue !== team.requiredStaffing) {
      onTeamRequiredStaffingChange(team.teamId, normalizedValue);
    }
  };

  const changeSort = (nextSortKey: TeamSortKey) => {
    if (nextSortKey === sortKey) {
      setSortDirection((currentDirection) => currentDirection === "asc" ? "desc" : "asc");
      return;
    }

    setSortKey(nextSortKey);
    setSortDirection("asc");
  };

  const dropTeam = (event: DragEvent, targetTeamId: string) => {
    event.preventDefault();

    if (!draggedTeamId || draggedTeamId === targetTeamId) {
      return;
    }

    setSortKey("order");
    setSortDirection("asc");
    onTeamReorder(draggedTeamId, targetTeamId);
    setDraggedTeamId(undefined);
  };

  const renderSortableHeader = (label: string, nextSortKey: TeamSortKey) => (
    <button className={styles.sortHeader} onClick={() => changeSort(nextSortKey)} type="button">
      <span>{label}</span>
      {getSortIcon(sortKey === nextSortKey ? sortDirection : undefined)}
    </button>
  );

  const rememberRecentTeamColor = (color: string) => {
    if (!isHexColor(color)) {
      return;
    }

    const normalizedColor = color.toLowerCase();

    setRecentTeamColors((currentColors) => {
      const nextColors = [normalizedColor, ...currentColors.filter((currentColor) => currentColor !== normalizedColor)]
        .slice(0, maxRecentTeamColors);
      persistRecentTeamColors(nextColors);
      return nextColors;
    });
  };

  const applyCustomTeamColor = (team: TeamAdminSummary, color: string) => {
    if (!isHexColor(color)) {
      return;
    }

    const normalizedColor = color.toLowerCase();
    onTeamColorChange(team.teamId, normalizedColor);
    setColorHexDrafts((currentDrafts) => ({ ...currentDrafts, [team.teamId]: normalizedColor }));
    rememberRecentTeamColor(normalizedColor);
  };

  const commitHexDraft = (team: TeamAdminSummary, rawDraft: string) => {
    const normalizedDraft = rawDraft.trim().toLowerCase();

    if (normalizedDraft.length === 0) {
      return;
    }

    if (isHexColor(normalizedDraft)) {
      applyCustomTeamColor(team, normalizedDraft);
    }
  };

  return (
    <section className={`${styles.card} ${styles.wide}`} aria-label={t("teamAdminTeamManagement")}>
      <div className={styles.cardHeader}>
        <h3 className={styles.cardTitle}>{t("teamAdminTeamManagement")}</h3>
        <p className={styles.cardDescription}>{t("teamAdminTeamManagementDescription")}</p>
      </div>
      <div className={styles.teamAddRow}>
        <label className={styles.field}>
          <span>{t("teamAdminTeamNew")}</span>
          <input
            onChange={(event) => setNewTeamName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                addTeam();
              }
            }}
            placeholder={t("teamAdminTeamNewPlaceholder")}
            value={newTeamName}
          />
        </label>
        <label className={styles.field}>
          <span>{t("teamAdminTeamManagementOrganization")}</span>
          <select onChange={(event) => setNewTeamOrganization(event.target.value)} value={newTeamOrganization}>
            {organizationOptions.map((organization) => (
              <option key={organization} value={organization}>
                {organization}
              </option>
            ))}
          </select>
        </label>
        <Button appearance="secondary" icon={<AddRegular />} onClick={addTeam}>
          {t("teamAdminTeamAdd")}
        </Button>
      </div>
      <div className={styles.teamManagementGrid}>
        <span className={styles.entryTypeHeader}>{renderSortableHeader(t("teamAdminTeamManagementOrder"), "order")}</span>
        <span className={styles.entryTypeHeader}>{renderSortableHeader(t("teamAdminTeamManagementName"), "name")}</span>
        <span className={styles.entryTypeHeader}>{renderSortableHeader(t("teamAdminTeamManagementOrganization"), "organization")}</span>
        <span className={styles.entryTypeHeader}>{t("teamAdminTeamColor")}</span>
        <span className={styles.entryTypeHeader}>{renderSortableHeader(t("teamAdminMemberCount"), "memberCount")}</span>
        <span className={styles.entryTypeHeader}>{renderSortableHeader(t("teamAdminTeamRequiredStaffing"), "requiredStaffing")}</span>
        <span className={styles.entryTypeHeader}>{t("teamAdminEntryTypeActions")}</span>
        {sortedTeams.map((team, teamIndex) => {
          const deleteBlocked = team.memberCount > 0 || teams.length <= 1;
          const deleteHint = team.memberCount > 0
            ? t("teamAdminTeamHasMembers")
            : teams.length <= 1
              ? t("teamAdminTeamLastTeam")
              : t("teamAdminTeamDelete");
          const colorHexDraft = colorHexDrafts[team.teamId] ?? (isHexColor(team.color) ? team.color : "");
          const normalizedDraft = colorHexDraft.trim().toLowerCase();
          const hasHexDraft = normalizedDraft.length > 0;
          const isHexDraftValid = isHexColor(normalizedDraft);
          const previewColor = hasHexDraft && isHexDraftValid ? normalizedDraft : team.color;
          const previewStyle = getAssignedTeamColorStyle(team.teamName, previewColor);

          return (
            <div className={styles.entryTypeRow} key={team.teamId}>
              <div
                className={`${styles.teamOrderCell} ${draggedTeamId && draggedTeamId !== team.teamId ? styles.teamDropTarget : ""}`}
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => dropTeam(event, team.teamId)}
              >
                <button
                  aria-label={t("teamAdminTeamManagementOrder")}
                  className={styles.dragHandle}
                  draggable
                  onDragEnd={() => setDraggedTeamId(undefined)}
                  onDragStart={(event) => {
                    event.dataTransfer.effectAllowed = "move";
                    event.dataTransfer.setData("text/plain", team.teamId);
                    setSortKey("order");
                    setSortDirection("asc");
                    setDraggedTeamId(team.teamId);
                  }}
                  type="button"
                >
                  <ReOrderDotsVerticalRegular />
                </button>
                <span>{teamIndex + 1}</span>
              </div>
              <label className={styles.entryTypeName}>
                <input
                  onBlur={() => commitRename(team)}
                  onChange={(event) =>
                    setNameDrafts((currentDrafts) => ({ ...currentDrafts, [team.teamId]: event.target.value }))
                  }
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      event.currentTarget.blur();
                    }
                  }}
                  value={nameDrafts[team.teamId] ?? team.teamName}
                />
              </label>
              <label className={styles.entryTypeName}>
                <select
                  aria-label={`${t("teamAdminTeamManagementOrganization")} ${team.teamName}`}
                  onChange={(event) => onTeamOrganizationChange(team.teamId, event.target.value)}
                  value={team.organization}
                >
                  {organizationOptions.map((organization) => (
                    <option key={organization} value={organization}>
                      {organization}
                    </option>
                  ))}
                </select>
              </label>
              <div className={styles.teamColorCell}>
                <Popover positioning="below-start" trapFocus>
                  <PopoverTrigger disableButtonEnhancement>
                    <button
                      aria-label={`${t("teamAdminTeamColor")} ${team.teamName}`}
                      className={styles.teamColorCompactButton}
                      type="button"
                    >
                      <span
                        aria-hidden="true"
                        className={styles.teamColorCompactSwatch}
                        style={{
                          background: previewStyle.background,
                          borderColor: previewStyle.border
                        }}
                      />
                    </button>
                  </PopoverTrigger>
                  <PopoverSurface className={styles.teamColorPopover}>
                    <div className={styles.teamColorPopoverHeader}>
                      <span>{t("teamAdminTeamColor")}</span>
                      <span
                        aria-label={`${t("teamAdminTeamColor")} ${team.teamName}`}
                        className={styles.teamColorPopoverPreview}
                        style={{
                          background: previewStyle.background,
                          borderColor: previewStyle.border
                        }}
                      />
                    </div>
                    <SwatchPicker
                      aria-label={`${t("teamAdminTeamColor")} ${team.teamName}`}
                      layout="grid"
                      size="small"
                      shape="rounded"
                      spacing="small"
                      selectedValue={isTeamColorKey(team.color) ? team.color : undefined}
                      onSelectionChange={(_event, data) => {
                        onTeamColorChange(team.teamId, data.selectedValue);
                        setColorHexDrafts((currentDrafts) => ({ ...currentDrafts, [team.teamId]: "" }));
                      }}
                    >
                      {teamColorKeys.map((colorKey) => {
                        const colorStyle = getTeamColorStyle(colorKey);

                        return (
                          <Tooltip key={colorKey} content={t(teamColorLabelKeyByKey[colorKey])} relationship="label">
                            <ColorSwatch value={colorKey} color={colorStyle.background} />
                          </Tooltip>
                        );
                      })}
                    </SwatchPicker>
                    {recentTeamColors.length > 0 ? (
                      <div className={styles.teamColorRecentRow}>
                        {recentTeamColors.map((recentColor) => (
                          <Tooltip key={recentColor} content={recentColor.toUpperCase()} relationship="label">
                            <button
                              aria-label={`${t("teamAdminTeamColor")} ${recentColor}`}
                              className={styles.teamColorRecentButton}
                              onClick={() => applyCustomTeamColor(team, recentColor)}
                              type="button"
                            >
                              <span
                                aria-hidden="true"
                                className={styles.teamColorRecentSwatch}
                                style={{ background: recentColor }}
                              />
                            </button>
                          </Tooltip>
                        ))}
                      </div>
                    ) : null}
                    <div className={styles.teamColorFreeRow}>
                      <Input
                        aria-label={`${t("teamAdminTeamColor")} Hex`}
                        className={styles.teamColorHexInput}
                        value={colorHexDraft}
                        onChange={(_event, data) =>
                          setColorHexDrafts((currentDrafts) => ({ ...currentDrafts, [team.teamId]: data.value }))
                        }
                        onBlur={(event) => {
                          commitHexDraft(team, event.currentTarget.value);
                        }}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.preventDefault();
                            commitHexDraft(team, event.currentTarget.value);
                          }
                        }}
                        placeholder="#1a73e8"
                      />
                      <input
                        aria-label={`${t("teamAdminTeamColor")} Picker`}
                        className={styles.teamColorNativePicker}
                        type="color"
                        value={isHexDraftValid ? normalizedDraft : isHexColor(team.color) ? team.color : "#1a73e8"}
                        onChange={(event) => applyCustomTeamColor(team, event.target.value)}
                      />
                    </div>
                    <Button
                      appearance="subtle"
                      onClick={() => {
                        onTeamColorChange(team.teamId, "");
                        setColorHexDrafts((currentDrafts) => ({ ...currentDrafts, [team.teamId]: "" }));
                      }}
                    >
                      {t("teamAdminTeamColorAuto")}
                    </Button>
                  </PopoverSurface>
                </Popover>
              </div>
              <span className={styles.teamCell}>{team.memberCount}</span>
              <label className={styles.entryTypeName}>
                <input
                  aria-label={t("teamAdminTeamRequiredStaffing")}
                  min={0}
                  onBlur={() => commitRequiredStaffing(team)}
                  onChange={(event) =>
                    setStaffingDrafts((currentDrafts) => ({ ...currentDrafts, [team.teamId]: event.target.value }))
                  }
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      event.currentTarget.blur();
                    }
                  }}
                  type="number"
                  value={staffingDrafts[team.teamId] ?? String(team.requiredStaffing)}
                />
              </label>
              <div className={styles.entryTypeActions}>
                <Button
                  appearance="subtle"
                  aria-label={t("teamAdminTeamDelete")}
                  disabled={deleteBlocked}
                  icon={<DeleteRegular />}
                  onClick={() => onTeamDelete(team.teamId)}
                  title={deleteHint}
                />
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

function sortTeams(
  teams: readonly TeamAdminSummary[],
  sortKey: TeamSortKey,
  sortDirection: SortDirection
): readonly TeamAdminSummary[] {
  return [...teams].sort((first, second) => {
    const direction = sortDirection === "asc" ? 1 : -1;
    const result = compareTeamValue(first, second, sortKey);

    return result * direction;
  });
}

function compareTeamValue(first: TeamAdminSummary, second: TeamAdminSummary, sortKey: TeamSortKey): number {
  if (sortKey === "order") {
    return first.sortOrder - second.sortOrder;
  }

  if (sortKey === "memberCount") {
    return first.memberCount - second.memberCount;
  }

  if (sortKey === "requiredStaffing") {
    return first.requiredStaffing - second.requiredStaffing;
  }

  if (sortKey === "organization") {
    return first.organization.localeCompare(second.organization);
  }

  return first.teamName.localeCompare(second.teamName);
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
