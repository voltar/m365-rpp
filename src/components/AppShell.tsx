import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import {
  Button,
  FluentProvider,
  MessageBar,
  MessageBarBody,
  MessageBarTitle,
  teamsDarkTheme,
  teamsLightTheme
} from "@fluentui/react-components";
import { QuestionCircleRegular } from "@fluentui/react-icons";
import { ErrorBoundary, useLogger, type Logger } from "../core/logging";
import { createTranslator, loadLocale, type Translator } from "../localization/translations";
import { resolveHostLocale, resolveInitialLocale } from "../localization/localizationService";
import { uiLocaleByLanguage } from "../localization/locales";
import { resolveHostAdapter } from "../infrastructure/host";
import type { AppRoute, Locale, ThemeMode } from "../models/navigation";
import { AppHeader } from "./AppHeader";
import { AppLayout } from "./AppLayout";
import { TeamsRail } from "./TeamsRail";
import { TopNavigation } from "./TopNavigation";
import { PlaceholderPage, preloadRoute } from "../pages/PlaceholderPage";
import { createDefaultPlanningRepositories } from "../repositories/defaultPlanningRepositories";
import {
  tryGetRuntimeConfiguration,
  type ResolvedRuntimeConfiguration
} from "../infrastructure/deployment/runtimeConfig";
import { getAccessInfo, type AccessInfo } from "../features/team-admin/services/teamAdminApi";
import { resolveDeepLinkVacationRequestId } from "../services/vacationRequestDeepLink";

const routeRegistry: readonly AppRoute[] = [
  {
    key: "overview",
    path: "/overview",
    labelKey: "navOverview",
    descriptionKey: "pageOverviewDescription"
  },
  { key: "teamCapacity", path: "/team-capacity", labelKey: "navTeamCapacity", descriptionKey: "pageTeamCapacityDescription" },
  { key: "teamAdmin", path: "/administration/team-admin", labelKey: "navTeamAdmin", descriptionKey: "pageTeamAdminDescription" },
  { key: "appAdmin", path: "/administration/app-admin", labelKey: "navAppAdmin", descriptionKey: "pageAppAdminDescription" },
  { key: "reports", path: "/reports", labelKey: "navReports", descriptionKey: "pageReportsDescription" },
  { key: "approvals", path: "/approvals", labelKey: "navApprovals", descriptionKey: "pageApprovalsDescription" },
  { key: "settings", path: "/settings/my", labelKey: "navSettings", descriptionKey: "pageSettingsDescription" },
  { key: "info", path: "/info", labelKey: "navInfo", descriptionKey: "pageInfoDescription" }
];

const topNavigationRoutes = routeRegistry.filter((route) => route.key !== "settings");

const HelpPanel = lazy(() =>
  import("../features/help/HelpPanel").then((module) => ({ default: module.HelpPanel }))
);

/** Warm the chat bundle on intent, so the drawer opens without a visible delay. */
function preloadHelpPanel(): void {
  void import("../features/help/HelpPanel");
}

export function AppShell() {
  const logger = useLogger();
  const { locale, t } = useAppLocalization(logger);
  const runtimeConfiguration = useMemo(() => tryGetRuntimeConfiguration(logger), [logger]);

  useEffect(() => {
    if (!runtimeConfiguration.ok) {
      logger.error("Runtime configuration is unavailable.", {
        source: "ui",
        component: "AppShell",
        operation: "resolveRuntimeConfiguration",
        details: { code: runtimeConfiguration.error.code }
      });
    }
  }, [logger, runtimeConfiguration]);

  if (!runtimeConfiguration.ok) {
    return (
      <FluentProvider theme={teamsLightTheme}>
        <main className="startupUnavailable">
          <MessageBar intent="error" layout="multiline">
            <MessageBarBody>
              <MessageBarTitle>{t("runtimeConfigUnavailableTitle")}</MessageBarTitle>
              {t("runtimeConfigUnavailableDescription")}
            </MessageBarBody>
          </MessageBar>
          <Button appearance="primary" onClick={() => window.location.reload()}>
            {t("errorRetryAction")}
          </Button>
        </main>
      </FluentProvider>
    );
  }

  return (
    <ConfiguredAppShell
      locale={locale}
      logger={logger}
      runtimeConfiguration={runtimeConfiguration.value}
      t={t}
    />
  );
}

