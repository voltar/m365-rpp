#Requires -Version 7.0
<#
.SYNOPSIS
    Provisions the RPP planning lists in a SharePoint Online site.

.DESCRIPTION
    Creates or validates planning lists used by the SharePoint backend.

    EO-430: one column per fact. Person-valued facts are a single SharePoint User column;
    the UID text twin is retired. Absences, PublicHolidays and PlanningEvents are Event
    Calendars. Each list gets a managed default view, because the lists are also an editing
    surface for administrators and HR.

    This script is idempotent. Existing fields are preserved, missing fields are added,
    and type drift is reported.

    Item versioning is provisioned and validated, not assumed: EO-430 makes SharePoint version
    history the audit trail for both writers, so every list is set to keep 10 major versions.

.PARAMETER SiteUrl
    Full URL of the target SharePoint site.

.PARAMETER ClientId
    Entra ID application client id used for PnP.PowerShell authentication.
    Falls back to the AppId from rpp-config.psd1 or the RPP_APP_ID environment variable.

.PARAMETER SiteUrl
    Full URL of the target SharePoint site.
    Falls back to the SharePointSiteUrl from rpp-config.psd1.

.PARAMETER DeviceLogin
    Use device-code login instead of interactive browser login.

.PARAMETER UseCurrentConnection
    Reuse an existing Connect-PnPOnline connection.

.PARAMETER ValidateOnly
    Report drift without creating/updating lists or fields.

.PARAMETER RemoveRetiredFields
    Removes the columns EO-430 retires: the UID text twins replaced by User columns, the
    duplicate field family that lost to the EF name, the stored calculated vacation values,
    and UserDisplayName. Off by default, because a site may still hold data in them.
    Without it, retired columns that are still present are reported as drift.

.EXAMPLE
    ./provision-sharepoint-lists.ps1 -SiteUrl https://contoso.sharepoint.com/sites/rpp -UseCurrentConnection -ValidateOnly

.EXAMPLE
    ./provision-sharepoint-lists.ps1 -SiteUrl https://contoso.sharepoint.com/sites/rpp -ClientId 00000000-0000-0000-0000-000000000000

.EXAMPLE
    ./provision-sharepoint-lists.ps1 -SiteUrl https://contoso.sharepoint.com/sites/rpp -UseCurrentConnection -RemoveRetiredFields
#>
[CmdletBinding()]
param(
    [string] $SiteUrl,

    [string] $ClientId,

    [switch] $DeviceLogin,

    [switch] $UseCurrentConnection,

    [switch] $ValidateOnly,

    [switch] $RemoveRetiredFields
)

$ErrorActionPreference = "Stop"

# Resolve defaults from shared config (public identifiers only, no secrets)
$configPath = Join-Path $PSScriptRoot "rpp-config.psd1"
if (Test-Path $configPath) {
    $config = Import-PowerShellDataFile -Path $configPath
    if (-not $ClientId) { $ClientId = if ($env:RPP_APP_ID) { $env:RPP_APP_ID } else { $config.AppId } }
    if (-not $SiteUrl) { $SiteUrl = $config.SharePointSiteUrl }
}

if (-not $SiteUrl) {
    Write-Error "Provide -SiteUrl or set SharePointSiteUrl in rpp-config.psd1."
    exit 1
}

if (-not (Get-Module -ListAvailable -Name "PnP.PowerShell")) {
    Write-Error "PnP.PowerShell is not installed. Run: Install-Module PnP.PowerShell -Scope CurrentUser"
    exit 1
}

if (-not $UseCurrentConnection -and -not $ClientId) {
    Write-Error "Provide -ClientId for authentication or use -UseCurrentConnection."
    exit 1
}

$script:issues = @()
$script:changes = @()

# EO-430: SharePoint version history is the audit trail. It covers both writers — the application
# and the people editing the lists directly — and lets an entry be rolled back. That only holds if
# versioning is actually on, so the script asserts it instead of trusting the tenant default.
$script:majorVersionLimit = 10

function Add-Issue([string] $message) {
    $script:issues += $message
    Write-Host "  [DRIFT] $message" -ForegroundColor Yellow
}

function Add-Change([string] $message) {
    $script:changes += $message
    Write-Host "  [ADDED] $message" -ForegroundColor Green
}

# --- Choice sets -------------------------------------------------------------

$absenceTypeChoices = @("vacation", "compensation", "education", "training", "military", "unpaidLeave", "otherAbsence")
$dayHalfChoices = @("morning", "afternoon", "fullDay")
$approvalStatusChoices = @("draft", "pendingApproval", "approved", "rejected", "cancelled", "failed")
$vacationRequestStatusChoices = @("draft", "submitted", "pendingApproval", "approved", "rejected", "cancelled", "failed")
$approvalProviderChoices = @("none", "microsoftApprovals")
$outlookSyncStatusChoices = @("notRequired", "pending", "synced", "failed")
$planningEventTypeChoices = @(
    "vacation", "compensation", "education", "training", "military", "unpaidLeave", "otherAbsence",
    "homeOffice", "project", "maintenance", "onCall", "standby"
)
$entityStatusChoices = @("approved", "deleted")

# --- List definitions --------------------------------------------------------
# EO-430. One column per fact.
#
# Person-valued facts are a single SharePoint `User` column. The UID text twin is retired: with one
# column there is no direction to reconcile and nothing for a person's edit to fall out of step
# with. The provider translates Graph user id <-> site user at the storage boundary (FR-430.12).
#
# Internal names of the person columns keep the existing `*Person` suffix. They already exist with
# the correct type on sites provisioned with the former -EnablePeoplePickerFields, and SharePoint
# cannot retype a column — reusing them avoids both a collision with the retired text column and a
# forced re-provision. Readable labels come from DisplayName instead.
#
# CreatedBy / ModifiedBy are gone: SharePoint's built-in Author / Editor hold exactly that fact,
# are already populated, and are correct for both writers.
#
# RetiredFields lists what this EO abandons. The script never removes a column unless
# -RemoveRetiredFields is passed; otherwise it reports them so an operator sees what is stale.

