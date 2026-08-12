/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_PLANNING_MEMBERSHIP_SOURCE?: "mock" | "graph";
  readonly VITE_PLANNING_DATA_SOURCE?: "mock" | "sharepoint";
  readonly VITE_APPROVAL_MODE?: "mock" | "m365";
  readonly VITE_APPROVAL_FLOW_URL?: string;
  readonly VITE_SHAREPOINT_SITE_URL?: string;
  readonly VITE_DEPLOYMENT_ENVIRONMENT?: string;
  readonly VITE_HEALTH_CHECK_URL?: string;
  readonly VITE_RELEASE_VERSION?: string;
  readonly VITE_SOURCE_REVISION?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
