# M365 Ressourcen & Präsenzplanung (RPP)
## Code and Architecture Quality Review

This document contains a general review of the code and architecture quality for the **M365 Ressourcen & Präsenzplanung (RPP)** application, analyzing both the React TypeScript frontend and the ASP.NET Core (`RppWebApi`) backend. It outlines current strengths, identifies core quality and architectural concerns (with specific code references), and details actionable proposals to improve the system's robustness, performance, and maintainability.

---

## 1. Architectural Strengths

The codebase demonstrates several strong architectural patterns aligned with the project's vision of an enterprise-grade Microsoft Teams application:

* **Clean Separation of Concerns**: The application uses a well-defined layered architecture:
  * **UI Components** (`src/components/`, `src/features/`): Focus strictly on rendering and user interaction using Fluent UI components.
  * **Service Boundary** (`src/services/`): Houses the business logic (capacity calculations, absence duration tracking, approval integration).
  * **Repositories** (`src/repositories/`): Abstract data access through clear TypeScript interfaces. The application supports switching between `mock`, `sharepoint`, and `api` providers dynamically without affecting UI components.
* **Route-Based Lazy Loading**: Heavy pages (Timeline, Capacity, Settings, etc.) are lazy-loaded with navigation preloading on hover, ensuring the app shell remains responsive and lightweight.
* **Structured Observability**: A centralized logger service and user-friendly global React Error Boundaries prevent application-wide crashes, ensuring that errors are logged with diagnostic context and correlation IDs.
* **Clean Database Seeding**: The backend data seeder automatically fetches real M365 Graph member IDs in development mode to seed demo absences and balances, removing legacy mock resource IDs and keeping dev data realistic.

---

## 2. Key Findings & Quality Concerns

### 2.1. Working-Day Discrepancy (Business Logic Gap)
There is a discrepancy in how working days are calculated between the timeline capacity engine and the absence duration tracking.
* **Capacity Engine**: [capacityEngine.ts:L125-130](../../src/services/capacityEngine.ts) checks the resource's profile-specific working days:
  ```typescript
  function isConfiguredWorkingDay(resource: ResourceSummary, dateKey: string): boolean {
    const date = new Date(`${dateKey}T00:00:00`);
    const workingDays = resource.workingDays ?? defaultWorkingDays;
    return workingDays.includes(date.getDay());
  }
  ```
* **Absence Calculations**: [absenceCalculations.ts:L264-269](../../src/services/absenceCalculations.ts) hardcodes the standard Monday-to-Friday calendar, ignoring the resource's configured working days or part-time assignments:
  ```typescript
  function isWorkingDay(dateKey: string): boolean {
    const date = new Date(`${dateKey}T00:00:00`);
    const day = date.getDay();
    return day !== 0 && day !== 6 && !publicHolidayDates.has(dateKey);
  }
  ```
> [!WARNING]
> **Impact**: If a part-time employee who works Monday-to-Thursday takes a full week of vacation, the absence duration will be calculated as **5.0 days** instead of **4.0 days**, resulting in incorrect vacation balance deductions.

### 2.2. N+1 Database Query Pattern in Backend Repository
In `EfPlanningRepository.cs`, saving member assignments uses an inefficient query pattern within a loop.
* **Code Reference**: [EfPlanningRepository.cs:L279-289](../../RppWebApi/Data/EfPlanningRepository.cs)
  ```csharp
  foreach (var patch in saveRequest.MemberAssignments)
  {
      if (string.IsNullOrWhiteSpace(patch.UserId)) continue;

      var existingRows = await _context.MemberAssignments
          .Where(row => row.UserId == patch.UserId)
          .ToListAsync();
      _context.MemberAssignments.RemoveRange(existingRows);
  ```
> [!WARNING]
> **Impact**: If a team administrator saves changes for a team of 30 members, this method will execute 30 separate `SELECT` queries and 30 separate `DELETE` operations sequentially. This increases latency and database load, failing to utilize EF Core's batching capabilities.

### 2.3. Unvalidated ESLint Rules & Code Warnings
Running a manual lint check (`npm run lint`) fails with **31 errors**:
* **TypeScript Types**: Multiple files bypass strict typing by casting variables using `as any` (e.g., in [apiPlanningRepositories.ts](../../src/repositories/apiPlanningRepositories.ts) and [planningDataService.ts](../../src/services/planningDataService.ts)), violating the strict typing rule in `AGENTS.md`.
* **Unused Variables**: Redundant imports and unused parameters/variables are left in files like [mockPlanningRepositories.ts](../../src/repositories/mockPlanningRepositories.ts).
* **Pipeline Gap**: The deployment validation script (`npm run build:deployment`) compiles TypeScript but does not run `eslint`, allowing code with lint errors to bypass build-time validation.

