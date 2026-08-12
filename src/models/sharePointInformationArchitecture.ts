export type SharePointPlanningListKey =
  | "absences"
  | "vacationBalances"
  | "planningSettings"
  | "publicHolidays"
  | "teamPlanningConfiguration"
  | "planningEvents"
  | "vacationRequests";

export type SharePointFieldType =
  | "boolean"
  | "choice"
  | "date"
  | "dateTime"
  | "number"
  | "text"
  | "user";

export type SharePointFieldSource = "sharePoint" | "graphReference" | "computed";

export interface SharePointPlanningField {
  readonly name: string;
  readonly type: SharePointFieldType;
  readonly required: boolean;
  readonly source: SharePointFieldSource;
  readonly description: string;
}

export interface SharePointUniqueKeyDefinition {
  readonly fields: readonly string[];
  readonly description: string;
}

export interface SharePointIndexDefinition {
  readonly fields: readonly string[];
  readonly description: string;
}

export interface SharePointReferenceDefinition {
  readonly field: string;
  readonly target: "graphUserId" | "teamsGroupId";
  readonly description: string;
}

export interface SharePointTechnicalDefinition {
  readonly uniqueKeys: readonly SharePointUniqueKeyDefinition[];
  readonly indexes: readonly SharePointIndexDefinition[];
  readonly searchableFields: readonly string[];
  readonly references: readonly SharePointReferenceDefinition[];
}

export interface SharePointPlanningListDefinition {
  readonly key: SharePointPlanningListKey;
  readonly name: string;
  readonly purpose: string;
  readonly fields: readonly SharePointPlanningField[];
  readonly technical: SharePointTechnicalDefinition;
}