$listDefinitions = @(
    @{
        Name        = "Absences"
        Template    = "Events"
        Description = "RPP absence facts. One column per fact; people are User columns (EO-430)."
        # Title is the calendar label. Absences is the one calendar people maintain by hand, so
        # hiding it was the worst place to do it: a manual entry rendered as a blank block in the
        # month view. It carries no application fact — the provider composes it from Type and
        # employee, the same way a person types one.
        UsesTitle   = $true
        BuiltInFieldAdjustments = @(
            @{ Name = "EventDate"; Required = $true; Hidden = $false },
            @{ Name = "EndDate"; Required = $true; Hidden = $false },
            @{ Name = "Description"; Required = $false; Hidden = $false }
        )
        Fields      = @(
            @{ Name = "UserPerson"; Type = "User"; DisplayName = "Employee"; Required = $true; Indexed = $true },
            # EF name wins (was AbsenceType). Kept as Text because SharePoint cannot retype an
            # existing column; the choice-vs-text question for editors is a follow-up, not a silent
            # retype that would strand every provisioned site.
            @{ Name = "Type"; Type = "Text"; Required = $true; Indexed = $true },
            # No StartDate / EndDate. The Events template owns EventDate and EndDate, they are
            # adjusted above, and they are what the calendar view draws. A separate StartDate held
            # the same fact a second time — visible in the edit form as a third date field beside
            # "Start Time" and "End Time", and ignored by the calendar. EndDate never existed as our
            # column at all: the built-in answered the name.
            @{ Name = "StartHalf"; Type = "Choice"; DisplayName = "Start half-day"; Required = $true; Choices = $dayHalfChoices; Default = "fullDay" },
            @{ Name = "EndHalf"; Type = "Choice"; DisplayName = "End half-day"; Required = $true; Choices = $dayHalfChoices; Default = "fullDay" },
            # No duration column. The day count follows from StartDate, EndDate and the two day
            # halves, so it is a calculated value and is never stored (CLAUDE.md, AGENTS.md) — the
            # same rule that retired the vacation-balance figures below. The provider computes it on
            # read (RppWebApi/Services/AbsenceDuration.cs). Stored, it would be an editable number in
            # the form that the application ignores.
            #
            # This also sidesteps the Events template's built-in 'Duration' (Integer, seconds),
            # which owns that internal name and cannot be replaced or removed.
            @{ Name = "Comment"; Type = "Note" },
            @{ Name = "SubstitutePerson"; Type = "User"; DisplayName = "Substitute"; Required = $false },
            @{ Name = "Status"; Type = "Choice"; Required = $false; Choices = $entityStatusChoices; Default = "approved" },
            @{ Name = "ApprovalStatus"; Type = "Choice"; DisplayName = "Approval status"; Required = $true; Choices = $approvalStatusChoices; Default = "approved" },
            @{ Name = "VacationRequestId"; Type = "Text"; DisplayName = "Vacation request" },
            @{ Name = "CreatedAt"; Type = "DateTime"; DisplayName = "Created at"; Required = $true; Default = "[today]" },
            @{ Name = "ModifiedAt"; Type = "DateTime"; DisplayName = "Modified at"; Required = $true; Default = "[today]" },
            @{ Name = "IcsUid"; Type = "Text"; DisplayName = "Calendar UID" },
            @{ Name = "Source"; Type = "Text" }
        )
        # StartDate is retired, EndDate is not: EndDate is the template's own column and was never
        # ours to retire.
        RetiredFields = @("UserId", "EmployeeId", "AbsenceType", "Substitute", "StartDate", "CreatedBy", "ModifiedBy", "CreatedByPerson", "ModifiedByPerson")
        DefaultViewFields = @("Title", "UserPerson", "Type", "EventDate", "EndDate")
        DefaultViewQuery = "<Where><Neq><FieldRef Name='Status' /><Value Type='Text'>deleted</Value></Neq></Where>"
        ApplicationEnforcedKeys = @()
    },
    @{
        Name        = "VacationBalances"
        Template    = "GenericList"
        Description = "RPP vacation allowance facts by user and year. Calculated values are never stored (EO-430)."
        UsesTitle   = $false
        Fields      = @(
            @{ Name = "UserPerson"; Type = "User"; DisplayName = "Employee"; Required = $true; Indexed = $true },
            @{ Name = "Year"; Type = "Number"; Required = $true; Indexed = $true; Decimals = 0 },
            @{ Name = "Entitlement"; Type = "Number"; DisplayName = "Annual entitlement"; Required = $true; Decimals = 2 },
            @{ Name = "CarryForward"; Type = "Number"; DisplayName = "Carried over"; Decimals = 2 },
            @{ Name = "ManualAdjustment"; Type = "Number"; DisplayName = "Manual adjustment"; Decimals = 2 },
            @{ Name = "Comment"; Type = "Note" }
        )
        # Booked, pending and remaining days are calculated by the capacity engine and must never be
        # stored. Visible and editable, they invite a figure the application ignores.
        RetiredFields = @(
            "UserId", "EmployeeId", "AllowanceDays", "CarriedOverDays", "ManualAdjustmentDays",
            "ApprovedVacationDays", "ApprovedVacation", "PendingVacationDays", "PendingVacation",
            "RemainingDays", "Remaining"
        )
        DefaultViewFields = @("UserPerson", "Year", "Entitlement")
        ApplicationEnforcedKeys = @("UserPerson + Year")
    },
    @{
        Name        = "PlanningSettings"
        Template    = "GenericList"
        Description = "RPP global planning settings as key/value facts."
        UsesTitle   = $false
        Fields      = @(
            @{ Name = "Key"; Type = "Text"; Required = $true; Indexed = $true },
            @{ Name = "Value"; Type = "Note"; Required = $true },
            @{ Name = "Scope"; Type = "Text"; Indexed = $true },
            @{ Name = "Description"; Type = "Text" }
        )
        DefaultViewFields = @("Key", "Scope")
        # EO-430: the ResourceProfiles *item* is retired, not a column. Its Value held a JSON array
        # of { employeeId, employmentRate, workingDays } — employee data filed as a setting. Graph
        # ids inside a text value cannot be a User column and a JSON blob is not something a person
        # edits, so it broke both rules this order sets. employmentRate already exists properly as
        # TeamAdminMemberAssignments.EmploymentPercentage, which wins; workingDays moved there too.
        # What stays here are scalar tenant settings with no person reference.
        RetiredItems = @("ResourceProfiles")
        ApplicationEnforcedKeys = @("Key + Scope")
    },
    @{
        Name        = "PublicHolidays"
        Template    = "Events"
        Description = "RPP public and school holiday facts."
        UsesTitle   = $true
        BuiltInFieldAdjustments = @(
            @{ Name = "EventDate"; Required = $true; Hidden = $false },
            @{ Name = "EndDate"; Required = $true; Hidden = $false },
            @{ Name = "fAllDayEvent"; Required = $false; Hidden = $false }
        )
        Fields      = @(
            # Same rule as Absences: EventDate is the date, Title is the label. 'Date' duplicated
            # the first and 'Label' the second — the provider already read the holiday name from
            # Title, so the Label column was carrying nothing.
            @{ Name = "Location"; Type = "Text"; Indexed = $true },
            # No EF source: PublicHoliday encodes the school-holiday case as Location != null. The
            # provider derives this, so it is optional rather than required — a required column the
            # provider cannot fill rejects every insert.
            @{ Name = "IsSchoolHoliday"; Type = "Boolean"; DisplayName = "School holiday"; Required = $false; Default = "0" }
        )
        # Region loses to the EF name Location. IsFullDay duplicates the Events template built-in
        # fAllDayEvent, which is already adjusted above.
        RetiredFields = @("Region", "IsFullDay", "Date", "Label")
        DefaultViewFields = @("Title", "EventDate", "Location")
        ApplicationEnforcedKeys = @("EventDate + Location")
    },
    @{
        Name        = "TeamPlanningConfiguration"
        Template    = "GenericList"
        Description = "RPP planning configuration by team id."
        UsesTitle   = $false
        Fields      = @(
            @{ Name = "TeamId"; Type = "Text"; DisplayName = "Team id"; Required = $true; Indexed = $true; EnforceUnique = $true },
            @{ Name = "PlanningName"; Type = "Text"; DisplayName = "Planning name"; Required = $true },
            @{ Name = "TeamName"; Type = "Text"; DisplayName = "Team name"; Required = $false },
            @{ Name = "DefaultView"; Type = "Choice"; DisplayName = "Default view"; Choices = @("gantt"); FillInChoice = $true },
            @{ Name = "DefaultCapacityThreshold"; Type = "Number"; DisplayName = "Capacity threshold"; Decimals = 2 },
            @{ Name = "DefaultApproverPerson"; Type = "User"; DisplayName = "Default approver"; Required = $true },
            @{ Name = "BackupApproverPerson"; Type = "User"; DisplayName = "Backup approver" },
            @{ Name = "ApprovalRequired"; Type = "Boolean"; DisplayName = "Approval required"; Required = $true; Default = "1" },
            @{ Name = "OutlookSyncEnabled"; Type = "Boolean"; DisplayName = "Outlook sync"; Required = $true; Default = "1" },
            @{ Name = "Comment"; Type = "Note" },
            @{ Name = "LastModified"; Type = "DateTime"; DisplayName = "Last modified"; Required = $true; Default = "[today]" }
        )
        RetiredFields = @("DefaultApproverId", "BackupApproverId")
        DefaultViewFields = @("TeamName", "DefaultApproverPerson")
        ApplicationEnforcedKeys = @()
    },
    @{
        Name        = "PlanningEvents"
        Template    = "Events"
        Description = "RPP non-absence planning events."
        UsesTitle   = $true
        BuiltInFieldAdjustments = @(
            @{ Name = "EventDate"; Required = $true; Hidden = $false },
            @{ Name = "EndDate"; Required = $true; Hidden = $false },
            @{ Name = "Description"; Required = $false; Hidden = $false }
        )
        Fields      = @(
            @{ Name = "ResourcePerson"; Type = "User"; DisplayName = "Resource"; Required = $true; Indexed = $true },
            @{ Name = "Type"; Type = "Text"; Required = $true; Indexed = $true },
            # See Absences: EventDate / EndDate are the template's and drive the calendar view.
            @{ Name = "StartHalf"; Type = "Choice"; DisplayName = "Start half-day"; Choices = $dayHalfChoices },
            @{ Name = "EndHalf"; Type = "Choice"; DisplayName = "End half-day"; Choices = $dayHalfChoices },
            @{ Name = "AbsenceId"; Type = "Text"; DisplayName = "Linked absence" },
            @{ Name = "ApprovalStatus"; Type = "Choice"; DisplayName = "Approval status"; Choices = $approvalStatusChoices },
            @{ Name = "Comment"; Type = "Note" },
            # Created / Modified are SharePoint built-ins on every list. Application timestamps
            # cannot use those names and live in CreatedAt / ModifiedAt, as on the other lists.
            @{ Name = "CreatedAt"; Type = "DateTime"; DisplayName = "Created at"; Required = $true; Default = "[today]" },
            @{ Name = "ModifiedAt"; Type = "DateTime"; DisplayName = "Modified at"; Required = $true; Default = "[today]" }
        )
        RetiredFields = @("ResourceId", "EmployeeId", "EventType", "StartDate", "Created", "Modified")
        DefaultViewFields = @("Title", "ResourcePerson", "Type", "EventDate", "EndDate")
        ApplicationEnforcedKeys = @()
    },
    @{
        Name        = "VacationRequests"
        Template    = "GenericList"
        Description = "RPP vacation request lifecycle and M365 approval state."
        UsesTitle   = $false
        Fields      = @(
            @{ Name = "RequestId"; Type = "Text"; DisplayName = "Request id"; Required = $true; Indexed = $true; EnforceUnique = $true },
            @{ Name = "TeamId"; Type = "Text"; DisplayName = "Team id"; Required = $true; Indexed = $true },
            @{ Name = "UserPerson"; Type = "User"; DisplayName = "Requester"; Required = $true; Indexed = $true },
            @{ Name = "Type"; Type = "Text"; Required = $true },
            @{ Name = "StartDate"; Type = "DateTime"; Required = $true; Indexed = $true; DateOnly = $true },
            @{ Name = "StartHalf"; Type = "Choice"; DisplayName = "Start half-day"; Required = $true; Choices = $dayHalfChoices; Default = "fullDay" },
            @{ Name = "EndDate"; Type = "DateTime"; Required = $true; Indexed = $true; DateOnly = $true },
            @{ Name = "EndHalf"; Type = "Choice"; DisplayName = "End half-day"; Required = $true; Choices = $dayHalfChoices; Default = "fullDay" },
            # No duration column — see Absences. Calculated from the dates and day halves.
            @{ Name = "Comment"; Type = "Note" },
            @{ Name = "ApprovalRequired"; Type = "Boolean"; DisplayName = "Approval required"; Required = $true; Default = "0" },
            @{ Name = "ApproverPerson"; Type = "User"; DisplayName = "Approver"; Indexed = $true },
            @{ Name = "Status"; Type = "Choice"; Required = $true; Choices = $vacationRequestStatusChoices; Default = "draft" },
            @{ Name = "ApprovalProvider"; Type = "Choice"; DisplayName = "Approval provider"; Required = $true; Choices = $approvalProviderChoices; Default = "none" },
            @{ Name = "ApprovalReferenceId"; Type = "Text"; DisplayName = "Approval reference" },
            @{ Name = "CommentToApprover"; Type = "Note"; DisplayName = "Comment to approver" },
            @{ Name = "DecisionByPerson"; Type = "User"; DisplayName = "Decided by" },
            @{ Name = "DecisionDate"; Type = "DateTime"; DisplayName = "Decision date" },
            @{ Name = "DecisionComment"; Type = "Note"; DisplayName = "Decision comment" },
            @{ Name = "FlowRunId"; Type = "Text"; DisplayName = "Flow run id" },
            @{ Name = "SyncToOutlook"; Type = "Boolean"; DisplayName = "Sync to Outlook"; Required = $true; Default = "1" },
            @{ Name = "OutlookSyncStatus"; Type = "Choice"; DisplayName = "Outlook sync status"; Choices = $outlookSyncStatusChoices; Default = "notRequired" },
            @{ Name = "GraphEventId"; Type = "Text"; DisplayName = "Calendar event id" },
            @{ Name = "OutlookSyncError"; Type = "Note"; DisplayName = "Outlook sync error" },
            @{ Name = "OutlookLastSyncedAt"; Type = "DateTime"; DisplayName = "Last synced at" },
            @{ Name = "CreatedAt"; Type = "DateTime"; DisplayName = "Created at"; Required = $true; Default = "[today]" },
            @{ Name = "ModifiedAt"; Type = "DateTime"; DisplayName = "Modified at"; Required = $true; Default = "[today]" }
        )
        # UserDisplayName is retired: identity belongs to Graph, and the User column renders the
        # current name from the site's User Information List without the application storing one.
        RetiredFields = @(
            "UserId", "EmployeeId", "AbsenceType", "ApproverUserId", "ApproverId", "UserDisplayName",
            "DecisionBy", "OutlookGraphEventId", "OutlookLastError", "CreatedBy", "ModifiedBy",
            "CreatedByPerson", "ModifiedByPerson",
            # Calculated from the dates and day halves; no longer stored.
            "Duration"
        )
        DefaultViewFields = @("UserPerson", "StartDate", "EndDate", "Status")
        DefaultViewQuery = "<Where><Neq><FieldRef Name='Status' /><Value Type='Text'>cancelled</Value></Neq></Where>"
        ApplicationEnforcedKeys = @("RequestId")
    },
    @{
        Name        = "TeamAdminTeams"
        Template    = "GenericList"
        Description = "RPP team administration - managed teams."
        UsesTitle   = $false
        Fields      = @(
            @{ Name = "TeamId"; Type = "Text"; DisplayName = "Team id"; Required = $true; Indexed = $true; EnforceUnique = $true },
            @{ Name = "TeamName"; Type = "Text"; DisplayName = "Team name"; Required = $true; Indexed = $true },
            @{ Name = "Organization"; Type = "Text"; Required = $true },
            @{ Name = "OwningTeamId"; Type = "Text"; DisplayName = "Owning team id" },
            @{ Name = "SortOrder"; Type = "Number"; DisplayName = "Sort order"; Required = $true; Decimals = 0 },
            @{ Name = "RequiredStaffing"; Type = "Number"; DisplayName = "Required staffing"; Required = $true; Decimals = 0 },
            @{ Name = "Color"; Type = "Text" },
            @{ Name = "CanManage"; Type = "Boolean"; DisplayName = "Can manage"; Required = $true; Default = "0" },
            @{ Name = "LastModified"; Type = "DateTime"; DisplayName = "Last modified"; Required = $true; Default = "[today]" }
        )
        DefaultViewFields = @("TeamName", "Organization", "SortOrder")
        ApplicationEnforcedKeys = @("TeamId")
    },
    @{
        Name        = "TeamAdminMemberAssignments"
        Template    = "GenericList"
        Description = "RPP team administration - member assignments."
        UsesTitle   = $false
        Fields      = @(
            @{ Name = "UserPerson"; Type = "User"; DisplayName = "Member"; Required = $true; Indexed = $true },
            @{ Name = "TeamId"; Type = "Text"; DisplayName = "Team id"; Required = $true; Indexed = $true },
            @{ Name = "IsPrimary"; Type = "Boolean"; DisplayName = "Primary team"; Required = $true; Default = "0" },
            @{ Name = "AdditionalPosition"; Type = "Text"; DisplayName = "Additional position" },
            @{ Name = "EmploymentPercentage"; Type = "Number"; DisplayName = "Employment %"; Decimals = 2 },
            # EO-430: moved out of the ResourceProfiles JSON blob in PlanningSettings. Stored as a
            # comma-separated list of ISO weekday numbers (1 = Monday).
            @{ Name = "WorkingDays"; Type = "Text"; DisplayName = "Working days" },
            @{ Name = "VacationBalance"; Type = "Number"; DisplayName = "Vacation balance"; Required = $true; Decimals = 2 },
            @{ Name = "ApprovalExempt"; Type = "Boolean"; DisplayName = "Approval exempt"; Required = $true; Default = "0" },
            @{ Name = "EffectiveApproverPerson"; Type = "User"; DisplayName = "Effective approver" },
            @{ Name = "LastModified"; Type = "DateTime"; DisplayName = "Last modified"; Required = $true; Default = "[today]" }
        )
        RetiredFields = @("UserId", "EffectiveApproverUserId")
        DefaultViewFields = @("UserPerson", "TeamId", "IsPrimary")
        ApplicationEnforcedKeys = @("UserPerson + TeamId")
    },
    @{
        Name        = "TeamAdminSettings"
        Template    = "GenericList"
        Description = "RPP team administration - per-team settings."
        UsesTitle   = $false
        Fields      = @(
            @{ Name = "TeamId"; Type = "Text"; DisplayName = "Team id"; Required = $true; Indexed = $true; EnforceUnique = $true },
            @{ Name = "TeamLeadPerson"; Type = "User"; DisplayName = "Team lead"; Required = $true },
            @{ Name = "DefaultApproverPerson"; Type = "User"; DisplayName = "Default approver"; Required = $true },
            @{ Name = "BackupApproverPerson"; Type = "User"; DisplayName = "Backup approver" },
            @{ Name = "ApprovalPolicy"; Type = "Choice"; DisplayName = "Approval policy"; Required = $true; Choices = @("optional", "required", "disabled"); Default = "optional" },
            @{ Name = "OutlookSyncPolicy"; Type = "Choice"; DisplayName = "Outlook sync policy"; Choices = @("optional", "enabled", "disabled"); Default = "optional" },
            @{ Name = "AllowUserOverride"; Type = "Boolean"; DisplayName = "Allow user override"; Required = $true; Default = "0" },
            @{ Name = "OutlookSyncEnabled"; Type = "Boolean"; DisplayName = "Outlook sync"; Required = $true; Default = "1" },
            @{ Name = "LastModified"; Type = "DateTime"; DisplayName = "Last modified"; Required = $true; Default = "[today]" }
        )
        RetiredFields = @("TeamLeadUserId", "DefaultApproverUserId", "BackupApproverUserId")
        DefaultViewFields = @("TeamId", "TeamLeadPerson", "ApprovalPolicy")
        ApplicationEnforcedKeys = @("TeamId")
    },
    @{
        Name        = "TeamAdminAbsenceTypes"
        Template    = "GenericList"
        Description = "RPP team administration - configured absence entry types."
        UsesTitle   = $false
        Fields      = @(
            @{ Name = "Key"; Type = "Text"; Required = $true; Indexed = $true; EnforceUnique = $true },
            @{ Name = "Label"; Type = "Text" },
            @{ Name = "LabelKey"; Type = "Text"; DisplayName = "Localization key" },
            @{ Name = "Active"; Type = "Boolean"; Required = $true; Default = "1" },
            @{ Name = "RequiresApproval"; Type = "Boolean"; DisplayName = "Requires approval"; Required = $true; Default = "0" },
            @{ Name = "ConsumesVacationBalance"; Type = "Boolean"; DisplayName = "Consumes vacation balance"; Required = $true; Default = "0" },
            @{ Name = "SortOrder"; Type = "Number"; DisplayName = "Sort order"; Required = $true; Decimals = 0; Default = "0" },
            @{ Name = "LastModified"; Type = "DateTime"; DisplayName = "Last modified"; Required = $true; Default = "[today]" }
        )
        DefaultViewFields = @("Key", "Label", "Active", "SortOrder")
        ApplicationEnforcedKeys = @("Key")
    },
    @{
        Name        = "Organisations"
        Template    = "GenericList"
        Description = "RPP planning organisations."
        UsesTitle   = $false
        Fields      = @(
            # Not 'Name': the built-in FileLeafRef is displayed as "Name" in every list, so that
            # label appears twice in an edit form and the two are told apart only by position.
            @{ Name = "OrganisationName"; Type = "Text"; DisplayName = "Organisation"; Required = $true; Indexed = $true },
            @{ Name = "SortOrder"; Type = "Number"; DisplayName = "Sort order"; Required = $true; Decimals = 0; Default = "0" }
        )
        DefaultViewFields = @("OrganisationName", "SortOrder")
        ApplicationEnforcedKeys = @()
    },
    @{
        Name        = "Locations"
        Template    = "GenericList"
        Description = "RPP planning locations."
        UsesTitle   = $false
        Fields      = @(
            # See Organisations: 'Name' collides with the built-in FileLeafRef's display name.
            @{ Name = "LocationName"; Type = "Text"; DisplayName = "Location"; Required = $true; Indexed = $true },
            @{ Name = "SortOrder"; Type = "Number"; DisplayName = "Sort order"; Required = $true; Decimals = 0; Default = "0" }
        )
        DefaultViewFields = @("LocationName", "SortOrder")
        ApplicationEnforcedKeys = @()
    },
    @{
        Name        = "ProfileValueMappings"
        Template    = "GenericList"
        Description = "RPP profile value mappings for Graph/Entra attribute routing."
        UsesTitle   = $false
        Fields      = @(
            @{ Name = "Kind"; Type = "Choice"; Required = $true; Choices = @("organisation", "location", "team"); Default = "organisation" },
            @{ Name = "GraphValue"; Type = "Text"; DisplayName = "Graph value"; Required = $true; Indexed = $true },
            @{ Name = "TargetId"; Type = "Text"; DisplayName = "Target id"; Required = $true; Indexed = $true }
        )
        DefaultViewFields = @("Kind", "GraphValue", "TargetId")
        ApplicationEnforcedKeys = @("Kind + GraphValue")
    },
    @{
        Name        = "DisplaySettings"
        Template    = "GenericList"
        Description = "RPP display configuration singleton."
        UsesTitle   = $false
        Fields      = @(
            @{ Name = "ShowVacationSummary"; Type = "Boolean"; DisplayName = "Show vacation summary"; Required = $true; Default = "1" },
            @{ Name = "EventColorMode"; Type = "Choice"; DisplayName = "Event colour mode"; Required = $true; Choices = @("byType", "byStatus", "byTeam"); Default = "byType" },
            @{ Name = "LastModified"; Type = "DateTime"; DisplayName = "Last modified"; Required = $true; Default = "[today]" }
        )
        DefaultViewFields = @("ShowVacationSummary", "EventColorMode")
        ApplicationEnforcedKeys = @()
    },
    @{
        # EO-430 FR-430.4: EO-425 added MailboxSyncConfig to the EF model; no list existed for it,
        # so mailbox sync configuration had nowhere to live in the SharePoint profile.
        Name        = "MailboxSyncConfigs"
        Template    = "GenericList"
        Description = "RPP inbound mailbox sync configuration singleton."
        UsesTitle   = $false
        Fields      = @(
            @{ Name = "MailboxAddress"; Type = "Text"; DisplayName = "Mailbox address"; Required = $true },
            @{ Name = "LastModified"; Type = "DateTime"; DisplayName = "Last modified"; Required = $true; Default = "[today]" }
        )
        DefaultViewFields = @("MailboxAddress", "LastModified")
        ApplicationEnforcedKeys = @()
    }
)

