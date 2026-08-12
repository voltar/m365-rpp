namespace RppWebApi.Data;

/// <summary>
/// EO-430: the list and column names the provider reads, mirroring
/// <c>scripts/provision-sharepoint-lists.ps1</c>. They are named here once so a schema change is a
/// single edit and so the FR-430.8 startup validation and the provider cannot drift apart.
///
/// EO column names are the system of record for every duplicated fact, with one exception:
/// <c>CreatedAt</c>/<c>ModifiedAt</c>, because <c>Created</c>/<c>Modified</c> collide with the
/// SharePoint built-ins of those names.
///
/// Person columns keep the <c>*Person</c> suffix in their internal names — they already exist with
/// that name and the correct type on provisioned sites, and SharePoint cannot retype a column.
/// In REST a <c>User</c> column named <c>UserPerson</c> exposes its lookup id as
/// <c>UserPersonId</c>, which is what queries select and filter on (FR-430.12).
/// </summary>
public static class SharePointListSchema
{
    public static class Lists
    {
        public const string Absences = "Absences";
        public const string VacationBalances = "VacationBalances";
        public const string PlanningSettings = "PlanningSettings";
        public const string PublicHolidays = "PublicHolidays";
        public const string TeamPlanningConfiguration = "TeamPlanningConfiguration";
        public const string PlanningEvents = "PlanningEvents";
        public const string VacationRequests = "VacationRequests";
        public const string TeamAdminTeams = "TeamAdminTeams";
        public const string TeamAdminMemberAssignments = "TeamAdminMemberAssignments";
        public const string TeamAdminSettings = "TeamAdminSettings";
        public const string TeamAdminAbsenceTypes = "TeamAdminAbsenceTypes";
        public const string Organisations = "Organisations";
        public const string Locations = "Locations";
        public const string ProfileValueMappings = "ProfileValueMappings";
        public const string DisplaySettings = "DisplaySettings";
        public const string MailboxSyncConfigs = "MailboxSyncConfigs";
    }

    /// <summary>
    /// Person columns, as declared in the provisioning script. Suffixing with <c>Id</c> gives the
    /// lookup-id field REST projects and filters on.
    /// </summary>
    public static class People
    {
        public const string User = "UserPerson";
        public const string Substitute = "SubstitutePerson";
        public const string Approver = "ApproverPerson";
        public const string Resource = "ResourcePerson";
        public const string TeamLead = "TeamLeadPerson";
        public const string DefaultApprover = "DefaultApproverPerson";

        /// <summary>The lookup-id projection of a person column (<c>UserPerson</c> -&gt; <c>UserPersonId</c>).</summary>
        public static string LookupField(string personField) => personField + "Id";
    }

    /// <summary>
    /// The date range on the three Events calendars. These are the template's own columns, and they
    /// are what the calendar view draws — so they are the system of record for when something
    /// happens, and the application adds no second date column beside them. They carry a time
    /// component; a planning date is a calendar day, so reads truncate it.
    /// </summary>
    public static class EventRange
    {
        public const string Start = "EventDate";
        public const string End = "EndDate";
    }

    /// <summary>
    /// Columns the application writes as timestamps. Never the built-in <c>Created</c>/<c>Modified</c>:
    /// those are SharePoint's own and record who touched the item, not what the application means by
    /// created or modified.
    /// </summary>
    public static class Timestamps
    {
        public const string CreatedAt = "CreatedAt";
        public const string ModifiedAt = "ModifiedAt";

        /// <summary>
        /// The configuration lists carry a single <c>LastModified</c> instead of the
        /// created/modified pair — they mirror EF entities that only ever had one. Named here so the
        /// difference is a schema fact rather than something each read has to remember.
        /// </summary>
        public const string LastModified = "LastModified";
    }

    /// <summary>
    /// Both global query filters from <c>RppDbContext</c> (FR-430.6). SharePoint has no equivalent of
    /// an EF global query filter, so every read that touches these lists must carry them explicitly —
    /// a read that forgets shows records the application considers gone.
    /// </summary>
    public static class SoftDelete
    {
        /// <summary>Absences: <c>Status != "deleted"</c>.</summary>
        public const string AbsenceFilter = "Status ne 'deleted'";

        /// <summary>Vacation requests: <c>Status != "cancelled"</c>.</summary>
        public const string VacationRequestFilter = "Status ne 'cancelled'";
    }
}
