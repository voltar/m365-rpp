import type { AbsenceTypeOption } from "../models/absence";
import type { TranslationKey } from "../localization/translations";
import type { TeamAdminAbsenceEntryType } from "../features/team-admin/types/teamSettings";
import { loadPersistedMockState } from "./mockStatePersistence";

export const defaultAbsenceTypes: readonly AbsenceTypeOption[] = [
  { key: "vacation", labelKey: "absenceTypeVacation", eventType: "vacation", consumesVacationBalance: true },
  { key: "compensation", labelKey: "absenceTypeCompensation", eventType: "compensation", consumesVacationBalance: false },
  { key: "education", labelKey: "absenceTypeEducation", eventType: "education", consumesVacationBalance: false },
  { key: "training", labelKey: "absenceTypeTraining", eventType: "training", consumesVacationBalance: false },
  { key: "military", labelKey: "absenceTypeMilitary", eventType: "military", consumesVacationBalance: false },
  { key: "unpaidLeave", labelKey: "absenceTypeUnpaidLeave", eventType: "unpaidLeave", consumesVacationBalance: false },
  { key: "otherAbsence", labelKey: "absenceTypeOther", eventType: "otherAbsence", consumesVacationBalance: false }
];

export const absenceTypes: readonly AbsenceTypeOption[] = defaultAbsenceTypes;

export function getConfiguredAbsenceTypes(): readonly AbsenceTypeOption[] {
  if (typeof window === "undefined") {
    return absenceTypes;
  }

  const configuredTypes = loadPersistedMockState<readonly TeamAdminAbsenceEntryType[]>(
    "teamAdmin.entryTypes",
    []
  );

  if (configuredTypes.length === 0) {
    return absenceTypes;
  }

  return configuredTypes
    .filter((entryType) => entryType.active)
    .map((entryType) => ({
      key: entryType.key,
      label: entryType.label,
      labelKey: entryType.labelKey,
      eventType: resolveEventType(entryType.key),
      consumesVacationBalance: entryType.consumesVacationBalance
    }));
}

export function getAbsenceTypeLabel(option: AbsenceTypeOption, t: (key: TranslationKey) => string): string {
  if (option.labelKey) {
    return t(option.labelKey);
  }

  return option.label ?? option.key;
}

export function getAbsenceTypeLabelByKey(type: string, t: (key: TranslationKey) => string): string {
  const option = getConfiguredAbsenceTypes().find((absenceType) => absenceType.key === type)
    ?? absenceTypes.find((absenceType) => absenceType.key === type);

  return option ? getAbsenceTypeLabel(option, t) : type;
}

function resolveEventType(key: string): AbsenceTypeOption["eventType"] {
  return absenceTypes.find((absenceType) => absenceType.key === key)?.eventType ?? "otherAbsence";
}
