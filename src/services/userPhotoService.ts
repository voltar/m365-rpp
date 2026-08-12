import { getApiAuthorizationHeader } from "../features/team-admin/services/teamAdminApi";
import { getRuntimeConfiguration } from "../infrastructure/deployment/runtimeConfig";
import { resilientFetch } from "../infrastructure/http/resilientFetch";

// EO-421: profile photos for the timeline avatars, served by the RPP Web API photo
// proxy. Results are cached per user as object URLs for the session; a missing
// photo resolves to undefined and the avatar keeps its initials. Mock/demo mode
// never shows photos.

const photoUrlByUserId = new Map<string, Promise<string | undefined>>();

export function getUserPhotoObjectUrl(resourceId: string): Promise<string | undefined> {
  const { apiBaseUrl, planningDataSource } = getRuntimeConfiguration();

  if (planningDataSource !== "api" || !apiBaseUrl) {
    return Promise.resolve(undefined);
  }

  const userId = resourceId.replace("resource-", "");
  const cached = photoUrlByUserId.get(userId);

  if (cached) {
    return cached;
  }

  const request = loadPhoto(apiBaseUrl, userId);
  photoUrlByUserId.set(userId, request);

  return request;
}

async function loadPhoto(apiBaseUrl: string, userId: string): Promise<string | undefined> {
  try {
    const response = await resilientFetch(`${apiBaseUrl}/api/planning/photos/${encodeURIComponent(userId)}`, {
      credentials: "include",
      headers: await getApiAuthorizationHeader()
    }, {
      component: "userPhotoService",
      operation: "loadPhoto"
    });

    if (!response.ok) {
      return undefined;
    }

    return URL.createObjectURL(await response.blob());
  } catch {
    return undefined;
  }
}