### 2.4. DOM Node Scale Limit (Timeline Grid Virtualization)
The Gantt timeline grid is rendered as a flat CSS Grid layout.
* **Code Reference**: [TimelineRow.tsx:L32-42](../../src/components/timeline/TimelineRow.tsx)
  For every resource and day, a dedicated `<button>` element is generated.
> [!IMPORTANT]
> **Impact**: While performing well for 30 resources over 90 days (~2,700 grid elements), scaling the timeline to a full-year view with 100+ resources generates **36,500+ button elements** in the DOM. Without row/column virtualization, this will cause scroll lag and browser memory issues on lower-spec machines.

### 2.5. Missing Automated Testing Suite
There are currently **no automated test suites** configured in either the React frontend or the .NET Core backend.
* Core business rules—including capacity calculations, public holiday region filtering, and vacation balances—rely entirely on manual browser verification.
* Any future refactoring of data structures poses a high regression risk without unit testing.

### 2.6. Incomplete API Implementations (Backend Repositories)
The `EfPlanningRepository` includes several stubbed-out endpoints with `TODO` markers.
* **Code Reference**: [EfPlanningRepository.cs:L95-123](../../RppWebApi/Data/EfPlanningRepository.cs)
  `GetPlanningEventsAsync`, `GetPlanningSettingsAsync`, and `GetVacationRequestsAsync` return hardcoded empty lists or objects. 
* This leaves gap areas in Phase 2B development when switching fully to the API provider.

---

## 3. Actionable Proposals for Improvement

To address these findings and transition the application into a production-ready system, we propose the following improvements:

### Proposal A: Unify and Fix Working-Day Logic
Modify `calculateAbsenceDuration` to accept the resource's profile (containing `workingDays`) or a lookup function, ensuring absence calculations match capacity evaluations.
```diff
-export function calculateAbsenceDuration(draft: Pick<AbsenceDraft, "startDate" | "startHalf" | "endDate" | "endHalf">): number {
+export function calculateAbsenceDuration(
+  draft: Pick<AbsenceDraft, "startDate" | "startHalf" | "endDate" | "endHalf">,
+  resourceWorkingDays?: readonly number[]
+): number {
   ...
-  const dates = enumerateDates(draft.startDate, draft.endDate).filter(isWorkingDay);
+  const dates = enumerateDates(draft.startDate, draft.endDate).filter(d => 
+    isWorkingDay(d, resourceWorkingDays)
+  );
```

### Proposal B: Optimize EF Core Bulk Operations
Refactor `SaveTeamAdminChangesAsync` in `EfPlanningRepository.cs` to fetch all existing assignments in a single query and perform a bulk delete using user ID lists.
```csharp
// Fetch all user ids being modified
var userIds = saveRequest.MemberAssignments.Select(m => m.UserId).Where(id => !string.IsNullOrEmpty(id)).ToList();

// Single query to retrieve all existing assignments
var existingRows = await _context.MemberAssignments
    .Where(row => userIds.Contains(row.UserId))
    .ToListAsync();

_context.MemberAssignments.RemoveRange(existingRows);
```

### Proposal C: Integrate Lint Checks and Resolve Errors
1. Clean up the unused variables and replace `as any` type-casts with proper interface structures or type assertion guards.
2. Update the `build:deployment` command in [package.json](../../package.json) to include the linter, preventing deployment builds from succeeding if code hygiene rules are violated:
   ```diff
   -"build:deployment": "npm run build && npm run validate:deployment && npm run validate:security",
   +"build:deployment": "npm run lint && npm run build && npm run validate:deployment && npm run validate:security",
   ```

### Proposal D: Introduce Automated Testing (Vitest & xUnit)
1. Add **Vitest** to the React app to test `absenceCalculations.ts` and `capacityEngine.ts` against edge cases (e.g., half-day transitions, holiday collisions).
2. Add an **xUnit** project to `RppWebApi` to test controller routing, EF mapping configuration, and repository CRUD logic.

### Proposal E: Prepare for Viewport Virtualization
To support enterprise scaling (Organisation-A and Organisation-B collaboration calendars), introduce row-level virtualization (using `@tanstack/react-virtual` or a lightweight custom scroll window) to only render visible employee timeline rows.
