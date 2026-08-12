import type { Logger } from "../../core/logging";
import { resolveHostAdapter } from "../host";
import { readActiveTeamSelection } from "./activeTeamSelection";

/**
 * EO-410 / EO-455: resolves the signed-in user's Microsoft Entra object id from the
 * host adapter context. Returns undefined when the host has no user identity.
 */
export function resolveCurrentUserId(logger?: Logger): Promise<string | undefined> {
  return resolveHostAdapter(logger)
    .then((host) => host.getContext())
    .then((context) => {
      const userId = context?.userId;
      return userId && userId !== "current-user" ? userId : undefined;
    })
    .catch(() => undefined);
}

/**
 * EO-418 / EO-455: resolves the active Team's display name from the host for the
 * header badge. Undefined outside a team-scoped host or in personal scope.
 */
export function resolveActiveTeamName(logger?: Logger): Promise<string | undefined> {
  return resolveHostAdapter(logger)
    .then((host) => host.getContext())
    .then((context) => {
      const teamName = context?.teamName;
      return teamName && teamName.trim().length > 0 ? teamName : undefined;
    })
    .catch(() => undefined);
}

/**
 * EO-418 / EO-428 / EO-455: resolves the active Team context id from the host.
 *
 * When the host provides none — personal app scope, plain browser, SharePoint without
 * an explicit team property — the user's own stored choice applies. There is deliberately
 * no third step: without a host context and without a choice the answer is "unresolved".
 */
export function resolveActiveTeamId(logger?: Logger): Promise<string | undefined> {
  return resolveHostAdapter(logger)
    .then(async (host) => {
      const context = await host.getContext();
      const hostTeamId = context?.teamId;

      if (hostTeamId && hostTeamId.trim().length > 0) {
        return hostTeamId;
      }

      const userId = context?.userId;
      return readActiveTeamSelection(userId === "current-user" ? undefined : userId, logger)?.teamId;
    })
    .catch(() => readActiveTeamSelection(undefined, logger)?.teamId);
}
