import { useCallback, useEffect, useState } from "react";
import { Badge, Button } from "@fluentui/react-components";
import { ArrowClockwiseRegular, OpenRegular } from "@fluentui/react-icons";
import { useLogger } from "../../core/logging";
import type { TranslationKey } from "../../localization/translations";
import type { VacationRequest, VacationRequestStatus } from "../../models/approval";
import { approvalRepositories } from "../../repositories/defaultApprovalRepositories";
import { getAbsenceTypeLabelByKey } from "../../data/absenceTypes";
import { resolveMemberDisplayName } from "../team-admin/services/teamAdminApi";
import { resolveActiveTeamId, resolveCurrentUserId } from "../../infrastructure/microsoft365/currentUser";
import { invalidatePlanningBootstrapCache } from "../../services/planningBootstrapService";
import { consumePendingVacationRequestId } from "../../services/vacationRequestDeepLink";
import styles from "./MyApprovalsPage.module.css";

// Microsoft's first-party Approvals app (stable across tenants); the deep link
// opens the native approvals hub where decisions are made.
const TEAMS_APPROVALS_DEEP_LINK = "https://teams.microsoft.com/l/entity/7c316234-ded0-4f95-8a83-8453d0876592/approvals";

interface MyApprovalsPageProps {
  readonly t: (key: TranslationKey) => string;
}