interface ConfiguredAppShellProps {
  readonly locale: Locale;
  readonly logger: Logger;
  readonly runtimeConfiguration: ResolvedRuntimeConfiguration;
  readonly t: Translator;
}

function ConfiguredAppShell({ locale, logger, runtimeConfiguration, t }: ConfiguredAppShellProps) {
  const [themeMode, setThemeMode] = useState<ThemeMode>("light");
  const [activePath, setActivePath] = useState(getCurrentPath());
  // EO-418 (d): admin tabs are hidden for users without the role; deep links still
  // reach the pages, which render a clear "Unberechtigt" card naming the role.
  const [accessInfo, setAccessInfo] = useState<AccessInfo>();
  const repositories = useMemo(
    () => createDefaultPlanningRepositories(logger, runtimeConfiguration),
    [logger, runtimeConfiguration]
  );
  // Demo chrome (header + Teams rail) only outside the real Teams client and only in mock data mode
  // (EO-455 / ADR-004). Inside Teams the host already provides title and identity.
  const [showDemoChrome, setShowDemoChrome] = useState(
    runtimeConfiguration.planningDataSource === "mock"
  );
  const activeRoute = routeRegistry.find((route) => route.path === activePath) ?? routeRegistry[0];
  // EO-450 FR-450.8: the assistant is a drawer, not a route. It opens over the active page,
  // so the page context in FR-450.5 is simply the route the user is looking at.
  const [isHelpOpen, setIsHelpOpen] = useState(false);

  useEffect(() => {
    logger.info("Application shell mounted.", {
      source: "ui",
      component: "AppShell",
      operation: "mount"
    });

    let cancelled = false;
    let disposeTheme: (() => void) | undefined;

    // EO-455: host adapter owns initialize, theme, chrome and deep-link ingress.
    void resolveHostAdapter(logger)
      .then(async (host) => {
        if (cancelled) {
          return;
        }

        await host.initialize();
        host.notifyReady();

        setShowDemoChrome(
          runtimeConfiguration.planningDataSource === "mock" &&
            host.kind !== "teams" &&
            (host.chrome.showAppHeader || host.chrome.showTeamsRail)
        );

        disposeTheme = host.observeTheme((theme) => {
          if (!cancelled) {
            setThemeMode(theme === "dark" || theme === "contrast" ? "dark" : "light");
          }
        });
      })
      .catch((err: unknown) => {
        logger.warn("Host adapter initialization failed.", {
          source: "ui",
          component: "AppShell",
          operation: "resolveHostAdapter",
          details: { error: err }
        });
      });

    const handleHashChange = () => setActivePath(getCurrentPath());
    window.addEventListener("hashchange", handleHashChange);

    // EO-421R: an Outlook event deep link targets the vacation request — open the timeline,
    // which shows the linked absence entry (falls back to "Meine Anträge" when gone).
    resolveDeepLinkVacationRequestId().then((requestId) => {
      if (requestId) {
        window.location.hash = "/overview";
        setActivePath("/overview");
      }
    });

    if (!window.location.hash) {
      window.location.hash = routeRegistry[0].path;
    }

    return () => {
      cancelled = true;
      disposeTheme?.();
      window.removeEventListener("hashchange", handleHashChange);
    };
  }, [logger, runtimeConfiguration.planningDataSource]);

  useEffect(() => {
    getAccessInfo().then(setAccessInfo);
  }, []);

  const visibleRoutes = useMemo(
    () =>
      topNavigationRoutes.filter((route) => {
        if (route.key === "teamAdmin") {
          // EO-428 FR-428.4: guests never administer teams. The server enforces it either way; the
          // tab is left out so a guest is not offered a workspace that would only refuse them.
          return (accessInfo?.isTeamOwner ?? false) && !(accessInfo?.isGuest ?? false);
        }

        if (route.key === "appAdmin") {
          return accessInfo?.isAppAdmin ?? false;
        }

        return true;
      }),
    [accessInfo]
  );

  const navigateTo = (path: string) => {
    logger.info("Workspace navigation changed.", {
      source: "ui",
      component: "TopNavigation",
      operation: "navigate",
      details: { path }
    });

    window.location.hash = path;
    setActivePath(path);
  };

  return (
    <FluentProvider theme={themeMode === "dark" ? teamsDarkTheme : teamsLightTheme}>
      <ErrorBoundary component="AppShell" logger={logger} t={t}>
        <AppLayout
          themeMode={themeMode}
          header={showDemoChrome ? <AppHeader t={t} /> : undefined}
          rail={showDemoChrome ? <TeamsRail t={t} /> : undefined}
          navigation={
            <div className="navigationRow">
              <TopNavigation
                routes={visibleRoutes}
                activeRouteKey={activeRoute.key}
                onNavigate={navigateTo}
                onPreload={preloadRoute}
                t={t}
              />
              {/* EO-450 FR-450.8: standing help affordance, trailing the workspace tabs. */}
              <Button
                appearance="subtle"
                aria-label={t("helpOpenLabel")}
                className="helpTrigger"
                icon={<QuestionCircleRegular />}
                onClick={() => setIsHelpOpen(true)}
                onMouseEnter={preloadHelpPanel}
                onFocus={preloadHelpPanel}
                title={t("helpOpenLabel")}
              />
            </div>
          }
          footer={<span>{t("footerText")}</span>}
        >
          <PlaceholderPage
            locale={uiLocaleByLanguage[locale]}
            repositories={repositories}
            route={activeRoute}
            t={t}
          />
          {/* Mounted only once opened, so the chat bundle stays out of the initial load. */}
          {isHelpOpen ? (
            <Suspense fallback={null}>
              <HelpPanel
                open={isHelpOpen}
                currentPage={activeRoute.key}
                language={uiLocaleByLanguage[locale]}
                onClose={() => setIsHelpOpen(false)}
                onNavigate={(routeKey) => {
                  const target = routeRegistry.find((route) => route.key === routeKey);

                  if (target) {
                    navigateTo(target.path);
                  }
                }}
                userRole={accessInfo?.isAppAdmin ? "appAdmin" : accessInfo?.isTeamOwner ? "teamLead" : "employee"}
                t={t}
              />
            </Suspense>
          ) : null}
        </AppLayout>
      </ErrorBoundary>
    </FluentProvider>
  );
}

function useAppLocalization(logger: Logger): { readonly locale: Locale; readonly t: Translator } {
  const [locale, setLocale] = useState<Locale>(() => resolveInitialLocale(logger));
  const [localeRevision, setLocaleRevision] = useState(0);
  const t = useMemo(() => createTranslator(locale, logger), [locale, localeRevision, logger]);

  useEffect(() => {
    void resolveHostLocale(logger).then(setLocale);
  }, [logger]);

  useEffect(() => {
    // Keep <html lang> in sync so API clients (e.g. approval start) can send Accept-Language
    // matching the Teams UI language rather than the browser install language alone.
    document.documentElement.lang = locale;

    let isCurrent = true;

    void loadLocale(locale, logger).then(() => {
      if (isCurrent) {
        setLocaleRevision((revision) => revision + 1);
      }
    });

    return () => {
      isCurrent = false;
    };
  }, [locale, logger]);

  return { locale, t };
}

function getCurrentPath(): string {
  return window.location.hash.replace(/^#/, "") || "/overview";
}
