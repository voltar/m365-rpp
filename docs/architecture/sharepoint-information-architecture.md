# SharePoint Information Architecture

EO-101 defines SharePoint Online as the persistence store for planning-specific facts only. EO-110 extends the architecture so that the SharePoint backend covers the same planning facts as the mock reference implementation (`PlanningEvents` list, `ApprovalStatus` field); where the original EO-101 field set and the mock differ, **the mock is the reference**.

Microsoft Teams and Microsoft Graph remain authoritative for people, identities, and memberships. SharePoint must not become a second employee database.

## Lists

| List | Purpose | Identity Reference |
|------|---------|--------------------|
| Absences | Stores absence facts | `UserPerson` → Microsoft Graph user id |
| VacationBalances | Stores vacation allowance facts | `UserPerson` → Microsoft Graph user id |
| PlanningSettings | Stores global planning key/value settings | none |
| PublicHolidays | Stores holiday facts | none |
| TeamPlanningConfiguration | Stores team planning configuration | `TeamId` = Microsoft Teams team / M365 Group id |
| PlanningEvents | Stores non-absence planning events | `ResourcePerson` → Microsoft Graph user id |

These six are the EO-101 core. The provisioning script covers sixteen lists in total, including the
vacation request lifecycle and the team administration tables; see
[sharepoint-provisioning.md](sharepoint-provisioning.md) for the full set.

## How a Person Is Stored (EO-430)

Person-valued facts are a single SharePoint `User` column. There is no UID text twin.

A `User` column does not hold a name — it holds a lookup into the site collection's User Information
List, from which SharePoint renders the current display name. The stable directory id is one hop
away: `/_api/web/getuserbyid({lookupId})` returns `UserId.NameId` (issuer
`urn:federation:microsoftonline`), the Entra object id, also exposed as `AadObjectId`. The provider
translates between that id and the site user at the storage boundary, so the application still works
in Graph user ids throughout.

This is what allows people to read names in a list while the application stores none, which is the
point of *Explicitly Not Stored* below. It also means a `User` column cannot be filtered by Graph
user id: OData filters person columns by the site-collection lookup id, so an employee-scoped query
resolves first and then filters.

An entry that cannot be matched to a directory identity — a departed employee, a guest, a manually
typed value — keeps its SharePoint display value and is returned as an employee the application
cannot link. It is never dropped from a read, and never fails a write.

## Absences

Fields:

- `Id`
- `UserPerson` (User)
- `Type`
- `StartDate`
- `StartHalf`
- `EndDate`
- `EndHalf`
- `Comment`
- `SubstitutePerson` (User)
- `Status`
- `ApprovalStatus`
- `CreatedAt`
- `ModifiedAt`

`UserPerson` and `SubstitutePerson` resolve to Microsoft Graph user ids. Names, e-mail addresses,
organization, and team membership are not stored.

`CreatedBy` and `ModifiedBy` are not application columns: SharePoint's built-in `Author` and
`Editor` hold that fact and are correct whether the application or a person made the change.

## VacationBalances

Fields:

- `Id`
- `UserPerson` (User)
- `Year`
- `Entitlement`
- `CarryForward`
- `ManualAdjustment`
- `Comment`

Booked days, pending days and remaining days are calculated by the application from absences and are
not persisted. Columns that once held them are retired — visible and editable in a list, they invite
a figure the application ignores.

## PlanningSettings

Fields:

- `Id`
- `Key`
- `Value`
- `Scope`
- `Description`

Examples:

- `DefaultVacationAllowance`
- `CapacityWarningThreshold`
- `CapacityCriticalThreshold`
- `DefaultPlanningRangeWeeks`

## PublicHolidays

Fields:

- `Id`
- `Date`
- `Title`
- `Location`
- `IsSchoolHoliday` (derived by the provider from `Location`)

Full-day blocking uses the Event Calendar built-in `fAllDayEvent` rather than a column of its own.

## TeamPlanningConfiguration

Fields:

- `Id`
- `TeamId`
- `PlanningName`
- `DefaultView`
- `DefaultCapacityThreshold`

`TeamId` references the Microsoft Teams team or M365 Group id.

## PlanningEvents

Fields:

