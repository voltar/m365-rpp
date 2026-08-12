import { getRuntimeConfiguration } from "../../../infrastructure/deployment/runtimeConfig";
import { getApiAuthorizationHeader } from "./teamAdminApi";
import { resilientFetch } from "../../../infrastructure/http/resilientFetch";

/**
 * EO-428 FR-428.2: the Microsoft 365 teams the signed-in user belongs to, used to answer "which
 * team do you mean" in the personal app scope. Read from the API rather than from Microsoft Graph
 * in the browser, per the layering rule.
 */
export interface UserTeam {
  readonly teamId: string;
  readonly teamName: string;
  readonly isPrimary: boolean;
}

export type MyTeamsResult =
  | { readonly ok: true; readonly teams: readonly UserTeam[] }
  // "We could not ask" is kept apart from "you are in no teams": only the first is worth retrying,
  // and only the second means the user has to be added to a team by someone else.
  | { readonly ok: false };

export async function getMyTeams(): Promise<MyTeamsResult> {
  const { apiBaseUrl, planningDataSource } = getRuntimeConfiguration();

  if (planningDataSource !== "api" || !apiBaseUrl) {
    return { ok: true, teams: [] };
  }

  try {
    const response = await resilientFetch(`${apiBaseUrl}/api/planning/my-teams`, {
      credentials: "include",
      headers: {
        Accept: "application/json",
        ...(await getApiAuthorizationHeader())
      }
    }, {
      component: "myTeamsApi",
      operation: "getMyTeams"
    });

    if (!response.ok) {
      return { ok: false };
    }

    const payload = await response.json() as { items?: readonly UserTeam[] };

    return { ok: true, teams: payload.items ?? [] };
  } catch {
    return { ok: false };
  }
}
