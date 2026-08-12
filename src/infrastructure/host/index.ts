export type {
  DeepLinkTargetKind,
  HostAdapter,
  HostChrome,
  HostContext,
  HostDeepLink,
  HostKind,
  HostThemeMode,
  SharePointHostBootstrap
} from "./types";
export { detectHostKind, isTopLevelBrowsingContext } from "./detectHostKind";
export {
  parseDeepLinkFromLocation,
  parseDeepLinkFromSubPageId,
  vacationRequestIdFromDeepLink,
  vacationRequestIdPrefix
} from "./deepLinkParse";
export { getResolvedHostKind, resetHostAdapterForTests, resolveHostAdapter } from "./resolveHost";
