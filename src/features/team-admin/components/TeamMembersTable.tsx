import { useMemo, useState } from "react";
import {
  Button,
  Dialog,
  DialogActions,
  DialogBody,
  DialogContent,
  DialogSurface,
  DialogTitle,
  DialogTrigger,
  Tooltip
} from "@fluentui/react-components";
import { ArrowSortDownRegular, ArrowSortRegular, ArrowSortUpRegular, DeleteRegular } from "@fluentui/react-icons";
import type { TranslationKey } from "../../../localization/translations";
import type { TeamAdminMember, TeamAdminPerson, TeamAdminTeamOption } from "../types/teamSettings";
import styles from "../TeamAdminPage.module.css";

type MemberSortKey =
  | "name"
  | "email"
  | "primaryTeam"
  | "additionalPositions"
  | "employmentPercentage"
  | "vacationBalance"
  | "activeVacationRequests"
  | "approvalExempt"
  | "effectiveApprover";
type SortDirection = "asc" | "desc";

interface TeamMembersTableProps {
  readonly members: readonly TeamAdminMember[];
  readonly assignableMembers: readonly TeamAdminMember[];
  readonly approverOptions: readonly TeamAdminPerson[];
  readonly teamOptions: readonly TeamAdminTeamOption[];
  readonly canEdit?: boolean;
  readonly onMemberAdd: (userId: string) => void;
  readonly onMemberRemove: (userId: string) => void;
  readonly onMemberPrimaryTeamChange: (userId: string, primaryTeamId: string) => void;
  readonly onMemberPositionsChange: (userId: string, positions: readonly string[]) => void;
  readonly onMemberApprovalExemptChange: (userId: string, approvalExempt: boolean) => void;
  readonly onMemberEmploymentPercentageChange: (userId: string, employmentPercentage: number) => void;
  readonly onMemberVacationBalanceChange: (userId: string, vacationBalance: number) => void;
  readonly onMemberEffectiveApproverChange: (userId: string, approverUserId: string) => void;
  readonly t: (key: TranslationKey) => string;
}

