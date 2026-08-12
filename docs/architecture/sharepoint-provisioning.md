# SharePoint List Provisioning

EO-110 provides a repeatable way to create the RPP planning lists in a SharePoint Online site. It materialises the information architecture (see [sharepoint-information-architecture.md](sharepoint-information-architecture.md)), extended per EO-110 so the field set matches the current application contracts. The typed schema in `src/models/sharePointInformationArchitecture.ts` documents the intended shape; the provisioning script now carries both the existing SharePoint repository fields and the EF-aligned companion fields where those contracts still differ.

## Prerequisites

- PowerShell 7 or later.
- The [PnP.PowerShell](https://pnp.github.io/powershell/) module:

  ```powershell
  Install-Module PnP.PowerShell -Scope CurrentUser
  ```

- An existing SharePoint Online site (the script does not create sites).
- Permission to create lists on that site (site owner or higher).
- An Entra ID app registration for PnP.PowerShell interactive login. PnP.PowerShell no longer ships a multi-tenant app id, so each tenant registers its own once:

  ```powershell
  Register-PnPEntraIDAppForInteractiveLogin -ApplicationName "RPP Provisioning" -Tenant contoso.onmicrosoft.com
  ```

  Note the returned application (client) id; pass it as `-ClientId`.

## Usage

Provision (idempotent — safe to re-run):

```powershell
./scripts/provision-sharepoint-lists.ps1 `
    -SiteUrl https://contoso.sharepoint.com/sites/rpp/ `
    -ClientId <your-client-id>
```

or with existing connection:

```powershell
Connect-PnPOnline -Url https://contoso.sharepoint.com/sites/rpp/ -Interactive
./scripts/provision-sharepoint-lists.ps1 -SiteUrl https://contoso.sharepoint.com/sites/rpp/ -UseCurrentConnection
```

Validate an existing site without changing anything:

```powershell
./scripts/provision-sharepoint-lists.ps1 `
    -SiteUrl https://contoso.sharepoint.com/sites/rpp `
    -ClientId <app-client-id> `
    -ValidateOnly
```

`-ValidateOnly` exits with code `1` when lists or fields are missing or a field has drifted to a different type, so it can be used as a deployment gate.

Additional options:

- `-DeviceLogin` — device-code authentication instead of the interactive browser flow.
- `-UseCurrentConnection` — reuse an existing `Connect-PnPOnline` session (no `-ClientId` needed).
- `-RemoveRetiredFields` — remove the columns EO-430 retires. Off by default; see
  [Retiring the old columns](#retiring-the-old-columns).

## What the script creates

Sixteen lists, attachments disabled, not shown on the quick launch, each with a managed default
view. The lists are an editing surface as well as a store: administrators and HR maintain data in
them directly, which is why person-valued fields are People Picker columns and why `Absences`,
`PublicHolidays` and `PlanningEvents` use the Event Calendar template.

| List | SharePoint-enforced unique key | Application-enforced unique key |
|------|-------------------------------|--------------------------------|
| Absences | — | — |
| VacationBalances | — | `UserPerson` + `Year` |
| PlanningSettings | — | `Key` + `Scope` |
| PublicHolidays | — | `Date` + `Location` |
| TeamPlanningConfiguration | `TeamId` | — |
| PlanningEvents | — | — |
| VacationRequests | `RequestId` | — |
| TeamAdminTeams | `TeamId` | — |
| TeamAdminMemberAssignments | — | `UserPerson` + `TeamId` |
| TeamAdminSettings | `TeamId` | — |
| TeamAdminAbsenceTypes | `Key` | — |
| Organisations | — | — |
| Locations | — | — |
| ProfileValueMappings | — | `Kind` + `GraphValue` |
| DisplaySettings | — | — |
| MailboxSyncConfigs | — | — |

### One column per fact (EO-430)

Field internal names are a functional contract. Earlier revisions provisioned two columns for facts
where the SharePoint read-model and the EF entities diverged. That is resolved: the EF name is the
system of record, and the other column is retired.

| List | Retired column | System of record |
|------|----------------|------------------|
| Absences | `AbsenceType` | `Type` |
| VacationRequests | `AbsenceType` | `Type` |
| VacationRequests | `OutlookGraphEventId` | `GraphEventId` |
| VacationRequests | `OutlookLastError` | `OutlookSyncError` |
| VacationBalances | `AllowanceDays` | `Entitlement` |
| VacationBalances | `CarriedOverDays` | `CarryForward` |
| VacationBalances | `ManualAdjustmentDays` | `ManualAdjustment` |
| PublicHolidays | `Region` | `Location` |

Two exceptions to the EF-name rule, both forced by the platform:

- **Timestamps.** SharePoint maintains built-in `Created` and `Modified` columns on every list, so
  application timestamps live in `CreatedAt` / `ModifiedAt`. `PlanningEvents` previously provisioned
  `Created` / `Modified` as its own fields against those built-ins; it now matches the other lists.
- **`Type` stays Text.** SharePoint cannot retype an existing column, so `Type` is not converted to
  a choice field even though a dropdown would read better in an edit form.

### People are a single User column

Where a fact names a person there is one column, of type `User`. The UID text twin is retired. The
provider translates between the Graph user id and the site user when reading and writing, so the
API contract is unchanged.

| List | Person column | Label | Retired text column(s) |
|------|---------------|-------|------------------------|
| Absences | `UserPerson` | Employee | `UserId`, `EmployeeId` |
| Absences | `SubstitutePerson` | Substitute | `Substitute` |
| VacationBalances | `UserPerson` | Employee | `UserId`, `EmployeeId` |
| PlanningEvents | `ResourcePerson` | Resource | `ResourceId`, `EmployeeId` |
| VacationRequests | `UserPerson` | Requester | `UserId`, `EmployeeId` |
| VacationRequests | `ApproverPerson` | Approver | `ApproverUserId`, `ApproverId` |
| VacationRequests | `DecisionByPerson` | Decided by | `DecisionBy` |
| TeamPlanningConfiguration | `DefaultApproverPerson` | Default approver | `DefaultApproverId` |
| TeamPlanningConfiguration | `BackupApproverPerson` | Backup approver | `BackupApproverId` |
| TeamAdminMemberAssignments | `UserPerson` | Member | `UserId` |
| TeamAdminMemberAssignments | `EffectiveApproverPerson` | Effective approver | `EffectiveApproverUserId` |
| TeamAdminSettings | `TeamLeadPerson` | Team lead | `TeamLeadUserId` |
| TeamAdminSettings | `DefaultApproverPerson` | Default approver | `DefaultApproverUserId` |
| TeamAdminSettings | `BackupApproverPerson` | Backup approver | `BackupApproverUserId` |

The internal names keep their `*Person` suffix because those columns already exist with the correct
type on sites provisioned with the former `-EnablePeoplePickerFields`, and SharePoint cannot retype
a column. Readable labels are set as display names instead, so the internal name stays a stable
contract.

`CreatedBy` and `ModifiedBy` are retired on every list in favour of SharePoint's built-in `Author`
and `Editor`, which hold the same fact, are already populated, and are correct whether the
application or a person made the change.

### Retiring the old columns

**A new installation never needs this.** A customer's lists are empty when the installation is
ordered, so a fresh site is provisioned in the current shape from the first run and carries no
retired columns at all. What follows applies to sites provisioned under the earlier schema — in
practice the development tenant.

The script never removes a column on its own — such a site may still hold data in one. Retired columns
that are still present are reported as drift, and `-RemoveRetiredFields` removes them once their
data has been migrated:

```powershell
./scripts/provision-sharepoint-lists.ps1 `
    -SiteUrl https://contoso.sharepoint.com/sites/rpp `
    -UseCurrentConnection `
    -RemoveRetiredFields
```

### What is never stored

- **Calculated vacation values.** `ApprovedVacationDays`, `PendingVacationDays`, `RemainingDays` and
  their EF-named twins are retired. Booked, pending and remaining days are computed by the capacity
  engine. Visible and editable in a list, they invite a figure the application ignores.
- **Display names.** `UserDisplayName` is retired from `VacationRequests`. A `User` column stores a
  lookup into the site's User Information List and renders the current name from it, so people read
  names without the application storing one.
- **Employee master data.** `DisplayName`, `Email`, `JobTitle`, `Department` and team membership
  come from Microsoft Graph and are forbidden in SharePoint (EO-101).
- **Employee data disguised as a setting.** The `ResourceProfiles` item in `PlanningSettings` held a
  JSON array of `{ employeeId, employmentRate, workingDays }`. Graph ids inside a text value cannot
  be a People Picker column, and a JSON blob is not something a person edits. `employmentRate` is
  `TeamAdminMemberAssignments.EmploymentPercentage`, which is authoritative; `workingDays` moved to
  the same list as a comma-separated list of ISO weekday numbers. The item is reported as retired —
  the script does not delete list items, only columns.

Other type mapping notes:

- `Comment` and `Value` are multi-line text (`Note`) because they hold free text or JSON.
- `StartHalf` / `EndHalf` are strict choices: `morning`, `afternoon`, `fullDay`.
- `ApprovalStatus` is a strict choice; on `Absences` it is required with default `approved`, on
  `PlanningEvents` optional.
- Date fields (`StartDate`, `EndDate`, `Date`) are date-only.
- The built-in `Title` column is optional and hidden on every list except the three Events
  calendars — `Absences`, `PublicHolidays` and `PlanningEvents` — where it is visible and required.
  On a calendar `Title` is the label drawn in the month and week grid, and SharePoint has no second
  column to fall back on: a hidden `Title` renders a manually created entry as a blank block. It
  carries no application fact; the provider composes one, as a person typing an entry does.
- **Item versioning** is on for every list with 10 major versions retained, and is validated like
  the rest of the schema. It is the audit trail for both writers (EO-430), so the script asserts it
  rather than relying on the tenant default. Where a tenant has automatic version expiration
  enabled, the script turns it off — it would otherwise override the retention figure published
  here.
- `PublicHolidays.IsSchoolHoliday` is derived by the provider from `Location` and is therefore
  optional. Full-day blocking uses the Events template built-in `fAllDayEvent`.

## Constraints

- SharePoint enforces uniqueness only on a single indexed column. Compound keys are validated by the
  application before writing; the script prints a note per affected list.
- The script never retypes an existing column. Type drift is reported and must be resolved manually.
- Column display names are per-site and single-language. This is the one surface in the product
  where the localization rule in `AGENTS.md` cannot be met the usual way.
- List permissions are not team-scoped: whoever can open a list sees every team in it. Access rests
  on SharePoint permissions alone, with no application-side scoping (EO-430).

## After provisioning

1. Set the store on the API: `Planning:Provider = sharepoint` (EO-430, ADR-002). This is a
   different switch from the frontend's `planningDataSource`, which stays `api` — the browser never
   talks to SharePoint in this profile.
2. Verify with `GET /health`, which reports the active store as `planningStore`.
3. Run `-ValidateOnly` as a release gate; the API also validates the site's schema on startup and
   refuses to start on drift.

**Status:** the server-side SharePoint provider is not implemented yet. `Planning:Provider =
sharepoint` is a recognised value that currently refuses startup with a named message, so a
deployment cannot come up believing it is SharePoint-backed while the provider is still unwritten.
The browser-direct provider (`planningDataSource = sharepoint`) remains read-only and covers 6 of
the 16 lists; it is an evaluation path, not a deployment profile.