# --- Helpers -----------------------------------------------------------------

function Get-ExpectedTypeAsString($fieldDefinition) {
    switch ($fieldDefinition.Type) {
        "Text" { "Text" }
        "Note" { "Note" }
        "Number" { "Number" }
        "Boolean" { "Boolean" }
        "DateTime" { "DateTime" }
        "Choice" { "Choice" }
        "User" { "User" }
        default { $fieldDefinition.Type }
    }
}

function New-FieldXml($fieldDefinition) {
    $name = [System.Security.SecurityElement]::Escape($fieldDefinition.Name)
    # EO-430 FR-430.14: the internal name is the contract the provider maps against; the display
    # name is what a person reads in the list. They are set separately so a readable label never
    # forces a column rename.
    $label = [System.Security.SecurityElement]::Escape(
        $(if ($fieldDefinition.ContainsKey("DisplayName")) { $fieldDefinition.DisplayName } else { $fieldDefinition.Name }))
    $attributes = @(
        "Type=""$($fieldDefinition.Type)"""
        "Name=""$name"""
        "StaticName=""$name"""
        "DisplayName=""$label"""
    )

    if ($fieldDefinition.Required) { $attributes += "Required=""TRUE""" }
    if ($fieldDefinition.Indexed) { $attributes += "Indexed=""TRUE""" }
    if ($fieldDefinition.EnforceUnique) { $attributes += "EnforceUniqueValues=""TRUE""" }
    if ($fieldDefinition.Type -eq "DateTime" -and $fieldDefinition.DateOnly) { $attributes += "Format=""DateOnly""" }
    if ($fieldDefinition.Type -eq "Choice" -and $fieldDefinition.FillInChoice) { $attributes += "FillInChoice=""TRUE""" }
    if ($fieldDefinition.Type -eq "Note") { $attributes += "NumLines=""6"""; $attributes += "RichText=""FALSE""" }
    if ($fieldDefinition.Type -eq "Number" -and $fieldDefinition.ContainsKey("Decimals")) { $attributes += "Decimals=""$($fieldDefinition.Decimals)""" }
    if ($fieldDefinition.Type -eq "User") {
        $attributes += "UserSelectionMode=""PeopleOnly"""
        $attributes += "UserSelectionScope=""0"""
    }

    $children = ""

    if ($fieldDefinition.Type -eq "Choice") {
        $choiceXml = ($fieldDefinition.Choices | ForEach-Object { "<CHOICE>$([System.Security.SecurityElement]::Escape($_))</CHOICE>" }) -join ""
        $children += "<CHOICES>$choiceXml</CHOICES>"
    }

    if ($fieldDefinition.ContainsKey("Default")) {
        $children += "<Default>$([System.Security.SecurityElement]::Escape($fieldDefinition.Default))</Default>"
    }

    return "<Field $($attributes -join ' ')>$children</Field>"
}

