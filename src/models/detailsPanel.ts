import type { Absence, AbsenceDraft } from "./absence";
import type { PlanningEvent } from "./planningEvent";
import type { ResourceSummary } from "./resource";

export type DetailsPanelState =
  | { readonly kind: "resource"; readonly resource: ResourceSummary }
  | { readonly kind: "event"; readonly event: PlanningEvent }
  | { readonly kind: "absenceCreate"; readonly resource: ResourceSummary; readonly date: string }
  | { readonly kind: "absenceEdit"; readonly absence: Absence; readonly resource: ResourceSummary }
  | { readonly kind: "closed" };

export type AbsencePanelSubmit = (draft: AbsenceDraft) => void;
