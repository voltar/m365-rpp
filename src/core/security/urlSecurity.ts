export interface UrlValidationResult {
  readonly ok: boolean;
  readonly value?: string;
  readonly reason?: string;
}

export function createTrustedServiceUrl(
  pathOrUrl: string,
  baseUrl: string,
  allowedOrigins: readonly string[]
): UrlValidationResult {
  const trimmedValue = pathOrUrl.trim();
  const trimmedBaseUrl = baseUrl.trim().replace(/\/$/, "");

  if (!trimmedValue || !trimmedBaseUrl) {
    return { ok: false, reason: "empty-url" };
  }

  if (trimmedValue.startsWith("//")) {
    return { ok: false, reason: "protocol-relative-url" };
  }

  let url: URL;

  try {
    url = trimmedValue.startsWith("http://") || trimmedValue.startsWith("https://")
      ? new URL(trimmedValue)
      : new URL(trimmedValue.startsWith("/") ? trimmedValue : `/${trimmedValue}`, trimmedBaseUrl);
  } catch {
    return { ok: false, reason: "invalid-url" };
  }

  if (url.protocol !== "https:") {
    return { ok: false, reason: "insecure-protocol" };
  }

  if (!allowedOrigins.includes(url.origin)) {
    return { ok: false, reason: "untrusted-origin" };
  }

  return { ok: true, value: url.toString() };
}

export function isTrustedHttpsUrl(url: string, allowedOrigins: readonly string[]): boolean {
  try {
    const parsedUrl = new URL(url.trim());

    return parsedUrl.protocol === "https:" && allowedOrigins.includes(parsedUrl.origin);
  } catch {
    return false;
  }
}