function Confirm-BuiltInField($listDefinition, $builtInDefinition) {
    $existingField = Get-PnPField -List $listDefinition.Name -Identity $builtInDefinition.Name -ErrorAction SilentlyContinue

    if (-not $existingField) {
        Add-Issue "List '$($listDefinition.Name)': built-in field '$($builtInDefinition.Name)' is missing."
        return
    }

    $updates = @{}

    if ($builtInDefinition.ContainsKey("Required") -and ([bool]$builtInDefinition.Required -ne $existingField.Required)) {
        $updates.Required = [bool]$builtInDefinition.Required
    }

    if ($builtInDefinition.ContainsKey("Hidden") -and ([bool]$builtInDefinition.Hidden -ne $existingField.Hidden)) {
        $updates.Hidden = [bool]$builtInDefinition.Hidden
    }

    if ($updates.Count -eq 0) {
        return
    }

    if ($ValidateOnly) {
        Add-Issue "List '$($listDefinition.Name)': built-in field '$($builtInDefinition.Name)' settings differ ($($updates.Keys -join ', '))."
        return
    }

    Set-PnPField -List $listDefinition.Name -Identity $builtInDefinition.Name -Values $updates | Out-Null
    Add-Change "List '$($listDefinition.Name)': built-in field '$($builtInDefinition.Name)' updated ($($updates.Keys -join ', '))."
}

