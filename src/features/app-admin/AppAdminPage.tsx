import { useEffect, useMemo, useState } from "react";
import { Badge, Button, Field, Input, Radio, RadioGroup, Spinner } from "@fluentui/react-components";
import { useLogger } from "../../core/logging";
import type { TranslationKey } from "../../localization/translations";
import {
  clearLocalConfigurationOverride,
  getRuntimeConfiguration,
  hasLocalConfigurationOverride,
  saveLocalConfigurationOverride,
  validateApiBaseUrl,
  validateSharePointSiteUrl,
  type ConfigurationOrigin,
  type PlanningDataSource,
  type PlanningMembershipSource
} from "../../infrastructure/deployment/runtimeConfig";
import {
  downloadRuntimeConfigScript,
  testApiConnection,
  testMockConnection,
  testSharePointConnection,
  type ConnectionTestResult
} from "./services/appConfigService";
import {
  getMailboxSyncStatus,
  triggerMailboxSync,
  getMailboxSyncConfig,
  updateMailboxSyncConfig,
  type MailboxSyncStatus
} from "./services/mailboxSyncService";
import { getAccessInfo } from "../team-admin/services/teamAdminApi";
import styles from "./AppAdminPage.module.css";

interface AppAdminPageProps {
  readonly t: (key: TranslationKey) => string;
}

type TestTarget = "mock" | "sharepoint" | "api";

const originLabelKeys: Record<ConfigurationOrigin, TranslationKey> = {
  localOverride: "appAdminOriginLocalOverride",
  deployment: "appAdminOriginDeployment",
  build: "appAdminOriginBuild",
  default: "appAdminOriginDefault",
  standaloneBrowser: "appAdminOriginStandaloneBrowser"
};

