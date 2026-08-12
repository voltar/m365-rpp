import { AppShell } from "../../components/AppShell";

/**
 * Thin SharePoint / SPFx mount over the single SPA artefact (ADR-004 / EO-455).
 * Embedders should set `window.__RPP_HOST__ = "sharepoint"` and optionally
 * `window.__RPP_HOST_CONTEXT__` (user, locale, auth bridge, teamId) before mount.
 */
export function ResourcePresencePlannerWebPart() {
  if (typeof window !== "undefined" && window.__RPP_HOST__ === undefined) {
    window.__RPP_HOST__ = "sharepoint";
  }

  return <AppShell />;
}