export const sharePointPlanningLists = [
  {
    key: "absences",
    name: "Absences",
    purpose: "Stores absence facts for plannable Microsoft Teams members.",
    fields: [
      field("Id", "text", true, "sharePoint", "SharePoint item identifier."),
      field("UserPerson", "user", true, "graphReference", "Absent employee. Person column; the provider resolves it to a Graph user id (EO-430)."),
      field("Type", "text", true, "sharePoint", "Configured absence type."),
      field("StartDate", "date", true, "sharePoint", "First absence date."),
      field("StartHalf", "choice", true, "sharePoint", "Morning, afternoon, or full-day start boundary."),
      field("EndDate", "date", true, "sharePoint", "Last absence date."),
      field("EndHalf", "choice", true, "sharePoint", "Morning, afternoon, or full-day end boundary."),
      field("Duration", "number", false, "computed", "Persisted working-day duration used by the EF model."),
      field("Comment", "text", false, "sharePoint", "Optional planning note."),
      field("SubstitutePerson", "user", false, "graphReference", "Optional substitute during the absence."),
      field("Status", "choice", false, "sharePoint", "Persistence lifecycle state used by EF soft delete."),
      field("ApprovalStatus", "choice", true, "sharePoint", "Approval lifecycle state: draft, pendingApproval, approved, or rejected."),
      field("VacationRequestId", "text", false, "sharePoint", "Link to the originating vacation request for approval write-back."),
      field("CreatedAt", "dateTime", true, "sharePoint", "Creation timestamp."),
      field("ModifiedAt", "dateTime", true, "sharePoint", "Last modification timestamp."),
      field("IcsUid", "text", false, "sharePoint", "iCalendar UID of an inbound mailbox-synced event."),
      field("Source", "text", false, "sharePoint", "Origin of the record, e.g. outlook-mailbox.")
    ],
    technical: {
      uniqueKeys: [],
      indexes: [
        index(["UserPerson"], "Supports user-specific absence loading."),
        index(["StartDate"], "Supports date-range overlap queries."),
        index(["EndDate"], "Supports date-range overlap queries.")
      ],
      searchableFields: ["UserPerson", "Type", "StartDate", "EndDate"],
      references: [
        reference("UserPerson", "graphUserId", "Absence owner."),
        reference("SubstitutePerson", "graphUserId", "Substitute during the absence.")
      ]
    }
  },
  {
    key: "vacationBalances",
    name: "VacationBalances",
    purpose: "Stores vacation allowance facts by Microsoft Graph user id and year. Booked, pending and remaining days are calculated, never stored.",
    fields: [
      field("Id", "text", true, "sharePoint", "SharePoint item identifier."),
      field("UserPerson", "user", true, "graphReference", "Balance owner. Person column (EO-430)."),
      field("Year", "number", true, "sharePoint", "Vacation year."),
      field("Entitlement", "number", true, "sharePoint", "Annual vacation entitlement."),
      field("CarryForward", "number", false, "sharePoint", "Vacation days carried over from the previous year."),
      field("ManualAdjustment", "number", false, "sharePoint", "Manual planning adjustment."),
      field("Comment", "text", false, "sharePoint", "Optional explanation for carried-over or adjusted days.")
    ],
    technical: {
      uniqueKeys: [
        uniqueKey(["UserPerson", "Year"], "One vacation balance record per user and calendar year.")
      ],
      indexes: [
        index(["UserPerson"], "Supports user-specific balance lookup."),
        index(["Year"], "Supports year-specific balance loading.")
      ],
      searchableFields: ["UserPerson", "Year"],
      references: [
        reference("UserPerson", "graphUserId", "Vacation balance owner.")
      ]
    }
  },
  {
    key: "planningSettings",
    name: "PlanningSettings",
    purpose: "Stores global planning settings as key/value facts.",
    fields: [
      field("Id", "text", true, "sharePoint", "SharePoint item identifier."),
      field("Key", "text", true, "sharePoint", "Setting key."),
      field("Value", "text", true, "sharePoint", "Setting value stored as text and parsed by the application."),
      field("Scope", "text", false, "sharePoint", "Optional scope such as tenant, organization, or team."),
      field("Description", "text", false, "sharePoint", "Human-readable setting description.")
    ],
    technical: {
      uniqueKeys: [
        uniqueKey(["Key", "Scope"], "One setting value per key and optional scope.")
      ],
      indexes: [
        index(["Key"], "Supports direct setting lookup."),
        index(["Scope"], "Supports scoped settings loading.")
      ],
      searchableFields: ["Key", "Scope"],
      references: []
    }
  },
  {
    key: "publicHolidays",
    name: "PublicHolidays",
    purpose: "Stores public holiday facts used by planning calculations.",
    fields: [
      field("Id", "text", true, "sharePoint", "SharePoint item identifier."),
      field("Date", "date", true, "sharePoint", "Holiday date."),
      field("Title", "text", true, "sharePoint", "Holiday label."),
      field("Label", "text", false, "sharePoint", "EF-aligned companion to Title."),
      field("Location", "text", false, "sharePoint", "Optional location; null for capacity-relevant public holidays."),
      field("IsSchoolHoliday", "boolean", false, "computed", "Derived by the provider from Location. Full-day blocking uses the Events template built-in fAllDayEvent.")
    ],
    technical: {
      uniqueKeys: [
        uniqueKey(["Date", "Location"], "One holiday record per date and location.")
      ],
      indexes: [
        index(["Date"], "Supports date-range holiday loading."),
        index(["Location"], "Supports location-specific holiday lookup.")
      ],
      searchableFields: ["Date", "Location", "Title"],
      references: []
    }
  },
  {
    key: "teamPlanningConfiguration",
    name: "TeamPlanningConfiguration",
    purpose: "Stores planning configuration for Microsoft Teams / M365 Groups.",
    fields: [
      field("Id", "text", true, "sharePoint", "SharePoint item identifier."),
      field("TeamId", "text", true, "graphReference", "Microsoft Teams team or M365 Group id."),
      field("PlanningName", "text", true, "sharePoint", "Planning display name."),
      field("TeamName", "text", false, "sharePoint", "EF-aligned team display name."),
      field("DefaultView", "choice", false, "sharePoint", "Default planning view for this team."),
      field("DefaultCapacityThreshold", "number", false, "sharePoint", "Default capacity threshold override."),
      field("DefaultApproverPerson", "user", true, "graphReference", "Default approver. Person column (EO-430)."),
      field("BackupApproverPerson", "user", false, "graphReference", "Backup approver."),
      field("ApprovalRequired", "boolean", true, "sharePoint", "Whether requests for this team require approval."),
      field("OutlookSyncEnabled", "boolean", true, "sharePoint", "Whether Outlook sync is enabled for this team."),
      field("Comment", "text", false, "sharePoint", "Optional administrator note."),
      field("LastModified", "dateTime", true, "sharePoint", "Last configuration update timestamp.")
    ],
    technical: {
      uniqueKeys: [
        uniqueKey(["TeamId"], "One planning configuration per Microsoft Teams team / M365 Group.")
      ],
      indexes: [
        index(["TeamId"], "Supports configuration lookup by Microsoft Teams team id.")
      ],
      searchableFields: ["TeamId", "PlanningName"],
      references: [
        reference("TeamId", "teamsGroupId", "Microsoft Teams team or M365 Group."),
        reference("DefaultApproverPerson", "graphUserId", "Default approver."),
        reference("BackupApproverPerson", "graphUserId", "Backup approver.")
      ]
    }
  },
  {
    key: "planningEvents",
    name: "PlanningEvents",
    purpose: "Stores non-absence planning events such as home office, projects, maintenance, on-call, and standby.",
    fields: [
      field("Id", "text", true, "sharePoint", "SharePoint item identifier."),
      field("ResourcePerson", "user", true, "graphReference", "Planned resource. Person column (EO-430)."),
      field("Type", "text", true, "sharePoint", "Planning event type from the PlanningEventType union."),
      field("Title", "text", true, "sharePoint", "Event display title (built-in Title column)."),
      field("StartDate", "date", true, "sharePoint", "First event date."),
      field("StartHalf", "choice", false, "sharePoint", "Optional morning, afternoon, or full-day start boundary."),
      field("EndDate", "date", true, "sharePoint", "Last event date."),
      field("EndHalf", "choice", false, "sharePoint", "Optional morning, afternoon, or full-day end boundary."),
      field("AbsenceId", "text", false, "sharePoint", "Optional id of the related Absences item."),
      field("ApprovalStatus", "choice", false, "sharePoint", "Optional approval lifecycle state: draft, pendingApproval, approved, or rejected."),
      field("Comment", "text", false, "sharePoint", "Optional event note persisted by EF."),
      field("CreatedAt", "dateTime", true, "sharePoint", "Creation timestamp. Not Created, which is a SharePoint built-in."),
      field("ModifiedAt", "dateTime", true, "sharePoint", "Last modification timestamp. Not Modified, which is a SharePoint built-in.")
    ],
    technical: {
      uniqueKeys: [],
      indexes: [
        index(["ResourcePerson"], "Supports resource-specific event loading."),
        index(["StartDate"], "Supports date-range overlap queries."),
        index(["EndDate"], "Supports date-range overlap queries.")
      ],
      searchableFields: ["ResourcePerson", "Type", "StartDate", "EndDate"],
      references: [
        reference("ResourcePerson", "graphUserId", "Planned resource.")
      ]
    }
  },
  {
    key: "vacationRequests",
    name: "VacationRequests",
    purpose: "Stores vacation request facts and Microsoft 365 approval workflow state (EO-200 / EO-207).",
    fields: [
      field("Id", "text", true, "sharePoint", "SharePoint item identifier."),
      field("RequestId", "text", true, "sharePoint", "Application-generated vacation request id. Application key."),
      field("TeamId", "text", true, "graphReference", "Microsoft Teams team or M365 Group id."),
      field("UserPerson", "user", true, "graphReference", "Requester. Person column (EO-430)."),
      field("Type", "text", true, "sharePoint", "Configured absence type."),
      field("StartDate", "date", true, "sharePoint", "First requested date."),
      field("StartHalf", "choice", true, "sharePoint", "Morning, afternoon, or full-day start boundary."),
      field("EndDate", "date", true, "sharePoint", "Last requested date."),
      field("EndHalf", "choice", true, "sharePoint", "Morning, afternoon, or full-day end boundary."),
      field("Comment", "text", false, "sharePoint", "Optional requester note."),
      field("ApprovalRequired", "boolean", true, "sharePoint", "Whether the approval policy requires an approval."),
      field("ApproverPerson", "user", false, "graphReference", "Resolved approver. Person column (EO-430)."),
      field("Status", "choice", true, "sharePoint", "Vacation request lifecycle status (EO-200 status model)."),
      field("ApprovalProvider", "choice", true, "sharePoint", "Approval provider: none or microsoftApprovals."),
      field("ApprovalReferenceId", "text", false, "sharePoint", "Microsoft Approvals reference id returned by the flow."),
      field("CommentToApprover", "text", false, "sharePoint", "Optional message sent to the approver."),
      field("DecisionByPerson", "user", false, "graphReference", "Deciding approver, written by the flow."),
      field("DecisionDate", "dateTime", false, "sharePoint", "Decision timestamp, written by the flow."),
      field("DecisionComment", "text", false, "sharePoint", "Approver comment, written by the flow."),
      field("FlowRunId", "text", false, "sharePoint", "Power Automate flow run id for diagnostics."),
      field("SyncToOutlook", "boolean", true, "sharePoint", "Whether the requester wants Outlook calendar sync."),
      field("OutlookSyncStatus", "choice", false, "sharePoint", "Outlook sync state: notRequired, pending, synced, or failed."),
      field("GraphEventId", "text", false, "sharePoint", "Graph calendar event id created by the Outlook sync."),
      field("OutlookLastSyncedAt", "dateTime", false, "sharePoint", "Timestamp of the last successful Outlook sync."),
      field("OutlookSyncError", "text", false, "sharePoint", "Last Outlook sync error, if any."),
      field("CreatedAt", "dateTime", true, "sharePoint", "Creation timestamp."),
      field("ModifiedAt", "dateTime", true, "sharePoint", "Last modification timestamp.")
    ],
    technical: {
      uniqueKeys: [
        uniqueKey(["RequestId"], "One list item per application vacation request id.")
      ],
      indexes: [
        index(["RequestId"], "Supports lookup by application request id."),
        index(["UserPerson"], "Supports requester-specific loading."),
        index(["TeamId"], "Supports team-specific loading."),
        index(["Status"], "Supports pending/approved status queries."),
        index(["StartDate"], "Supports date-range queries."),
        index(["EndDate"], "Supports date-range queries.")
      ],
      searchableFields: ["RequestId", "UserPerson", "TeamId", "Status", "StartDate", "EndDate"],
      references: [
        reference("UserPerson", "graphUserId", "Requester."),
        reference("ApproverPerson", "graphUserId", "Resolved approver."),
        reference("DecisionByPerson", "graphUserId", "Deciding approver."),
        reference("TeamId", "teamsGroupId", "Requesting team.")
      ]
    }
  }
] as const satisfies readonly SharePointPlanningListDefinition[];

export const sharePointReferenceStrategy = {
  userReference: "graphUserId",
  teamReference: "teamsGroupId",
  forbiddenUserReferences: ["DisplayName", "Mail", "UPN"] as const
} as const;

export const forbiddenSharePointEmployeeFields = [
  "DisplayName",
  "Email",
  "Avatar",
  "JobTitle",
  "Department",
  "TeamMembership"
] as const;

function field(
  name: string,
  type: SharePointFieldType,
  required: boolean,
  source: SharePointFieldSource,
  description: string
): SharePointPlanningField {
  return { name, type, required, source, description };
}

function uniqueKey(fields: readonly string[], description: string): SharePointUniqueKeyDefinition {
  return { fields, description };
}

function index(fields: readonly string[], description: string): SharePointIndexDefinition {
  return { fields, description };
}

function reference(
  field: string,
  target: SharePointReferenceDefinition["target"],
  description: string
): SharePointReferenceDefinition {
  return { field, target, description };
}