- `Id`
- `ResourcePerson` (User)
- `Type`
- `Title`
- `StartDate`
- `StartHalf`
- `EndDate`
- `EndHalf`
- `AbsenceId`
- `ApprovalStatus`
- `CreatedAt`
- `ModifiedAt`

`ResourcePerson` resolves to a Microsoft Graph user id. Application timestamps are `CreatedAt` /
`ModifiedAt`, never `Created` / `Modified`, which are SharePoint built-ins on every list. `Type`
covers the `PlanningEventType` union (vacation, compensation, education, training, military, unpaidLeave, otherAbsence, homeOffice, project, maintenance, onCall, standby). `AbsenceId` optionally links an event to its originating `Absences` item.

## Explicitly Not Stored

SharePoint does not store:

- `DisplayName`
- `Email`
- `Avatar`
- `JobTitle`
- `Department`
- `TeamMembership`

These values come from Microsoft Graph.

**`UserDisplayName` on `VacationRequests` was the one breach of this rule and is retired (EO-430).**
It duplicated a fact Graph owns, went stale the moment a person married, transferred or had a typo
corrected, and put personal data in a store scoped to hold none. People still read names in the
list, because a `User` column renders the current one from the directory-backed User Information
List without the application storing a string. In the application, the requester's name is resolved
from Graph at read time.

The approval title and body sent to Microsoft Approvals still carry the requester's name. That value
is supplied with the request and used before anything is stored — an approver must read a name, not
a Graph id.

## Typed Schema

The typed schema lives in `src/models/sharePointInformationArchitecture.ts` and is intended as the contract for EO-102 repository mapping.

## Technical Constraints

EO-101-A refines the list architecture with unique keys, indexes, searchable fields, and reference strategy.

### Unique Keys

| List | Unique Key | Rule |
|------|------------|------|
| VacationBalances | `UserPerson` + `Year` | One vacation balance per user and calendar year |
| PublicHolidays | `Date` + `Location` | One holiday per date and location |
| PlanningSettings | `Key` + `Scope` | One setting value per key and scope |
| TeamPlanningConfiguration | `TeamId` | One planning configuration per Microsoft Teams team / M365 Group |

`Absences` and `PlanningEvents` have no business-level unique key beyond the item id because multiple records per user and date range are valid facts.

### Indexes

Minimum indexes:

- `Absences`: `UserPerson`, `StartDate`, `EndDate`
- `VacationBalances`: `UserPerson`, `Year`
- `PublicHolidays`: `Date`, `Location`
- `PlanningSettings`: `Key`, `Scope`
- `TeamPlanningConfiguration`: `TeamId`
- `PlanningEvents`: `ResourcePerson`, `StartDate`, `EndDate`

### Searchable Fields

Searchable fields are technical lookup fields, not duplicated identity fields:

- `Absences`: `UserPerson`, `Type`, `StartDate`, `EndDate`
- `VacationBalances`: `UserPerson`, `Year`
- `PlanningSettings`: `Key`, `Scope`
- `PublicHolidays`: `Date`, `Location`, `Title`
- `TeamPlanningConfiguration`: `TeamId`, `PlanningName`
- `PlanningEvents`: `ResourcePerson`, `Type`, `StartDate`, `EndDate`

### Reference Strategy

All user references use the stable Microsoft Graph user id.

No relationships use:

- Display name
- Mail address
- UPN

Team references use the Microsoft Teams team id / M365 Group id.

EO-101 and EO-101-A do not implement SharePoint Lists, repositories, CRUD, Graph calls, UI, migration, or Outlook sync.

### Duplicate Columns (resolved by EO-430)

Earlier revisions provisioned two columns wherever the SharePoint read-model and the EF entities
diverged — `UserId` beside `EmployeeId`, `AbsenceType` beside `Type`, `Region` beside `Location`.
That was workable for a read-only consumer and is not for a writer: every write would have to choose
or write both, and no read could then say which column held the truth. The EF name is the system of
record; the other is retired. Two exceptions are forced by the platform — application timestamps use
`CreatedAt` / `ModifiedAt` because `Created` / `Modified` are built-ins, and `Type` stays a text
column because SharePoint cannot retype an existing one.

## Provisioning

EO-110 provides `scripts/provision-sharepoint-lists.ps1`, an idempotent PnP.PowerShell script that creates and validates these lists in a SharePoint site. See [sharepoint-provisioning.md](sharepoint-provisioning.md).
