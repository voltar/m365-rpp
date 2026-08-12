import { createApplicationError, type ApplicationError, type Logger } from "../core/logging";
import type { PlanningRepositories } from "../repositories/planningRepositories";
import {
  AccessDeniedError,
  NoTeamContextError,
  PlanningUnavailableError,
  type PlanningDataSnapshot,
  loadPlanningDataSnapshot
} from "./planningDataService";

interface PlanningBootstrapOptions {
  readonly forceRefresh?: boolean;
}

export type PlanningBootstrapState =
  | { readonly status: "loading" }
  | { readonly status: "ready"; readonly snapshot: PlanningDataSnapshot }
  | { readonly status: "empty"; readonly snapshot: PlanningDataSnapshot }
  // EO-428: no team could be resolved. Deliberately not "empty" and not "error" — the plan is
  // neither empty nor broken, the app simply does not know which team to show yet, and the user
  // can resolve that themselves.
  | { readonly status: "noTeamContext" }
  // EO-428: the API refused the request. Not "empty" — the plan is not empty, it was never read.
  | { readonly status: "accessDenied"; readonly reason: "unauthenticated" | "forbidden" }
  | { readonly status: "error"; readonly error: ApplicationError };

interface PlanningBootstrapCacheEntry {
  readonly promise?: Promise<PlanningDataSnapshot>;
  readonly snapshot?: PlanningDataSnapshot;
}

let planningBootstrapCache = new WeakMap<PlanningRepositories, PlanningBootstrapCacheEntry>();

export function invalidatePlanningBootstrapCache(repositories?: PlanningRepositories): void {
  if (repositories) {
    planningBootstrapCache.delete(repositories);
    return;
  }

  planningBootstrapCache = new WeakMap<PlanningRepositories, PlanningBootstrapCacheEntry>();
}

export async function bootstrapPlanningState(
  repositories: PlanningRepositories,
  logger: Logger,
  component: string,
  options: PlanningBootstrapOptions = {}
): Promise<PlanningBootstrapState> {
  try {
    logger.info("Planning data bootstrap started.", {
      source: "repository",
      component,
      operation: "bootstrapPlanningState",
      details: { forceRefresh: options.forceRefresh === true }
    });

    const snapshot = await loadPlanningSnapshot(repositories, options.forceRefresh === true);
    const status = snapshot.resources.length === 0 ? "empty" : "ready";

    logger.info("Planning data bootstrap completed.", {
      source: "repository",
      component,
      operation: "bootstrapPlanningState",
      details: {
        resources: snapshot.resources.length,
        absences: snapshot.absences.length,
        holidays: snapshot.publicHolidays.length,
        planningEvents: snapshot.planningEvents.length,
        status
      }
    });

    return { status, snapshot };
  } catch (error: unknown) {
    if (error instanceof NoTeamContextError) {
      logger.warn("Planning data bootstrap has no team context - asking the user to choose a team.", {
        source: "repository",
        component,
        operation: "bootstrapPlanningState"
      });

      return { status: "noTeamContext" };
    }

    if (error instanceof AccessDeniedError) {
      logger.warn("Planning data bootstrap was denied by the API.", {
        source: "repository",
        component,
        operation: "bootstrapPlanningState",
        details: { reason: error.reason }
      });

      return { status: "accessDenied", reason: error.reason };
    }

    if (error instanceof PlanningUnavailableError) {
      // A real failure, not a state the user can resolve: it gets the error banner, which carries
      // the correlation id that support needs. Reporting it as "empty" is what hid a Graph outage
      // behind "no plannable people found".
      return {
        status: "error",
        error: createApplicationError({
          severity: "error",
          source: "repository",
          component,
          operation: "bootstrapPlanningState",
          message: error.message,
          innerError: error
        })
      };
    }

    logger.warn("Planning data bootstrap failed - falling back to empty state to prevent UI crash.", {
      source: "repository",
      component,
      operation: "bootstrapPlanningState",
      details: { error: error instanceof Error ? error.message : String(error) }
    });

    // Return empty state instead of error to prevent UI from showing "keine planbare Personen gefunden" crash loop
    return {
      status: "empty",
      snapshot: {
        resources: [],
        absences: [],
        publicHolidays: [],
        planningEvents: []
      }
    };
  }
}

function loadPlanningSnapshot(repositories: PlanningRepositories, forceRefresh: boolean): Promise<PlanningDataSnapshot> {
  const cached = planningBootstrapCache.get(repositories);

  if (!forceRefresh && cached?.snapshot) {
    return Promise.resolve(cached.snapshot);
  }

  if (!forceRefresh && cached?.promise) {
    return cached.promise;
  }

  const promise = loadPlanningDataSnapshot(repositories)
    .then((snapshot) => {
      planningBootstrapCache.set(repositories, { snapshot });
      return snapshot;
    })
    .catch((error: unknown) => {
      planningBootstrapCache.delete(repositories);
      throw error;
    });

  planningBootstrapCache.set(repositories, { promise });

  return promise;
}
