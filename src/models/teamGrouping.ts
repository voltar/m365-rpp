import type { ResourceSummary } from "./resource";

export interface TeamResourceGroup {
  readonly id: string;
  readonly teamName: string;
  readonly resources: readonly ResourceSummary[];
}