function Confirm-Field($listDefinition, $fieldDefinition) {
    $existingField = Get-PnPField -List $listDefinition.Name -Identity $fieldDefinition.Name -ErrorAction SilentlyContinue

    # Get-PnPField resolves -Identity against the display name as well as the internal name, and
    # SharePoint ships built-ins whose display names are ordinary words: FileLeafRef is titled
    # "Name" in every list. A definition named 'Name' therefore matched the built-in, reported a
    # type conflict and returned — so the column was never created, and the run looked like drift
    # instead of a no-op. Only an internal-name match counts as our column.
    if ($existingField -and $existingField.InternalName -ne $fieldDefinition.Name) {
        $existingField = $null
    }

    if (-not $existingField) {
        if ($ValidateOnly) {
            Add-Issue "List '$($listDefinition.Name)': field '$($fieldDefinition.Name)' is missing."
            return
        }

        Add-PnPFieldFromXml -List $listDefinition.Name -FieldXml (New-FieldXml $fieldDefinition) | Out-Null
        Add-Change "List '$($listDefinition.Name)': field '$($fieldDefinition.Name)' created."
        return
    }

    $expectedType = Get-ExpectedTypeAsString $fieldDefinition
    if ($existingField.TypeAsString -ne $expectedType) {
        # SharePoint cannot retype an existing column, so this is never repaired in place. Saying so
        # in the message matters: a report that only states the mismatch reads as cosmetic, and the
        # Integer/Number case is not — an Integer column accepts a half-day absence and rounds the
        # half away without an error. Removing the column destroys the data in it, which is the
        # operator's decision and not the script's.
        Add-Issue ("List '$($listDefinition.Name)': field '$($fieldDefinition.Name)' has type " +
            "'$($existingField.TypeAsString)', expected '$expectedType'. SharePoint cannot retype a column: " +
            "remove '$($fieldDefinition.Name)' from the list and re-run this script to recreate it. " +
            "Values held in the column are lost, so migrate them first if the site holds real data.")
        return
    }

    $updates = @{}

    if ([bool]$fieldDefinition.Required -ne $existingField.Required) {
        $updates.Required = [bool]$fieldDefinition.Required
    }

    if ([bool]$fieldDefinition.Indexed -and -not $existingField.Indexed) {
        $updates.Indexed = $true
    }

    if ([bool]$fieldDefinition.EnforceUnique -and -not $existingField.EnforceUniqueValues) {
        $updates.Indexed = $true
        $updates.EnforceUniqueValues = $true
    }

    if ($fieldDefinition.ContainsKey("DisplayName") -and $existingField.Title -ne $fieldDefinition.DisplayName) {
        $updates.Title = $fieldDefinition.DisplayName
    }

    if ($updates.Count -eq 0) {
        return
    }

    if ($ValidateOnly) {
        Add-Issue "List '$($listDefinition.Name)': field '$($fieldDefinition.Name)' settings differ ($($updates.Keys -join ', '))."
        return
    }

    Set-PnPField -List $listDefinition.Name -Identity $fieldDefinition.Name -Values $updates | Out-Null
    Add-Change "List '$($listDefinition.Name)': field '$($fieldDefinition.Name)' updated ($($updates.Keys -join ', '))."
}