export function MyApprovalsPage({ t }: MyApprovalsPageProps) {
  const logger = useLogger();
  const [requests, setRequests] = useState<readonly VacationRequest[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);
  // EO-421: request targeted by an Outlook event deep link (subEntityId).
  const [highlightedRequestId, setHighlightedRequestId] = useState<string>();

  const loadRequests = useCallback(async () => {
    setIsLoading(true);
    setHasError(false);

    // Reloading the list also triggers the server-side decision sync against
    // Microsoft Graph (EO-410 pull model).
    // "Meine Anträge" is scoped to the signed-in person. Team scope is optional:
    // when present it expands host → internal teams (and legacy team names). We still
    // pass it so Graph decision sync runs in the active host context.
    const userId = await resolveCurrentUserId(logger);
    const teamId = await resolveActiveTeamId(logger);

    if (!userId) {
      logger.warn("My Approvals: no signed-in user id — cannot load personal requests.", {
        source: "ui",
        component: "MyApprovalsPage",
        operation: "loadRequests"
      });
      setRequests([]);
      setHasError(true);
      setIsLoading(false);
      return;
    }

    const result = await approvalRepositories.vacationRequests.listVacationRequests({
      userId,
      ...(teamId ? { teamId } : {})
    });

    if (result.ok) {
      setRequests([...result.value.items].sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt)));
      const pendingRequestId = consumePendingVacationRequestId();

      if (pendingRequestId) {
        setHighlightedRequestId(pendingRequestId);
      }
      // The server-side sync may have applied decisions to linked absences; make
      // the Timeline reload a fresh snapshot on its next visit.
      invalidatePlanningBootstrapCache();
    } else {
      logger.warn("Vacation requests could not be loaded.", {
        source: "ui",
        component: "MyApprovalsPage",
        operation: "loadRequests",
        details: { errorCode: result.error.code }
      });
      setHasError(true);
    }

    setIsLoading(false);
  }, [logger]);

  useEffect(() => {
    void loadRequests();
  }, [loadRequests]);

  const openTeamsApprovals = () => {
    window.open(TEAMS_APPROVALS_DEEP_LINK, "_blank", "noopener");
  };

  return (
    <section className={styles.page} aria-label={t("myApprovalsTitle")}>
      <div className={styles.card}>
        <div className={styles.header}>
          <div>
            <h3>{t("myApprovalsTitle")}</h3>
            <p>{t("myApprovalsDescription")}</p>
          </div>
          <div className={styles.actions}>
            <Button appearance="secondary" icon={<ArrowClockwiseRegular />} onClick={() => void loadRequests()}>
              {t("myApprovalsRefresh")}
            </Button>
            <Button appearance="primary" icon={<OpenRegular />} onClick={openTeamsApprovals}>
              {t("myApprovalsOpenTeams")}
            </Button>
          </div>
        </div>

        {isLoading ? (
          <p className={styles.stateText}>{t("planningBootstrapLoading")}</p>
        ) : hasError ? (
          <p className={styles.stateText} role="alert">{t("myApprovalsLoadError")}</p>
        ) : requests.length === 0 ? (
          <p className={styles.stateText}>{t("myApprovalsEmpty")}</p>
        ) : (
          <>
            <p className={styles.hint}>{t("myApprovalsWhereToFind")}</p>
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>{t("myApprovalsColPeriod")}</th>
                    <th>{t("absenceFieldType")}</th>
                    <th>{t("vacationRequestStatus")}</th>
                    <th>{t("vacationRequestApprover")}</th>
                    <th>{t("myApprovalsColM365")}</th>
                    <th>{t("myApprovalsColOutlook")}</th>
                    <th>{t("myApprovalsColModified")}</th>
                  </tr>
                </thead>
                <tbody>
                  {requests.map((request) => {
                    const approverLabel =
                      resolveMemberDisplayName(request.approverUserId)
                      ?? request.approverUserId
                      ?? "–";
                    const graphRef = request.approvalReferenceId;
                    const m365Label = graphRef
                      ? t("myApprovalsM365Linked")
                      : request.status === "pendingApproval" || request.status === "submitted"
                        ? t("myApprovalsM365Missing")
                        : "–";
                    const m365Title = graphRef
                      ? `${t("myApprovalsGraphId")}: ${graphRef}`
                      : t("myApprovalsM365Missing");

                    return (
                      <tr
                        key={request.id}
                        className={request.id === highlightedRequestId ? styles.highlightedRow : undefined}
                        ref={request.id === highlightedRequestId
                          ? (row) => row?.scrollIntoView({ block: "center" })
                          : undefined}
                      >
                        <td>{request.startDate} – {request.endDate}</td>
                        <td>{getAbsenceTypeLabelByKey(request.absenceType, t)}</td>
                        <td>
                          <Badge appearance="filled" color={getStatusColor(request.status)}>
                            {t(getStatusLabelKey(request.status))}
                          </Badge>
                        </td>
                        <td title={request.approverUserId ?? undefined}>{approverLabel}</td>
                        <td title={m365Title}>
                          <span className={styles.m365Cell}>
                            {m365Label}
                            {graphRef ? (
                              <span className={styles.graphId}>{shortenGraphId(graphRef)}</span>
                            ) : null}
                          </span>
                        </td>
                        <td title={request.outlookSync.lastError ?? ""}>
                          {getOutlookSyncIndicator(request.outlookSync.syncStatus)}
                        </td>
                        <td>{formatTimestamp(request.modifiedAt)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </section>
  );
}

function getStatusLabelKey(status: VacationRequestStatus): TranslationKey {
  const labels: Record<VacationRequestStatus, TranslationKey> = {
    approved: "approvalStatusApproved",
    cancelled: "approvalStatusCancelled",
    draft: "approvalStatusDraft",
    failed: "approvalStatusFailed",
    pendingApproval: "approvalStatusPendingApproval",
    rejected: "approvalStatusRejected",
    submitted: "approvalStatusSubmitted"
  };

  return labels[status] ?? "approvalStatusDraft";
}

function getStatusColor(status: VacationRequestStatus): "brand" | "danger" | "important" | "informative" | "severe" | "success" | "subtle" | "warning" {
  if (status === "approved") {
    return "success";
  }

  if (status === "rejected") {
    return "danger";
  }

  if (status === "cancelled" || status === "failed") {
    return "warning";
  }

  if (status === "pendingApproval" || status === "submitted") {
    return "important";
  }

  return "subtle";
}

function formatTimestamp(value: string): string {
  const date = new Date(value);

  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function getOutlookSyncIndicator(status: VacationRequest["outlookSync"]["syncStatus"]): string {
  if (status === "synced") {
    return "✓";
  }

  if (status === "failed") {
    return "!";
  }

  if (status === "pending") {
    return "…";
  }

  return "–";
}

function shortenGraphId(value: string): string {
  return value.length <= 12 ? value : `${value.slice(0, 8)}…`;
}