export function AppAdminPage({ t }: AppAdminPageProps) {
  const logger = useLogger();
  const configuration = useMemo(() => getRuntimeConfiguration(logger), [logger]);

  const [isCheckingAccess, setIsCheckingAccess] = useState(true);
  const [hasAccess, setHasAccess] = useState(false);
  const [dataSource, setDataSource] = useState<PlanningDataSource>(configuration.planningDataSource);
  const [membershipSource, setMembershipSource] = useState<PlanningMembershipSource>(
    configuration.planningMembershipSource
  );
  const [sharePointSiteUrl, setSharePointSiteUrl] = useState(configuration.sharePointSiteUrl ?? "");
  const [apiBaseUrl, setApiBaseUrl] = useState(configuration.apiBaseUrl ?? "");
  const [validationError, setValidationError] = useState<string>();
  const [needsReload, setNeedsReload] = useState(false);
  const [overrideActive, setOverrideActive] = useState(hasLocalConfigurationOverride());
  const [runningTest, setRunningTest] = useState<TestTarget>();
  const [testResults, setTestResults] = useState<Partial<Record<TestTarget, ConnectionTestResult>>>({});

  // EO-424: mailbox sync status
  const [mailboxSyncStatus, setMailboxSyncStatus] = useState<MailboxSyncStatus | null>(null);
  const [isFetchingSyncStatus, setIsFetchingSyncStatus] = useState(false);
  const [isTriggeringSync, setIsTriggeringSync] = useState(false);
  const [syncStatusError, setSyncStatusError] = useState<string | null>(null);

  // EO-425: mailbox address editor
  const [mailboxAddress, setMailboxAddress] = useState("");
  const [isSavingAddress, setIsSavingAddress] = useState(false);
  const [addressSaveMessage, setAddressSaveMessage] = useState<{ readonly kind: "ok" | "error"; readonly text: string }>();

  // EO-424: mailbox sync handlers
  const handleFetchSyncStatus = async () => {
    setIsFetchingSyncStatus(true);
    setSyncStatusError(null);

    try {
      const status = await getMailboxSyncStatus(logger);
      setMailboxSyncStatus(status);
    } catch {
      setSyncStatusError(t("appAdminMailboxSyncStatusError"));
    } finally {
      setIsFetchingSyncStatus(false);
    }
  };

  const handleTriggerSync = async () => {
    setIsTriggeringSync(true);
    setSyncStatusError(null);

    try {
      const status = await triggerMailboxSync(logger);
      setMailboxSyncStatus(status);
    } catch {
      setSyncStatusError(t("appAdminMailboxSyncTriggerError"));
    } finally {
      setIsTriggeringSync(false);
    }
  };

  useEffect(() => {
    let isCancelled = false;

    // EO-418: App Admin requires an Entra directory role (Teams Administrator /
    // Global Administrator), validated server-side via the token's wids claim.
    getAccessInfo()
      .then((access) => {
        if (!isCancelled) {
          setHasAccess(access.isAppAdmin);
        }
      })
      .finally(() => {
        if (!isCancelled) {
          setIsCheckingAccess(false);
        }
      });

    return () => {
      isCancelled = true;
    };
  }, [logger]);

  // EO-425: load the current mailbox address from the API once access is confirmed
  useEffect(() => {
    if (!hasAccess) {
      return;
    }

    getMailboxSyncConfig(logger).then((config) => {
      setMailboxAddress(config.mailboxAddress);
    });
  }, [hasAccess, logger]);

  if (isCheckingAccess) {
    return (
      <div className={styles.page}>
        <Spinner label={t("planningBootstrapLoading")} />
      </div>
    );
  }

  if (!hasAccess) {
    return (
      <div className={styles.page}>
        <section className={styles.card} aria-label={t("appAdminAccessDeniedTitle")}>
          <div className={styles.cardHeader}>
            <h3 className={styles.cardTitle}>{t("appAdminAccessDeniedTitle")}</h3>
            <p className={styles.cardDescription}>{t("appAdminAccessDeniedDescription")}</p>
          </div>
        </section>
      </div>
    );
  }

  // EO-425: save mailbox address
  const handleSaveMailboxAddress = async () => {
    const trimmed = mailboxAddress.trim();

    if (trimmed && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      setAddressSaveMessage({ kind: "error", text: t("appAdminMailboxSyncAddressValidation") });
      return;
    }

    setIsSavingAddress(true);
    setAddressSaveMessage(undefined);

    try {
      const updated = await updateMailboxSyncConfig(trimmed, logger);

      if (updated) {
        setMailboxAddress(updated.mailboxAddress);
        setAddressSaveMessage({ kind: "ok", text: t("appAdminMailboxSyncAddressSaved") });
      } else {
        setAddressSaveMessage({ kind: "error", text: t("appAdminMailboxSyncAddressError") });
      }
    } catch {
      setAddressSaveMessage({ kind: "error", text: t("appAdminMailboxSyncAddressError") });
    } finally {
      setIsSavingAddress(false);
    }
  };

  const handleSaveOverride = () => {
    if (dataSource === "sharepoint" && !validateSharePointSiteUrl(sharePointSiteUrl)) {
      setValidationError(t("appAdminValidationSharePointUrl"));
      return;
    }

    if (dataSource === "api" && !validateApiBaseUrl(apiBaseUrl)) {
      setValidationError(t("appAdminValidationApiUrl"));
      return;
    }

    setValidationError(undefined);
    saveLocalConfigurationOverride({
      planningDataSource: dataSource,
      planningMembershipSource: membershipSource,
      sharePointSiteUrl: sharePointSiteUrl.trim() || undefined,
      apiBaseUrl: apiBaseUrl.trim() || undefined
    });
    logger.info("Local configuration override saved.", {
      source: "appAdmin",
      component: "AppAdminPage",
      operation: "saveOverride",
      details: { dataSource, membershipSource }
    });
    setOverrideActive(true);
    setNeedsReload(true);
  };

  const handleResetOverride = () => {
    clearLocalConfigurationOverride();
    logger.info("Local configuration override cleared.", {
      source: "appAdmin",
      component: "AppAdminPage",
      operation: "resetOverride"
    });
    setOverrideActive(false);
    setNeedsReload(true);
  };

  const handleTestConnection = async (target: TestTarget) => {
    setRunningTest(target);

    try {
      const result =
        target === "mock"
          ? await testMockConnection()
          : target === "sharepoint"
            ? await testSharePointConnection(sharePointSiteUrl.trim() || configuration.sharePointSiteUrl, logger)
            : await testApiConnection(apiBaseUrl.trim() || configuration.apiBaseUrl);

      setTestResults((previous) => ({ ...previous, [target]: result }));
      logger.info("Connection test finished.", {
        source: "appAdmin",
        component: "AppAdminPage",
        operation: "testConnection",
        details: { target, status: result.status, latencyMs: result.latencyMs, detailCode: result.detailCode }
      });
    } finally {
      setRunningTest(undefined);
    }
  };

  const renderTestResult = (target: TestTarget) => {
    if (runningTest === target) {
      return <Spinner size="tiny" label={t("appAdminTestRunning")} />;
    }

    const result = testResults[target];

    if (!result) {
      return <span className={styles.muted}>—</span>;
    }

    if (result.status === "healthy") {
      return (
        <span className={styles.testResultHealthy}>
          {t("appAdminTestHealthy")} · {result.latencyMs} ms
        </span>
      );
    }

    return (
      <span className={styles.testResultFailed}>
        {t("appAdminTestFailed")}
        {result.detailCode ? ` (${result.detailCode})` : ""} · {result.latencyMs} ms
      </span>
    );
  };

  const effectiveRows: readonly {
    readonly label: TranslationKey;
    readonly value: string | undefined;
    readonly origin: ConfigurationOrigin;
  }[] = [
    {
      label: "appAdminFieldDataSource",
      value: providerLabel(configuration.planningDataSource, t),
      origin: configuration.origins.planningDataSource
    },
    {
      label: "appAdminFieldMembershipSource",
      value:
        configuration.planningMembershipSource === "graph"
          ? t("appAdminMembershipGraph")
          : t("appAdminMembershipMock"),
      origin: configuration.origins.planningMembershipSource
    },
    {
      label: "appAdminFieldSharePointSiteUrl",
      value: configuration.sharePointSiteUrl,
      origin: configuration.origins.sharePointSiteUrl
    },
    { label: "appAdminFieldApiBaseUrl", value: configuration.apiBaseUrl, origin: configuration.origins.apiBaseUrl },
    {
      label: "appAdminFieldStandaloneBrowserUsesMock",
      value: configuration.standaloneBrowserUsesMock
        ? t("appAdminStandaloneBrowserUsesMockOn")
        : t("appAdminStandaloneBrowserUsesMockOff"),
      origin: configuration.origins.standaloneBrowserUsesMock
    },
    { label: "appAdminFieldEnvironment", value: configuration.environmentName, origin: configuration.origins.environmentName },
    { label: "appAdminFieldRelease", value: configuration.releaseVersion, origin: configuration.origins.releaseVersion },
    { label: "appAdminFieldRevision", value: configuration.sourceRevision, origin: configuration.origins.sourceRevision }
  ];

  return (
    <div className={styles.page}>
      {needsReload ? (
        <div className={styles.warning} role="status">
          {t("appAdminReloadPrompt")}{" "}
          <Button appearance="primary" size="small" onClick={() => window.location.reload()}>
            {t("appAdminReloadNow")}
          </Button>
        </div>
      ) : null}

      <div className={styles.grid}>
        <section className={styles.card} aria-label={t("appAdminEffectiveConfigTitle")}>
          <div className={styles.cardHeader}>
            <h3 className={styles.cardTitle}>{t("appAdminEffectiveConfigTitle")}</h3>
            <p className={styles.cardDescription}>{t("appAdminEffectiveConfigDescription")}</p>
          </div>
          <div className={styles.fieldList}>
            {effectiveRows.map((row) => (
              <div className={styles.fieldRow} key={row.label}>
                <span className={styles.label}>{t(row.label)}</span>
                <span className={row.value ? styles.value : `${styles.value} ${styles.muted}`}>
                  {row.value ?? t("appAdminNotConfigured")}
                </span>
                <span
                  className={
                    row.origin === "localOverride" ? `${styles.originBadge} ${styles.originOverride}` : styles.originBadge
                  }
                >
                  {t(originLabelKeys[row.origin])}
                </span>
              </div>
            ))}
          </div>
          {overrideActive ? <p className={styles.hint}>{t("appAdminOverrideActive")}</p> : null}
        </section>

        <section className={styles.card} aria-label={t("appAdminProviderConfigTitle")}>
          <div className={styles.cardHeader}>
            <h3 className={styles.cardTitle}>{t("appAdminProviderConfigTitle")}</h3>
            <p className={styles.cardDescription}>{t("appAdminProviderConfigDescription")}</p>
          </div>
          <div className={styles.formList}>
            <Field label={t("appAdminFieldDataSource")}>
              <RadioGroup
                value={dataSource}
                onChange={(_, data) => setDataSource(data.value as PlanningDataSource)}
              >
                <Radio value="mock" label={t("appAdminProviderMock")} />
                <Radio value="sharepoint" label={t("appAdminProviderSharePoint")} />
                <Radio value="api" label={t("appAdminProviderApi")} />
              </RadioGroup>
            </Field>
            <Field label={t("appAdminFieldMembershipSource")}>
              <RadioGroup
                value={membershipSource}
                onChange={(_, data) => setMembershipSource(data.value as PlanningMembershipSource)}
              >
                <Radio value="mock" label={t("appAdminMembershipMock")} />
                <Radio value="graph" label={t("appAdminMembershipGraph")} />
              </RadioGroup>
            </Field>
            <Field label={t("appAdminFieldSharePointSiteUrl")} hint={t("appAdminSharePointSiteUrlHint")}>
              <Input
                value={sharePointSiteUrl}
                onChange={(_, data) => setSharePointSiteUrl(data.value)}
                placeholder="https://contoso.sharepoint.com/sites/rpp"
              />
            </Field>
            <Field label={t("appAdminFieldApiBaseUrl")} hint={t("appAdminApiBaseUrlHint")}>
              <Input
                value={apiBaseUrl}
                onChange={(_, data) => setApiBaseUrl(data.value)}
                placeholder="https://rpp-api.example.org"
              />
            </Field>
            {dataSource === "api" ? <p className={styles.hint}>{t("appAdminCspHint")}</p> : null}
            {validationError ? (
              <div className={styles.warning} role="alert">
                {validationError}
              </div>
            ) : null}
            <div className={styles.actions}>
              <Button appearance="secondary" disabled={!overrideActive} onClick={handleResetOverride}>
                {t("appAdminResetOverride")}
              </Button>
              <Button appearance="primary" onClick={handleSaveOverride}>
                {t("appAdminSaveOverride")}
              </Button>
            </div>
          </div>
        </section>

        <section className={styles.card} aria-label={t("appAdminConnectionTestTitle")}>
          <div className={styles.cardHeader}>
            <h3 className={styles.cardTitle}>{t("appAdminConnectionTestTitle")}</h3>
            <p className={styles.cardDescription}>{t("appAdminConnectionTestDescription")}</p>
          </div>
          <div className={styles.fieldList}>
            {(["mock", "sharepoint", "api"] as const).map((target) => (
              <div className={styles.testRow} key={target}>
                <span className={styles.label}>{providerLabel(target, t)}</span>
                {renderTestResult(target)}
                <Button
                  appearance="secondary"
                  size="small"
                  disabled={runningTest !== undefined}
                  onClick={() => void handleTestConnection(target)}
                >
                  {t("appAdminTestConnection")}
                </Button>
              </div>
            ))}
          </div>
        </section>

        <section className={styles.card} aria-label={t("appAdminExportTitle")}>
          <div className={styles.cardHeader}>
            <h3 className={styles.cardTitle}>{t("appAdminExportTitle")}</h3>
            <p className={styles.cardDescription}>{t("appAdminExportDescription")}</p>
          </div>
          <div className={styles.actions}>
            <Button appearance="primary" onClick={() => downloadRuntimeConfigScript(configuration)}>
              {t("appAdminExportButton")}
            </Button>
          </div>
        </section>

        {/* EO-424: Mailbox Sync Status */}
        <section className={styles.card} aria-label={t("appAdminMailboxSyncTitle")}>
          <div className={styles.cardHeader}>
            {/* EO-424 shipped as beta: accepted against Microsoft 365, but the range of sender
                formats a mailbox actually receives is not covered by that one path. */}
            <div className={styles.cardTitleRow}>
              <h3 className={styles.cardTitle}>{t("appAdminMailboxSyncTitle")}</h3>
              <Badge appearance="outline" color="warning">{t("appAdminMailboxSyncBeta")}</Badge>
            </div>
            <p className={styles.cardDescription}>{t("appAdminMailboxSyncDescription")}</p>
            <p className={styles.cardDescription}>{t("appAdminMailboxSyncBetaNote")}</p>
          </div>
          {syncStatusError ? (
            <p className={styles.warning} role="alert">{syncStatusError}</p>
          ) : null}
          {mailboxSyncStatus ? (
            <>
              <div className={styles.fieldList}>
                <div className={styles.fieldRow}>
                  <span className={styles.label}>{t("appAdminMailboxSyncEnabled")}</span>
                  <span className={styles.value}>
                    {mailboxSyncStatus.enabled ? t("appAdminMailboxSyncEnabledYes") : t("appAdminMailboxSyncEnabledNo")}
                  </span>
                </div>
                <div className={styles.fieldRow}>
                  <span className={styles.label}>{t("appAdminMailboxSyncRunning")}</span>
                  <span className={styles.value}>
                    {mailboxSyncStatus.isRunning ? t("appAdminMailboxSyncRunningYes") : t("appAdminMailboxSyncRunningNo")}
                  </span>
                </div>
                <div className={styles.fieldRow}>
                  <span className={styles.label}>{t("appAdminMailboxSyncLastRun")}</span>
                  <span className={styles.value}>
                    {mailboxSyncStatus.lastSyncCompletedAt
                      ? new Date(mailboxSyncStatus.lastSyncCompletedAt).toLocaleString()
                      : t("appAdminMailboxSyncNever")}
                  </span>
                </div>
                <div className={styles.fieldRow}>
                  <span className={styles.label}>{t("appAdminMailboxSyncProcessed")}</span>
                  <span className={styles.value}>{mailboxSyncStatus.messagesProcessed}</span>
                </div>
                <div className={styles.fieldRow}>
                  <span className={styles.label}>{t("appAdminMailboxSyncCreated")}</span>
                  <span className={styles.value}>{mailboxSyncStatus.absencesCreated}</span>
                </div>
                <div className={styles.fieldRow}>
                  <span className={styles.label}>{t("appAdminMailboxSyncUpdated")}</span>
                  <span className={styles.value}>{mailboxSyncStatus.absencesUpdated}</span>
                </div>
                <div className={styles.fieldRow}>
                  <span className={styles.label}>{t("appAdminMailboxSyncDeleted")}</span>
                  <span className={styles.value}>{mailboxSyncStatus.absencesDeleted}</span>
                </div>
                <div className={styles.fieldRow}>
                  <span className={styles.label}>{t("appAdminMailboxSyncErrors")}</span>
                  <span className={mailboxSyncStatus.errors > 0 ? `${styles.value} ${styles.warning}` : styles.value}>
                    {mailboxSyncStatus.errors}
                  </span>
                </div>
                <div className={styles.fieldRow}>
                  <span className={styles.label}>{t("appAdminMailboxSyncSkipped")}</span>
                  <span className={styles.value}>{mailboxSyncStatus.skipped}</span>
                </div>
              </div>
              {mailboxSyncStatus.lastError ? (
                <p className={styles.warning} role="alert">
                  {t("appAdminMailboxSyncLastError")}: {mailboxSyncStatus.lastError}
                </p>
              ) : null}
              {mailboxSyncStatus.entries.length > 0 ? (
                <div className={styles.syncEntries}>
                  <h4 className={styles.sectionSubtitle}>{t("appAdminMailboxSyncEntries")}</h4>
                  <div className={styles.syncEntryList}>
                    {mailboxSyncStatus.entries.map((entry, index) => (
                      <div className={styles.syncEntryRow} key={`${entry.messageId ?? index}`}>
                        <span className={styles.syncEntryAction}>
                          {entry.action === "created" ? "✅"
                            : entry.action === "updated" ? "🔄"
                            : entry.action === "deleted" ? "🗑️"
                            : entry.action === "skipped" ? "⏭️"
                            : "❌"}
                        </span>
                        <span className={styles.syncEntrySubject}>{entry.messageSubject ?? "—"}</span>
                        <span className={styles.syncEntryDetail}>{entry.detail ?? entry.employeeId ?? ""}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
            </>
          ) : (
            <p className={styles.muted}>{t("appAdminMailboxSyncNoData")}</p>
          )}
          <div className={styles.actions}>
            <Button
              appearance="secondary"
              disabled={isFetchingSyncStatus || isTriggeringSync}
              onClick={() => void handleFetchSyncStatus()}
            >
              {isFetchingSyncStatus ? t("appAdminMailboxSyncRefreshing") : t("appAdminMailboxSyncRefresh")}
            </Button>
            <Button
              appearance="primary"
              disabled={isFetchingSyncStatus || isTriggeringSync || mailboxSyncStatus?.isRunning === true}
              onClick={() => void handleTriggerSync()}
            >
              {isTriggeringSync ? t("appAdminMailboxSyncTriggering") : t("appAdminMailboxSyncTrigger")}
            </Button>
          </div>

          {/* EO-425: Mailbox address editor */}
          <div className={styles.formList}>
            <Field label={t("appAdminMailboxSyncAddress")} hint={t("appAdminMailboxSyncAddressHint")}>
              <Input
                type="email"
                value={mailboxAddress}
                onChange={(_, data) => {
                  setMailboxAddress(data.value);
                  setAddressSaveMessage(undefined);
                }}
                placeholder="absences@contoso.onmicrosoft.com"
                disabled={isSavingAddress}
              />
            </Field>
            {addressSaveMessage ? (
              <p
                className={addressSaveMessage.kind === "error" ? styles.warning : styles.hint}
                role="status"
              >
                {addressSaveMessage.text}
              </p>
            ) : null}
            <div className={styles.actions}>
              <Button
                appearance="primary"
                disabled={isSavingAddress}
                onClick={() => void handleSaveMailboxAddress()}
              >
                {isSavingAddress ? t("appAdminMailboxSyncAddressSaving") : t("appAdminMailboxSyncAddressSave")}
              </Button>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

function providerLabel(source: PlanningDataSource, t: (key: TranslationKey) => string): string {
  if (source === "sharepoint") {
    return t("appAdminProviderSharePoint");
  }

  if (source === "api") {
    return t("appAdminProviderApi");
  }

  return t("appAdminProviderMock");
}