function Confirm-RetiredFields($listDefinition) {
    # EO-430 FR-430.3 / FR-430.12: columns this order abandons. They are never removed silently —
    # a site may hold data in them. Without -RemoveRetiredFields they are reported, so an operator
    # sees a stale column instead of meeting it in an edit form beside its replacement.
    if (-not $listDefinition.ContainsKey("RetiredFields")) {
        return
    }

    foreach ($retiredName in $listDefinition.RetiredFields) {
        $existingField = Get-PnPField -List $listDefinition.Name -Identity $retiredName -ErrorAction SilentlyContinue

        if (-not $existingField) {
            continue
        }

        # Same title/internal-name trap as in Confirm-Field, and far more dangerous here. A retired
        # name often survives as the *display* name of the column that replaced it: 'Substitute' is
        # the label on 'SubstitutePerson'. Matched by title, a freshly provisioned list reported its
        # own new column as stale — and -RemoveRetiredFields would have deleted it. Only an
        # internal-name match is the retired column.
        if ($existingField.InternalName -ne $retiredName) {
            continue
        }

        # A retirement list can name a column the template owns: 'EventType' is an Events built-in,
        # and 'Created'/'Modified' exist on every list. Those cannot be removed, and attempting it
        # fails the run instead of reporting a schema fact. Reported once and skipped — a built-in
        # is not drift, it is what the template provides.
        if ($existingField.FromBaseType -or $existingField.Sealed) {
            Write-Host "  [NOTE] List '$($listDefinition.Name)': '$retiredName' is a built-in column and stays. The application does not read it." -ForegroundColor DarkGray
            continue
        }

        if (-not $RemoveRetiredFields) {
            Add-Issue "List '$($listDefinition.Name)': retired field '$retiredName' is still present. Re-run with -RemoveRetiredFields once its data has been migrated."
            continue
        }

        Remove-PnPField -List $listDefinition.Name -Identity $retiredName -Force -ErrorAction Stop
        Add-Change "List '$($listDefinition.Name)': retired field '$retiredName' removed."
    }
}

