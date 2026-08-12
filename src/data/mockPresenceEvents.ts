import type { PlanningEvent } from "../models/planningEvent";

export const mockPresenceEvents: readonly PlanningEvent[] = [
	{
		id: "presence-project-001",
		resourceId: "resource-alex-mueller",
		type: "project",
		title: "M365 Tenant Consolidation",
		startDate: "2026-07-29",
		endDate: "2026-08-14"
	},
	{
		id: "presence-maintenance-001",
		resourceId: "resource-anne-keller",
		type: "maintenance",
		title: "Teams Governance Maintenance",
		startDate: "2026-08-05",
		endDate: "2026-08-06"
	},
	{
		id: "presence-oncall-001",
		resourceId: "resource-marc-weber",
		type: "onCall",
		title: "Platform On-Call Rotation",
		startDate: "2026-08-10",
		endDate: "2026-08-16"
	},
	{
		id: "presence-standby-001",
		resourceId: "resource-sara-meier",
		type: "standby",
		title: "Emergency Standby Window",
		startDate: "2026-08-19",
		endDate: "2026-08-21"
	}
];
