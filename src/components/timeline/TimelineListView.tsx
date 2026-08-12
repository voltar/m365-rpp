import type { TranslationKey } from "../../localization/translations";
import type { PlanningEvent } from "../../models/planningEvent";
import type { ResourceSummary } from "../../models/resource";
import type { TeamResourceGroup } from "../../models/teamGrouping";
import type { EventColorMode } from "../../features/team-admin/services/teamAdminApi";
import type { TeamColorStyle } from "../../styles/teamColorPalette";
import styles from "./Timeline.module.css";

interface TimelineListViewProps {
  readonly events: readonly PlanningEvent[];
  readonly groups: readonly TeamResourceGroup[];
  readonly eventColorMode: EventColorMode;
  readonly teamColorByResourceId: ReadonlyMap<string, TeamColorStyle>;
  readonly onOpenEvent: (event: PlanningEvent) => void;
  readonly onOpenResource: (resource: ResourceSummary, targetRect?: DOMRect) => void;
  readonly t: (key: TranslationKey) => string;
}

export function TimelineListView({ events, groups, eventColorMode, teamColorByResourceId, onOpenEvent, onOpenResource, t }: TimelineListViewProps) {
  const eventsByResourceId = new Map<string, PlanningEvent[]>();

  events.forEach((event) => {
    const resourceEvents = eventsByResourceId.get(event.resourceId) ?? [];
    resourceEvents.push(event);
    eventsByResourceId.set(event.resourceId, resourceEvents);
  });

  return (
    <div className={styles.listView}>
      {groups.map((group) => (
        <section className={styles.listGroup} key={group.id} aria-label={group.teamName}>
          <header className={styles.listGroupHeader}>
            <span>{group.teamName}</span>
            <small>{group.resources.length} {t("teamGroupingResourceCountCompact")}</small>
          </header>
          <div className={styles.listRows}>
            {group.resources.map((resource) => {
              const resourceEvents = (eventsByResourceId.get(resource.id) ?? [])
                .slice()
                .sort((first, second) => first.startDate.localeCompare(second.startDate));

              return (
                <article className={styles.listRow} key={resource.id}>
                  <button
                    className={styles.listIdentity}
                    type="button"
                    onClick={(event) => onOpenResource(resource, event.currentTarget.getBoundingClientRect())}
                  >
                    <strong>{resource.displayName}</strong>
                    <span>{resource.primaryTeam} · {resource.organization}</span>
                  </button>
                  <div className={styles.listVacation}>
                    <span>{resource.vacation.booked} / {resource.vacation.annualEntitlement}</span>
                    <strong>{resource.vacation.remaining}</strong>
                  </div>
                  <div className={styles.listEvents}>
                    {resourceEvents.length > 0 ? (
                      resourceEvents.slice(0, 3).map((event) => {
                        const teamColor = eventColorMode === "byTeam" ? teamColorByResourceId.get(event.resourceId) : undefined;
                        const colorStyle = teamColor
                          ? { background: teamColor.background, borderColor: teamColor.border, color: teamColor.text }
                          : undefined;

                        return (
                          <button className={styles.listEvent} key={event.id} type="button" onClick={() => onOpenEvent(event)} style={colorStyle}>
                            <span>{event.title}</span>
                            <small>{event.startDate} - {event.endDate}</small>
                          </button>
                        );
                      })
                    ) : (
                      <span className={styles.listEmpty}>{t("teamCapacityNoAffectedResources")}</span>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