function Confirm-RetiredItems($listDefinition) {
    # EO-430: some retirements are list *items*, not columns. Reported only — an item may hold the
    # last copy of data that has not been migrated, and deleting it is not the script's call.
    if (-not $listDefinition.ContainsKey("RetiredItems")) {
        return
    }

    foreach ($retiredKey in $listDefinition.RetiredItems) {
        $items = Get-PnPListItem -List $listDefinition.Name -Query "<View><Query><Where><Eq><FieldRef Name='Key' /><Value Type='Text'>$retiredKey</Value></Eq></Where></Query></View>" -ErrorAction SilentlyContinue

        if ($items -and $items.Count -gt 0) {
            Add-Issue "List '$($listDefinition.Name)': retired item '$retiredKey' is still present. Migrate its data before removing it by hand; the script does not delete items."
        }
    }
}

function Confirm-Versioning($listDefinition) {
    # EO-430: the audit trail rests on item versioning, so it is provisioned and validated like any
    # other part of the schema. Ten major versions is the published retention.
    $list = Get-PnPList -Identity $listDefinition.Name -Includes EnableVersioning, MajorVersionLimit -ErrorAction SilentlyContinue

    if (-not $list) {
        Add-Issue "List '$($listDefinition.Name)': versioning settings could not be read."
        return
    }

    # Auto-expiration trimming makes SharePoint manage the version count itself and ignore
    # MajorVersionLimit. A published retention figure the platform quietly overrides is worse than
    # none. The property is newer than the rest of the list schema, so a tenant that does not expose
    # it is left alone rather than reported as drift.
    $autoTrim = $null
    try {
        $trimmed = Get-PnPList -Identity $listDefinition.Name -Includes EnableAutoExpirationVersionTrim -ErrorAction Stop
        $autoTrim = [bool] $trimmed.EnableAutoExpirationVersionTrim
    }
    catch {
        $autoTrim = $null
    }

    $versioningOn = [bool] $list.EnableVersioning
    $limitMatches = ([int] $list.MajorVersionLimit) -eq $script:majorVersionLimit
    $trimIsOff = ($autoTrim -ne $true)

    if ($versioningOn -and $limitMatches -and $trimIsOff) {
        return
    }

    if ($ValidateOnly) {
        if (-not $versioningOn) {
            Add-Issue "List '$($listDefinition.Name)': item versioning is off; the audit trail EO-430 relies on does not exist."
        }
        if (-not $trimIsOff) {
            Add-Issue "List '$($listDefinition.Name)': automatic version expiration is on, so the retention limit is not honoured."
        }
        if (-not $limitMatches) {
            Add-Issue "List '$($listDefinition.Name)': major version limit is $($list.MajorVersionLimit), expected $($script:majorVersionLimit)."
        }
        return
    }

    $versionSettings = @{
        Identity          = $listDefinition.Name
        EnableVersioning  = $true
        MajorVersions     = [uint32] $script:majorVersionLimit
    }

    # Only sent where the tenant exposes the property and has it on; passing it blind would fail
    # against a tenant whose CSOM does not know it.
    if ($autoTrim -eq $true) {
        $versionSettings.EnableAutoExpirationVersionTrim = $false
    }

    Set-PnPList @versionSettings | Out-Null
    Add-Change "List '$($listDefinition.Name)': item versioning on, $($script:majorVersionLimit) major versions retained."
}

