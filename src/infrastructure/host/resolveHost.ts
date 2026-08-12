import type { Logger } from "../../core/logging";
import { detectHostKind } from "./detectHostKind";
import { createBrowserHostAdapter } from "./browserHostAdapter";
import { createSharePointHostAdapter } from "./sharePointHostAdapter";
import type { HostAdapter, HostKind } from "./types";

let adapterPromise: Promise<HostAdapter> | undefined;
let resolvedKind: HostKind | undefined;

/**
 * Resolves the session HostAdapter once (EO-455 FR-455.1).
 * Teams / SharePoint modules load only for the detected kind.
 */
export function resolveHostAdapter(logger?: Logger): Promise<HostAdapter> {
  adapterPromise ??= createHostAdapter(logger);
  return adapterPromise;
}

export function getResolvedHostKind(): HostKind | undefined {
  return resolvedKind;
}

/** Test / hot-reload escape hatch. */
export function resetHostAdapterForTests(): void {
  adapterPromise = undefined;
  resolvedKind = undefined;
}

async function createHostAdapter(logger?: Logger): Promise<HostAdapter> {
  const kind = detectHostKind();
  resolvedKind = kind;

  logger?.info("Host adapter resolved.", {
    source: "infrastructure",
    component: "resolveHostAdapter",
    operation: "createHostAdapter",
    details: { kind }
  });

  if (kind === "teams") {
    const { createTeamsHostAdapter } = await import("./teamsHostAdapter");
    return createTeamsHostAdapter(logger);
  }

  if (kind === "sharepoint") {
    return createSharePointHostAdapter(logger);
  }

  return createBrowserHostAdapter(logger);
}
