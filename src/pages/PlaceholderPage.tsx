import { lazy, Suspense, useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { Button } from "@fluentui/react-components";
import {
  ArrowRightRegular,
  DatabaseRegular,
  GlobeRegular,
  LayoutRowThreeRegular,
  PanelRightContractRegular,
  PeopleRegular,
  RocketRegular,
  ToggleMultipleRegular
} from "@fluentui/react-icons";
import { DesignCard } from "../components/DesignCard";
import {
  clearPersistedMockState,
  exportPersistedMockState,
  hasPersistedMockState,
  importPersistedMockState
} from "../data/mockStatePersistence";
import { publicHolidays } from "../data/publicHolidays";
import { PageScaffold, pageScaffoldStyles } from "../components/PageScaffold";
import { getRuntimeConfiguration } from "../infrastructure/deployment/runtimeConfig";
import { resilientFetch } from "../infrastructure/http/resilientFetch";
import type { AppRoute } from "../models/navigation";
import type { TranslationKey } from "../localization/translations";
import type { PlanningRepositories } from "../repositories/planningRepositories";
import { useLogger } from "../core/logging";
import infoStyles from "./PlaceholderPage.module.css";

const Timeline = lazy(() =>
  import("../components/timeline/Timeline").then((module) => ({ default: module.Timeline }))
);
const TeamCapacityDashboard = lazy(() =>
  import("../components/teamCapacity/TeamCapacityDashboard").then((module) => ({ default: module.TeamCapacityDashboard }))
);
const MySettingsPage = lazy(() =>
  import("../features/settings/MySettingsPage").then((module) => ({ default: module.MySettingsPage }))
);
const TeamAdminPage = lazy(() =>
  import("../features/team-admin/TeamAdminPage").then((module) => ({ default: module.TeamAdminPage }))
);
const AppAdminPage = lazy(() =>
  import("../features/app-admin/AppAdminPage").then((module) => ({ default: module.AppAdminPage }))
);
const ReportsPage = lazy(() =>
  import("../features/reports/ReportsPage").then((module) => ({ default: module.ReportsPage }))
);
const ApprovalsPrototypePage = lazy(() =>
  import("../features/approvals/ApprovalsPrototypePage").then((module) => ({ default: module.ApprovalsPrototypePage }))
);
const MyApprovalsPage = lazy(() =>
  import("../features/approvals/MyApprovalsPage").then((module) => ({ default: module.MyApprovalsPage }))
);

export function preloadRoute(route: AppRoute): void {
  if (route.key === "overview") {
    void import("../components/timeline/Timeline");
    return;
  }

  if (route.key === "teamCapacity") {
    void import("../components/teamCapacity/TeamCapacityDashboard");
    return;
  }

  if (route.key === "teamAdmin") {
    void import("../features/team-admin/TeamAdminPage");
    return;
  }

  if (route.key === "appAdmin") {
    void import("../features/app-admin/AppAdminPage");
    return;
  }

  if (route.key === "reports") {
    void import("../features/reports/ReportsPage");
    return;
  }

  if (route.key === "approvals") {
    void import("../features/approvals/ApprovalsPrototypePage");
    return;
  }

  if (route.key === "settings") {
    void import("../features/settings/MySettingsPage");
    return;
  }
}

interface PlaceholderPageProps {
  readonly locale: string;
  readonly repositories: PlanningRepositories;
  readonly route: AppRoute;
  readonly t: (key: TranslationKey) => string;
}

interface FrontendReleaseMetadata {
  readonly builtAt?: string;
}

interface BackendHealthMetadata {
  readonly status?: string;
  readonly version?: string;
  readonly sourceRevision?: string;
  readonly buildTimestamp?: string;
  readonly environment?: string;
  readonly backendProvider?: string;
  readonly databaseServerName?: string;
  readonly databaseName?: string;
  readonly webServerName?: string;
}

export function PlaceholderPage({
  locale,
  repositories,
  route,
  t
}: PlaceholderPageProps) {
  const logger = useLogger();
  const runtimeConfig = useMemo(() => getRuntimeConfiguration(logger), [logger]);
  const isMockMode = runtimeConfig.approvalMode === "mock";
  const [frontendRelease, setFrontendRelease] = useState<FrontendReleaseMetadata>();
  const [backendHealth, setBackendHealth] = useState<BackendHealthMetadata>();
  const [isBackendHealthLoading, setIsBackendHealthLoading] = useState(false);

  const backendHealthUrl = useMemo(() => {
    if (runtimeConfig.planningDataSource === "api" && runtimeConfig.apiBaseUrl) {
      return `${runtimeConfig.apiBaseUrl.replace(/\/$/, "")}/health`;
    }

    return runtimeConfig.healthCheckUrl || "/health";
  }, [runtimeConfig.apiBaseUrl, runtimeConfig.healthCheckUrl, runtimeConfig.planningDataSource]);

  const isOverview = route.key === "overview";
  const isTeamCapacity = route.key === "teamCapacity";
  const isTeamAdmin = route.key === "teamAdmin";
  const isAppAdmin = route.key === "appAdmin";
  const isReports = route.key === "reports";
  const isApprovals = route.key === "approvals" && isMockMode;
  const isMyApprovals = route.key === "approvals" && !isMockMode;
  const isSettings = route.key === "settings";
  const isInfo = route.key === "info";

  const [importError, setImportError] = useState<string | undefined>();
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    resilientFetch("/release.json", { cache: "no-store" }, {
      component: "PlaceholderPage",
      operation: "loadReleaseMetadata",
      logger
    })
      .then(async (response) => (response.ok ? response.json() : undefined))
      .then((payload) => {
        if (payload && typeof payload === "object") {
          setFrontendRelease(payload as FrontendReleaseMetadata);
        }
      })
      .catch(() => undefined);
  }, [logger]);

  useEffect(() => {
    setIsBackendHealthLoading(true);

    resilientFetch(backendHealthUrl, {
      method: "GET",
      headers: { Accept: "application/json" },
      cache: "no-store"
    }, {
      component: "PlaceholderPage",
      operation: "loadBackendHealth",
      logger
    })
      .then(async (response) => (response.ok ? response.json() : undefined))
      .then((payload) => {
        if (payload && typeof payload === "object") {
          setBackendHealth(payload as BackendHealthMetadata);
        } else {
          setBackendHealth(undefined);
        }
      })
      .catch(() => {
        setBackendHealth(undefined);
      })
      .finally(() => {
        setIsBackendHealthLoading(false);
      });
  }, [backendHealthUrl, logger]);

  const handleExportJson = (): void => {
    try {
      const json = exportPersistedMockState({ publicHolidays });
      const blob = new Blob([json], { type: "application/json;charset=utf-8" });
      const url = window.URL.createObjectURL(blob);
      const anchor = document.createElement("a");

      anchor.href = url;
      anchor.download = `resource-presence-planner-mock-state-${new Date().toISOString().slice(0, 10)}.json`;
      anchor.click();
      window.URL.revokeObjectURL(url);
    } catch {
      setImportError(t("demoDataExportFailed"));
    }
  };

  const handleOpenImportDialog = (): void => {
    fileInputRef.current?.click();
  };

  const handleImportJson = async (event: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = event.currentTarget.files?.[0];

    if (!file) {
      return;
    }

    try {
      const content = await file.text();
      importPersistedMockState(content);
      window.location.reload();
    } catch {
      setImportError(t("demoDataImportFailed"));
    } finally {
      event.currentTarget.value = "";
    }
  };

  const getDisplayValue = (value?: string): string => {
    const normalized = value?.trim();
    return normalized ? normalized : t("infoRuntimeNotAvailable");
  };

  const formatTimestamp = (value?: string): string => {
    if (!value) {
      return t("infoRuntimeNotAvailable");
    }

    const parsed = new Date(value);

    return Number.isNaN(parsed.getTime())
      ? value
      : new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(parsed);
  };

  const providerSummary = `${runtimeConfig.planningDataSource} / ${runtimeConfig.planningMembershipSource} / ${runtimeConfig.approvalMode}`;

  return (
    <PageScaffold>
      {isOverview ? (
        <Suspense fallback={<span>{t("planningBootstrapLoading")}</span>}>
          <Timeline locale={locale} repositories={repositories} t={t} />
        </Suspense>
      ) : isTeamCapacity ? (
        <Suspense fallback={<span>{t("planningBootstrapLoading")}</span>}>
          <TeamCapacityDashboard locale={locale} repositories={repositories} t={t} />
        </Suspense>
      ) : isTeamAdmin ? (
        <Suspense fallback={<span>{t("planningBootstrapLoading")}</span>}>
          <TeamAdminPage t={t} />
        </Suspense>
      ) : isAppAdmin ? (
        <Suspense fallback={<span>{t("planningBootstrapLoading")}</span>}>
          <AppAdminPage t={t} />
        </Suspense>
      ) : isReports ? (
        <Suspense fallback={<span>{t("planningBootstrapLoading")}</span>}>
          <ReportsPage locale={locale} repositories={repositories} t={t} />
        </Suspense>
      ) : isApprovals ? (
        <Suspense fallback={<span>{t("planningBootstrapLoading")}</span>}>
          <ApprovalsPrototypePage
            repositories={repositories}
            t={t}
            isMockMode={isMockMode}
          />
        </Suspense>
      ) : isMyApprovals ? (
        <Suspense fallback={<span>{t("planningBootstrapLoading")}</span>}>
          <MyApprovalsPage t={t} />
        </Suspense>
      ) : isSettings ? (
        <Suspense fallback={<span>{t("planningBootstrapLoading")}</span>}>
          <MySettingsPage t={t} />
        </Suspense>
      ) : isInfo ? (
        <section className={infoStyles.infoPage} aria-labelledby="info-page-title">
          <div className={infoStyles.hero}>
            <div className={infoStyles.heroContent}>
              <span className={infoStyles.kicker}>{t("infoPageBadge")}</span>
              <h3 className={infoStyles.heroTitle} id="info-page-title">
                {t("infoPageTitle")}
              </h3>
              <p className={infoStyles.heroDescription}>{t("infoPageDescription")}</p>
              <div className={infoStyles.heroActions}>
                <Button appearance="primary" icon={<ArrowRightRegular />} onClick={() => window.location.hash = "/overview"}>
                  {t("infoPageGoToTimeline")}
                </Button>
                <Button appearance="secondary" icon={<ToggleMultipleRegular />} onClick={() => window.location.hash = "/reports"}>
                  {t("infoPageGoToReports")}
                </Button>
              </div>
            </div>
            <div className={infoStyles.heroPanel}>
              <div className={infoStyles.heroStat}>
                <span>{t("infoPageStatTeamsLabel")}</span>
                <strong>{t("infoPageStatTeamsValue")}</strong>
              </div>
              <div className={infoStyles.heroStat}>
                <span>{t("infoPageStatModeLabel")}</span>
                <strong>{isMockMode ? t("infoPageStatModeMock") : t("infoPageStatModeApi")}</strong>
              </div>
              <div className={infoStyles.heroStat}>
                <span>{t("infoPageStatDeploymentLabel")}</span>
                <strong>{t("infoPageStatDeploymentValue")}</strong>
              </div>
            </div>
          </div>

          <div className={pageScaffoldStyles.cardGrid}>
            <DesignCard
              icon={<GlobeRegular />}
              title={t("infoCardWhatIsRppTitle")}
              description={t("infoCardWhatIsRppDescription")}
              status={t("infoCardWhatIsRppStatus")}
              statusTone="foundation"
            />
            <DesignCard
              icon={<LayoutRowThreeRegular />}
              title={t("infoCardValueTitle")}
              description={t("infoCardValueDescription")}
              status={t("infoCardValueStatus")}
              statusTone="ready"
            />
            <DesignCard
              icon={<RocketRegular />}
              title={t("infoCardGetItTitle")}
              description={t("infoCardGetItDescription")}
              status={t("infoCardGetItStatus")}
              statusTone="reserved"
            />
          </div>

          <div className={pageScaffoldStyles.cardGrid}>
            <DesignCard
              icon={<PeopleRegular />}
              title={t("infoCardPeopleTitle")}
              description={t("infoCardPeopleDescription")}
              status={t("infoCardPeopleStatus")}
              statusTone="ready"
            />
            <DesignCard
              icon={<DatabaseRegular />}
              title={t("infoCardDataTitle")}
              description={t("infoCardDataDescription")}
              status={t("infoCardDataStatus")}
              statusTone="foundation"
            />
            <DesignCard
              icon={<RocketRegular />}
              title={t("infoCardDeliveryTitle")}
              description={t("infoCardDeliveryDescription")}
              status={t("infoCardDeliveryStatus")}
              statusTone="ready"
            />
          </div>

          <div className={infoStyles.factSheet}>
            <div className={infoStyles.factSheetHeader}>
              <div>
                <h4 className={infoStyles.factSheetTitle}>{t("infoFactsTitle")}</h4>
                <p className={infoStyles.factSheetDescription}>{t("infoFactsDescription")}</p>
              </div>
            </div>
            <div className={infoStyles.factGrid}>
              <article className={infoStyles.factItem}>
                <span className={infoStyles.factLabel}>{t("infoFactArchitectureLabel")}</span>
                <strong className={infoStyles.factValue}>{t("infoFactArchitectureValue")}</strong>
                <p>{t("infoFactArchitectureText")}</p>
              </article>
              <article className={infoStyles.factItem}>
                <span className={infoStyles.factLabel}>{t("infoFactRolesLabel")}</span>
                <strong className={infoStyles.factValue}>{t("infoFactRolesValue")}</strong>
                <p>{t("infoFactRolesText")}</p>
              </article>
              <article className={infoStyles.factItem}>
                <span className={infoStyles.factLabel}>{t("infoFactLocalizationLabel")}</span>
                <strong className={infoStyles.factValue}>{t("infoFactLocalizationValue")}</strong>
                <p>{t("infoFactLocalizationText")}</p>
              </article>
              <article className={infoStyles.factItem}>
                <span className={infoStyles.factLabel}>{t("infoFactTeamsLabel")}</span>
                <strong className={infoStyles.factValue}>{t("infoFactTeamsValue")}</strong>
                <p>{t("infoFactTeamsText")}</p>
              </article>
            </div>
          </div>

          <div className={infoStyles.runtimeCard}>
            <div className={infoStyles.runtimeHeader}>
              <h4 className={infoStyles.runtimeTitle}>{t("infoRuntimeCardTitle")}</h4>
              <p className={infoStyles.runtimeDescription}>{t("infoRuntimeCardDescription")}</p>
            </div>

            <div className={infoStyles.runtimeGrid}>
              <article className={infoStyles.runtimePanel}>
                <h5>{t("infoRuntimeFrontendTitle")}</h5>
                <div className={infoStyles.runtimeRows}>
                  <div className={infoStyles.runtimeRow}><span>{t("infoRuntimeLabelEffectiveProvider")}</span><strong>{providerSummary}</strong></div>
                  <div className={infoStyles.runtimeRow}><span>{t("infoRuntimeLabelEnvironment")}</span><strong>{getDisplayValue(runtimeConfig.environmentName)}</strong></div>
                  <div className={infoStyles.runtimeRow}><span>{t("infoRuntimeLabelApiBaseUrl")}</span><strong>{getDisplayValue(runtimeConfig.apiBaseUrl)}</strong></div>
                  <div className={infoStyles.runtimeRow}><span>{t("infoRuntimeLabelSharePointSiteUrl")}</span><strong>{getDisplayValue(runtimeConfig.sharePointSiteUrl)}</strong></div>
                  <div className={infoStyles.runtimeRow}><span>{t("infoRuntimeLabelHealthEndpoint")}</span><strong>{getDisplayValue(backendHealthUrl)}</strong></div>
                  <div className={infoStyles.runtimeRow}><span>{t("infoRuntimeLabelFrontendRelease")}</span><strong>{getDisplayValue(runtimeConfig.releaseVersion)}</strong></div>
                  <div className={infoStyles.runtimeRow}><span>{t("infoRuntimeLabelFrontendRevision")}</span><strong>{getDisplayValue(runtimeConfig.sourceRevision)}</strong></div>
                  <div className={infoStyles.runtimeRow}><span>{t("infoRuntimeLabelFrontendBuild")}</span><strong>{formatTimestamp(frontendRelease?.builtAt)}</strong></div>
                </div>
              </article>

              <article className={infoStyles.runtimePanel}>
                <h5>{t("infoRuntimeBackendTitle")}</h5>
                {isBackendHealthLoading ? <p className={infoStyles.runtimeMuted}>{t("infoRuntimeLoading")}</p> : null}
                <div className={infoStyles.runtimeRows}>
                  <div className={infoStyles.runtimeRow}><span>{t("infoRuntimeLabelBackendStatus")}</span><strong>{getDisplayValue(backendHealth?.status)}</strong></div>
                  <div className={infoStyles.runtimeRow}><span>{t("infoRuntimeLabelBackendVersion")}</span><strong>{getDisplayValue(backendHealth?.version)}</strong></div>
                  <div className={infoStyles.runtimeRow}><span>{t("infoRuntimeLabelBackendRevision")}</span><strong>{getDisplayValue(backendHealth?.sourceRevision)}</strong></div>
                  <div className={infoStyles.runtimeRow}><span>{t("infoRuntimeLabelBackendBuild")}</span><strong>{formatTimestamp(backendHealth?.buildTimestamp)}</strong></div>
                  <div className={infoStyles.runtimeRow}><span>{t("infoRuntimeLabelBackendEnvironment")}</span><strong>{getDisplayValue(backendHealth?.environment)}</strong></div>
                  <div className={infoStyles.runtimeRow}><span>{t("infoRuntimeLabelBackendProvider")}</span><strong>{getDisplayValue(backendHealth?.backendProvider)}</strong></div>
                  <div className={infoStyles.runtimeRow}><span>{t("infoRuntimeLabelBackendDatabaseServer")}</span><strong>{getDisplayValue(backendHealth?.databaseServerName)}</strong></div>
                  <div className={infoStyles.runtimeRow}><span>{t("infoRuntimeLabelBackendDatabaseName")}</span><strong>{getDisplayValue(backendHealth?.databaseName)}</strong></div>
                  <div className={infoStyles.runtimeRow}><span>{t("infoRuntimeLabelBackendWebServer")}</span><strong>{getDisplayValue(backendHealth?.webServerName)}</strong></div>
                </div>
              </article>
            </div>
          </div>

          <div className={infoStyles.demoDataCard}>
            <div className={infoStyles.runtimeHeader}>
              <h4 className={infoStyles.runtimeTitle}>{t("demoDataSectionTitle")}</h4>
              <p className={infoStyles.runtimeDescription}>
                {t("demoDataSectionDescription")}
                {hasPersistedMockState() ? ` ${t("demoDataChangesPresent")}` : ""}
              </p>
            </div>
            <div className={infoStyles.actionRow}>
              <Button
                appearance="secondary"
                onClick={() => {
                  clearPersistedMockState();
                  window.location.reload();
                }}
              >
                {t("demoDataResetButton")}
              </Button>
              <Button appearance="secondary" onClick={handleExportJson}>
                {t("demoDataExportButton")}
              </Button>
              <Button appearance="primary" onClick={handleOpenImportDialog}>
                {t("demoDataImportButton")}
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                accept="application/json"
                style={{ display: "none" }}
                onChange={handleImportJson}
              />
            </div>
            {importError ? <p className={infoStyles.runtimeMuted}>{importError}</p> : null}
          </div>
        </section>
      ) : (
        <div className={pageScaffoldStyles.placeholderSurface}>
          <span className={pageScaffoldStyles.placeholderTitle}>
            <PanelRightContractRegular /> {t("placeholderSurfaceTitle")}
          </span>
          <p className={pageScaffoldStyles.placeholderText}>{t("placeholderSurfaceText")}</p>
        </div>
      )}
    </PageScaffold>
  );
}