export function TeamMembersTable({
  members,
  assignableMembers,
  approverOptions,
  teamOptions,
  canEdit = true,
  onMemberAdd,
  onMemberRemove,
  onMemberPrimaryTeamChange,
  onMemberPositionsChange,
  onMemberApprovalExemptChange,
  onMemberEmploymentPercentageChange,
  onMemberVacationBalanceChange,
  onMemberEffectiveApproverChange,
  t
}: TeamMembersTableProps) {
  const [sortKey, setSortKey] = useState<MemberSortKey>("name");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const [memberToAddUserId, setMemberToAddUserId] = useState("");
  // Fluent Dialog instead of window.confirm — Teams iframes often swallow native confirm().
  const [memberPendingRemove, setMemberPendingRemove] = useState<TeamAdminMember | undefined>();
  const availableMembers = useMemo(() => {
    const visibleMemberIds = new Set(members.map((member) => member.userId));

    return assignableMembers.filter((member) => !visibleMemberIds.has(member.userId));
  }, [assignableMembers, members]);
  const sortedMembers = useMemo(
    () => sortMembers(members, sortKey, sortDirection),
    [members, sortDirection, sortKey]
  );
  const changeSort = (nextSortKey: MemberSortKey) => {
    if (nextSortKey === sortKey) {
      setSortDirection((currentDirection) => currentDirection === "asc" ? "desc" : "asc");
      return;
    }

    setSortKey(nextSortKey);
    setSortDirection("asc");
  };
  const renderSortableHeader = (label: string, nextSortKey: MemberSortKey) => (
    <button className={styles.sortHeader} onClick={() => changeSort(nextSortKey)} type="button">
      <span>{label}</span>
      {getSortIcon(sortKey === nextSortKey ? sortDirection : undefined)}
    </button>
  );

  return (
    <section className={`${styles.card} ${styles.wide}`} aria-label={t("teamAdminTeamMembers")}>
      <div className={styles.cardHeader}>
        <h3 className={styles.cardTitle}>{t("teamAdminTeamMembers")}</h3>
        <p className={styles.cardDescription}>{t("teamAdminTeamMembersDescription")}</p>
      </div>
      <div className={styles.memberAddRow}>
        <label className={styles.field}>
          <span>{t("teamAdminMemberAdd")}</span>
          <select value={memberToAddUserId} onChange={(event) => setMemberToAddUserId(event.target.value)}>
            <option value="">{t("teamAdminMemberAddPlaceholder")}</option>
            {availableMembers.map((member) => (
              <option key={member.userId} value={member.userId}>
                {member.displayName} · {member.primaryTeamName}
              </option>
            ))}
          </select>
        </label>
        <button
          className={styles.secondaryAction}
          disabled={!memberToAddUserId}
          onClick={() => {
            onMemberAdd(memberToAddUserId);
            setMemberToAddUserId("");
          }}
          type="button"
        >
          {t("teamAdminMemberAddButton")}
        </button>
      </div>
      <div className={styles.tableScroller}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th className={styles.memberActionsHeader}>{t("teamAdminMemberActions")}</th>
              <th>{renderSortableHeader(t("teamAdminMemberName"), "name")}</th>
              <th>{renderSortableHeader(t("teamAdminMemberEmail"), "email")}</th>
              <th>{renderSortableHeader(t("teamAdminPrimaryTeam"), "primaryTeam")}</th>
              <th>{renderSortableHeader(t("teamAdminAdditionalPositions"), "additionalPositions")}</th>
              <th>{renderSortableHeader(t("teamAdminEmploymentPercentage"), "employmentPercentage")}</th>
              <th>{renderSortableHeader(t("teamAdminVacationBalance"), "vacationBalance")}</th>
              <th>{renderSortableHeader(t("teamAdminActiveVacationRequests"), "activeVacationRequests")}</th>
              <th>{renderSortableHeader(t("teamAdminApprovalExempt"), "approvalExempt")}</th>
              <th>{renderSortableHeader(t("teamAdminEffectiveApprover"), "effectiveApprover")}</th>
            </tr>
          </thead>
          <tbody>
            {sortedMembers.map((member) => (
              <tr key={member.userId}>
                <td className={styles.memberActionsCell}>
                  <Tooltip content={t("teamAdminMemberRemoveHint")} relationship="label">
                    <Button
                      appearance="subtle"
                      aria-label={`${t("teamAdminMemberRemove")} ${member.displayName}`}
                      className={styles.dangerAction}
                      disabled={!canEdit}
                      icon={<DeleteRegular />}
                      onClick={() => setMemberPendingRemove(member)}
                      type="button"
                    />
                  </Tooltip>
                </td>
                <td>{member.displayName}</td>
                <td>{member.email}</td>
                <td>
                  <select
                    aria-label={`${t("teamAdminPrimaryTeam")} ${member.displayName}`}
                    className={styles.tableControl}
                    disabled={!canEdit}
                    value={member.primaryTeamId}
                    onChange={(event) => onMemberPrimaryTeamChange(member.userId, event.target.value)}
                  >
                    {teamOptions.map((team) => (
                      <option key={team.teamId} value={team.teamId}>
                        {team.teamName}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <div className={styles.multiTeamPicker} aria-label={`${t("teamAdminAdditionalPositions")} ${member.displayName}`}>
                    {teamOptions.map((team) => {
                      const isChecked = member.additionalPositions.includes(team.teamName);
                      const isPrimaryTeam = member.primaryTeamId === team.teamId;

                      return (
                        <label className={styles.teamPickerOption} key={team.teamId}>
                          <input
                            checked={isChecked}
                            disabled={isPrimaryTeam}
                            onChange={(event) =>
                              onMemberPositionsChange(
                                member.userId,
                                toggleTeamPosition(member.additionalPositions, team.teamName, event.target.checked)
                              )
                            }
                            type="checkbox"
                          />
                          <span>{team.teamName}</span>
                        </label>
                      );
                    })}
                  </div>
                </td>
                <td>
                  <input
                    aria-label={`${t("teamAdminEmploymentPercentage")} ${member.displayName}`}
                    className={styles.tableControl}
                    max={150}
                    min={0}
                    onChange={(event) => onMemberEmploymentPercentageChange(member.userId, Number(event.target.value))}
                    type="number"
                    value={member.employmentPercentage ?? 100}
                  />
                </td>
                <td>
                  <input
                    aria-label={`${t("teamAdminVacationBalance")} ${member.displayName}`}
                    className={styles.tableControl}
                    min={0}
                    onChange={(event) => onMemberVacationBalanceChange(member.userId, Number(event.target.value))}
                    step={0.5}
                    type="number"
                    value={member.vacationBalance}
                  />
                </td>
                <td>{member.activeVacationRequests}</td>
                <td>
                  <label className={styles.compactCheckbox}>
                    <input
                      aria-label={`${t("teamAdminApprovalExempt")} ${member.displayName}`}
                      checked={member.approvalExempt}
                      onChange={(event) => onMemberApprovalExemptChange(member.userId, event.target.checked)}
                      type="checkbox"
                    />
                  </label>
                </td>
                <td>
                  {member.approvalExempt ? (
                    t("teamAdminNoApprovalRequired")
                  ) : (
                    <select
                      aria-label={`${t("teamAdminEffectiveApprover")} ${member.displayName}`}
                      className={styles.tableControl}
                      value={member.effectiveApprover.userId}
                      onChange={(event) => onMemberEffectiveApproverChange(member.userId, event.target.value)}
                    >
                      {approverOptions.map((approver) => (
                        <option key={approver.userId} value={approver.userId}>
                          {approver.displayName}
                        </option>
                      ))}
                    </select>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Dialog
        open={memberPendingRemove !== undefined}
        onOpenChange={(_, data) => {
          if (!data.open) {
            setMemberPendingRemove(undefined);
          }
        }}
      >
        <DialogSurface>
          <DialogBody>
            <DialogTitle>{t("teamAdminMemberRemove")}</DialogTitle>
            <DialogContent>
              {t("teamAdminMemberRemoveConfirm").replace(
                "{name}",
                memberPendingRemove?.displayName || memberPendingRemove?.userId || ""
              )}
            </DialogContent>
            <DialogActions>
              <DialogTrigger disableButtonEnhancement>
                <Button appearance="secondary" type="button">
                  {t("absenceCancel")}
                </Button>
              </DialogTrigger>
              <Button
                appearance="primary"
                className={styles.dangerAction}
                type="button"
                onClick={() => {
                  const userId = memberPendingRemove?.userId;
                  setMemberPendingRemove(undefined);
                  if (userId) {
                    onMemberRemove(userId);
                  }
                }}
              >
                {t("teamAdminMemberRemove")}
              </Button>
            </DialogActions>
          </DialogBody>
        </DialogSurface>
      </Dialog>
    </section>
  );
}

function toggleTeamPosition(
  currentPositions: readonly string[],
  teamName: string,
  checked: boolean
): readonly string[] {
  if (checked) {
    return currentPositions.includes(teamName) ? currentPositions : [...currentPositions, teamName];
  }

  return currentPositions.filter((position) => position !== teamName);
}

function sortMembers(
  members: readonly TeamAdminMember[],
  sortKey: MemberSortKey,
  sortDirection: SortDirection
): readonly TeamAdminMember[] {
  return [...members].sort((first, second) => {
    const direction = sortDirection === "asc" ? 1 : -1;
    const result = compareMemberValue(first, second, sortKey);

    return result * direction;
  });
}

function compareMemberValue(first: TeamAdminMember, second: TeamAdminMember, sortKey: MemberSortKey): number {
  if (sortKey === "employmentPercentage") {
    return (first.employmentPercentage ?? 100) - (second.employmentPercentage ?? 100);
  }

  if (sortKey === "vacationBalance") {
    return first.vacationBalance - second.vacationBalance;
  }

  if (sortKey === "activeVacationRequests") {
    return first.activeVacationRequests - second.activeVacationRequests;
  }

  if (sortKey === "approvalExempt") {
    return Number(first.approvalExempt) - Number(second.approvalExempt);
  }

  return getMemberSortText(first, sortKey).localeCompare(getMemberSortText(second, sortKey));
}

function getMemberSortText(member: TeamAdminMember, sortKey: MemberSortKey): string {
  if (sortKey === "email") {
    return member.email;
  }

  if (sortKey === "primaryTeam") {
    return member.primaryTeamName;
  }

  if (sortKey === "additionalPositions") {
    return member.additionalPositions.join(", ");
  }

  if (sortKey === "effectiveApprover") {
    return member.approvalExempt ? "" : member.effectiveApprover.displayName;
  }

  return member.displayName;
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
