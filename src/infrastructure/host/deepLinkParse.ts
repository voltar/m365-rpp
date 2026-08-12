import type { HostDeepLink } from "./types";

/** Matches EO-421 request ids and the historical subEntityId prefix check. */
export const vacationRequestIdPrefix = "vacation-request-";

/**
 * Parses a host-neutral deep link from a Teams subPageId/subEntityId or from
 * browser/SharePoint hash query parameters.
 */
export function parseDeepLinkFromSubPageId(subPageId: string | undefined): HostDeepLink | undefined {
  if (!subPageId || subPageId.trim().length === 0) {
    return undefined;
  }

  const value = subPageId.trim();

  if (value.startsWith(vacationRequestIdPrefix)) {
    return { kind: "vacation-request", id: value, raw: value };
  }

  if (value.startsWith("absence-") || value.startsWith("absence:")) {
    const id = value.includes(":") ? value.slice(value.indexOf(":") + 1) : value;
    return { kind: "absence", id, raw: value };
  }

  if (value.startsWith("route:") || value.startsWith("/")) {
    const path = value.startsWith("route:") ? value.slice("route:".length) : value;
    return { kind: "route", path, raw: value };
  }

  if (value.startsWith("help:") || value.startsWith("help?")) {
    return { kind: "help", id: value.replace(/^help:|^help\?/, ""), raw: value };
  }

  return undefined;
}

export function parseDeepLinkFromLocation(hash: string, search: string): HostDeepLink | undefined {
  const hashBody = hash.startsWith("#") ? hash.slice(1) : hash;
  const [pathPart, hashQuery = ""] = hashBody.split("?");
  const params = new URLSearchParams(hashQuery);

  // Also accept top-level query (iframe embed URLs).
  const topParams = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const read = (key: string): string | undefined => params.get(key) ?? topParams.get(key) ?? undefined;

  const dl = read("dl") ?? read("deepLink");
  const id = read("id") ?? read("vr") ?? read("requestId");
  const path = read("path") ?? (pathPart.startsWith("/") ? pathPart : undefined);

  if (dl === "vacation-request" || dl === "vacationRequest") {
    if (id) {
      return { kind: "vacation-request", id, raw: id, path: path || "/overview" };
    }
  }

  if (dl === "absence" && id) {
    return { kind: "absence", id, raw: id, path: path || "/overview" };
  }

  if (dl === "route" && path) {
    return { kind: "route", path, raw: path };
  }

  if (dl === "help") {
    return { kind: "help", id: id ?? read("topic"), path };
  }

  // Bare vacation-request id in query (Outlook-style without dl=).
  if (id?.startsWith(vacationRequestIdPrefix)) {
    return { kind: "vacation-request", id, raw: id, path: path || "/overview" };
  }

  return parseDeepLinkFromSubPageId(id);
}

export function vacationRequestIdFromDeepLink(deepLink: HostDeepLink | undefined): string | undefined {
  if (!deepLink || deepLink.kind !== "vacation-request") {
    return undefined;
  }

  return deepLink.id ?? deepLink.raw;
}
