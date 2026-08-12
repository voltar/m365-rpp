import type { TranslationKey } from "../../localization/translations";
import type { PlanningEvent, PlanningEventType } from "../../models/planningEvent";
import { DetailField } from "./DetailField";
import { DetailSection } from "./DetailSection";

interface PresenceDetailsProps {
  readonly event: PlanningEvent;
  readonly t: (key: TranslationKey) => string;
}

const eventLabelKeyByType: Record<PlanningEventType, TranslationKey> = {
  vacation: "eventTypeVacation",
  compensation: "eventTypeCompensation",
  education: "eventTypeEducation",
  homeOffice: "eventTypeHomeOffice",
  training: "eventTypeTraining",
  military: "eventTypeMilitary",
  unpaidLeave: "eventTypeUnpaidLeave",
  otherAbsence: "eventTypeOtherAbsence",
  project: "eventTypeProject",
  maintenance: "eventTypeMaintenance",
  onCall: "eventTypeOnCall",
  standby: "eventTypeStandby"
};

export function PresenceDetails({ event, t }: PresenceDetailsProps) {
  return (
    <DetailSection title={t("detailsPresenceSection")}>
      <DetailField label={t("detailsEventType")} value={t(eventLabelKeyByType[event.type])} />
      <DetailField label={t("detailsEventTitle")} value={event.title} />
      <DetailField label={t("detailsStartDate")} value={event.startDate} />
      <DetailField label={t("detailsEndDate")} value={event.endDate} />
      <DetailField label={t("detailsDuration")} value={`${getDurationDays(event)} ${t("detailsDays")}`} />
    </DetailSection>
  );
}

function getDurationDays(event: PlanningEvent): number {
  const start = new Date(`${event.startDate}T00:00:00`);
  const end = new Date(`${event.endDate}T00:00:00`);
  return Math.max(1, Math.round((end.getTime() - start.getTime()) / 86400000) + 1);
}
