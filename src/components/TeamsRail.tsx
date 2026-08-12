import {
  AppsRegular,
  CalendarLtrRegular,
  ChatRegular,
  DocumentRegular,
  PeopleTeamRegular,
  PersonCallRegular,
  PresenceAvailableRegular,
  ShieldTaskRegular
} from "@fluentui/react-icons";
import type { TranslationKey } from "../localization/translations";

interface TeamsRailProps {
  readonly t: (key: TranslationKey) => string;
}

const railItems = [
  { key: "activity", labelKey: "teamsRailActivity", icon: <PresenceAvailableRegular />, active: false },
  { key: "chat", labelKey: "teamsRailChat", icon: <ChatRegular />, active: false },
  { key: "teams", labelKey: "teamsRailTeams", icon: <PeopleTeamRegular />, active: false },
  { key: "calendar", labelKey: "teamsRailCalendar", icon: <CalendarLtrRegular />, active: false },
  { key: "calls", labelKey: "teamsRailCalls", icon: <PersonCallRegular />, active: false },
  { key: "files", labelKey: "teamsRailFiles", icon: <DocumentRegular />, active: false },
  { key: "resources", labelKey: "teamsRailResources", icon: <PeopleTeamRegular />, active: true },
  { key: "approvals", labelKey: "teamsRailApprovals", icon: <ShieldTaskRegular />, active: false },
  { key: "apps", labelKey: "teamsRailApps", icon: <AppsRegular />, active: false }
] as const satisfies readonly {
  readonly key: string;
  readonly labelKey: TranslationKey;
  readonly icon: JSX.Element;
  readonly active?: boolean;
}[];

export function TeamsRail({ t }: TeamsRailProps) {
  return (
    <aside className="teamsRail" aria-label={t("teamsRailLabel")}>
      {railItems.map((item) => (
        <button
          aria-current={item.active ? "page" : undefined}
          className={`teamsRailItem ${item.active ? "teamsRailItemActive" : ""}`}
          key={item.key}
          title={t(item.labelKey)}
          type="button"
        >
          {item.icon}
          <span>{t(item.labelKey)}</span>
        </button>
      ))}
    </aside>
  );
}