function Confirm-DefaultView($listDefinition) {
    # EO-430 FR-430.14: the lists are an editing surface, so each needs a workable default view.
    # Deliberately lean — the identifying columns and the dates, nothing more. Whoever works in a
    # list adjusts its columns to their own taste anyway, and a wide managed default is churn the
    # script would keep undoing. Only the default view is managed; views created by hand are left
    # alone.
    if (-not $listDefinition.ContainsKey("DefaultViewFields")) {
        return
    }

    $view = Get-PnPView -List $listDefinition.Name -ErrorAction SilentlyContinue |
        Where-Object { $_.DefaultView } |
        Select-Object -First 1

    if (-not $view) {
        Add-Issue "List '$($listDefinition.Name)': no default view found."
        return
    }

    # ViewFields is a CSOM collection and is not populated by Get-PnPView. Read without loading it
    # first it comes back empty, every comparison fails, and the script rewrites all sixteen default
    # views on every run — which is what the second run against the development tenant showed.
    try {
        Get-PnPProperty -ClientObject $view -Property ViewFields -ErrorAction Stop | Out-Null
    }
    catch {
        Add-Issue "List '$($listDefinition.Name)': default view columns could not be read ($($_.Exception.Message))."
        return
    }

    $expectedFields = @($listDefinition.DefaultViewFields)
    $currentFields = @($view.ViewFields)
    $fieldsMatch = ($currentFields.Count -eq $expectedFields.Count) -and
        (-not (Compare-Object -ReferenceObject $currentFields -DifferenceObject $expectedFields -SyncWindow 0))

    $expectedQuery = $(if ($listDefinition.ContainsKey("DefaultViewQuery")) { $listDefinition.DefaultViewQuery } else { "" })
    $queryMatches = ($view.ViewQuery -replace '\s', '') -eq ($expectedQuery -replace '\s', '')

    if ($fieldsMatch -and $queryMatches) {
        return
    }

    if ($ValidateOnly) {
        if (-not $fieldsMatch) {
            Add-Issue "List '$($listDefinition.Name)': default view columns differ from the expected set."
        }
        if (-not $queryMatches) {
            Add-Issue "List '$($listDefinition.Name)': default view filter differs from the expected query."
        }
        return
    }

    Set-PnPView -List $listDefinition.Name -Identity $view.Id -Fields $expectedFields | Out-Null

    if ($listDefinition.ContainsKey("DefaultViewQuery")) {
        # Soft-deleted absences and cancelled requests are invisible to the application. Without
        # this filter the list shows a person records the application considers gone.
        Set-PnPView -List $listDefinition.Name -Identity $view.Id -Values @{ ViewQuery = $listDefinition.DefaultViewQuery } | Out-Null
    }

    Add-Change "List '$($listDefinition.Name)': default view updated."
}

function Confirm-List($listDefinition) {
    Write-Host "List: $($listDefinition.Name)" -ForegroundColor Cyan

    $list = Get-PnPList -Identity $listDefinition.Name -ErrorAction SilentlyContinue

    if (-not $list) {
        if ($ValidateOnly) {
            Add-Issue "List '$($listDefinition.Name)' is missing."
            return
        }

        $list = New-PnPList -Title $listDefinition.Name -Template $listDefinition.Template -OnQuickLaunch:$false
        Set-PnPList -Identity $listDefinition.Name -Description $listDefinition.Description -EnableAttachments $false | Out-Null
        Add-Change "List '$($listDefinition.Name)' created (template: $($listDefinition.Template))."
    }

    # The Title handling runs in both directions. It used to only ever hide the column, so a list
    # that switched to UsesTitle kept the hidden Title it was provisioned with and no run repaired
    # it — on an Events list that means a calendar of blank blocks.
    $titleField = Get-PnPField -List $listDefinition.Name -Identity "Title" -ErrorAction SilentlyContinue

    if ($titleField) {
        if ($listDefinition.UsesTitle) {
            # On an Events list Title is the label the calendar view draws in the month and week
            # grid. There is no second column SharePoint would fall back to, so it stays visible
            # and required for both writers.
            if ($titleField.Hidden -or -not $titleField.Required) {
                if ($ValidateOnly) {
                    Add-Issue "List '$($listDefinition.Name)': built-in Title must be visible and required; it is the label shown in the calendar and the item form."
                }
                else {
                    Set-PnPField -List $listDefinition.Name -Identity "Title" -Values @{ Required = $true; Hidden = $false } | Out-Null
                    Add-Change "List '$($listDefinition.Name)': built-in Title set to visible/required."
                }
            }
        }
        elseif ($titleField.Required -or -not $titleField.Hidden) {
            if ($ValidateOnly) {
                Add-Issue "List '$($listDefinition.Name)': built-in Title should not be required or visible."
            }
            else {
                Set-PnPField -List $listDefinition.Name -Identity "Title" -Values @{ Required = $false; Hidden = $true } | Out-Null
                Add-Change "List '$($listDefinition.Name)': built-in Title set to optional/hidden."
            }
        }
    }

    if ($listDefinition.ContainsKey("BuiltInFieldAdjustments")) {
        foreach ($builtInField in $listDefinition.BuiltInFieldAdjustments) {
            Confirm-BuiltInField -listDefinition $listDefinition -builtInDefinition $builtInField
        }
    }

    foreach ($fieldDefinition in $listDefinition.Fields) {
        Confirm-Field -listDefinition $listDefinition -fieldDefinition $fieldDefinition
    }

    Confirm-RetiredFields -listDefinition $listDefinition
    Confirm-RetiredItems -listDefinition $listDefinition
    Confirm-Versioning -listDefinition $listDefinition
    Confirm-DefaultView -listDefinition $listDefinition

    foreach ($compoundKey in $listDefinition.ApplicationEnforcedKeys) {
        Write-Host "  [NOTE] Unique key '$compoundKey' must be validated in the application save pipeline." -ForegroundColor DarkGray
    }
}

# --- Connect -----------------------------------------------------------------

Write-Host "Connecting to SharePoint site: $SiteUrl" -ForegroundColor Cyan
if ($UseCurrentConnection) {
    Write-Host "  Using existing PnP connection (-UseCurrentConnection)" -ForegroundColor Gray
}
else {
    if ($DeviceLogin) {
        Connect-PnPOnline -Url $SiteUrl -ClientId $ClientId -DeviceLogin
    }
    else {
        Connect-PnPOnline -Url $SiteUrl -ClientId $ClientId -Interactive
    }
}

$web = Get-PnPWeb
Write-Host "Connected to: $($web.Url)" -ForegroundColor Green
Write-Host ("Mode: {0}" -f ($ValidateOnly ? "validate only" : "provision")) -ForegroundColor Cyan
Write-Host ("Retired field removal: {0}" -f ($RemoveRetiredFields ? "enabled" : "report only")) -ForegroundColor Cyan
Write-Host ""

# --- Run ---------------------------------------------------------------------

foreach ($listDefinition in $listDefinitions) {
    Confirm-List $listDefinition
    Write-Host ""
}

# --- Summary -----------------------------------------------------------------

Write-Host "Summary" -ForegroundColor Cyan
Write-Host "  Changes: $($script:changes.Count)"
Write-Host "  Issues:  $($script:issues.Count)"

if ($script:issues.Count -gt 0) {
    Write-Host ""
    Write-Host "Issues found:" -ForegroundColor Yellow
    $script:issues | ForEach-Object { Write-Host "  - $_" -ForegroundColor Yellow }
    exit 1
}

Write-Host ""
Write-Host ($ValidateOnly ? "Validation passed: site matches the provisioning schema." : "Provisioning completed.") -ForegroundColor Green
exit 0
