# Microsoft 365 Approval Setup (EO-410 / EO-207)

This document describes how live Microsoft 365 Approvals are wired up in the Resource & Presence Planner (RPP).

> **Current default (EO-410 Graph provider, `planningDataSource=api`): no Power Automate at all.** The RPP Web API creates Microsoft Approvals directly via the Graph approval solutions API (beta) — no flow, no premium license, no callback secret. The Power Automate variants below remain as documented alternatives.

## EO-410 Graph provider (default, RC1)

```
SPA ── POST /api/planning/vacationrequests ─────────────▶ RPP Web API ── SQL
SPA ── POST /api/planning/vacationrequests/{id}/start-approval ─▶ RPP Web API
                                                             │ OBO (Teams SSO → ApprovalSolution.ReadWrite)
                                                             ▼
                                            Graph beta /solutions/approval/approvalItems
                                                             │ approver decides in the Teams Approvals app
SPA ── GET /api/planning/vacationrequests (refresh) ──▶ API syncs pending items against Graph,
                                                        applies decision, updates linked absence
```

### Setup steps (Graph provider)

1. Run `scripts/configure-graph-approvals.ps1` once (adds the delegated Graph permission `ApprovalSolution.ReadWrite` to the RPP app registration and grants admin consent).
2. API configuration: `GraphApprovals:Enabled=true` (already the appsettings default).
3. Frontend configuration (`public/config/runtime-config.js`): `approvalMode: "m365"`.
4. Apply the EF migrations (`dotnet ef database update`) and deploy the API.

Notes: the Graph API is **beta** (Microsoft may change it; not supported for production per Microsoft's beta policy — accepted for RC1 per PO decision). Approvals are created in the requester's delegated context; decision sync happens when the app reloads vacation requests.

## EO-410 Architecture (API-based, RC1)

```
SPA ── POST /api/planning/vacationrequests ────────────▶ RPP Web API ── SQL
SPA ── POST /api/planning/vacationrequests/{id}/start-approval ─▶ RPP Web API
                                                             │ POST flow URL (server-side)
                                                             ▼
                                                   Power Automate Flow
                                                             │ Create approval (Microsoft Approvals)
RPP Web API ◀── 200 { approvalReferenceId, flowRunId } ──────┤
                                                             │ decision in Teams / Approvals app
                                                             ▼
RPP Web API ◀── POST /api/approvals/callback (X-RPP-Approval-Secret) ── decision writeback
     │ VacationRequests row updated; approved ⇒ approved Absences row
SPA ── GET /api/planning/vacationrequests (refresh) ──▶ decision visible
```

### Setup steps (EO-410)

1. Import/build the flow from `docs/rpp-approval-flow-eo410.json` (HTTP trigger → Create approval → Response → HTTP callback).
2. Replace the blueprint placeholders:
   - `{{apiBaseUrl}}` → `https://rpp-api.example.com`
   - `{{callbackSecret}}` → a generated shared secret (e.g. 32+ random characters)
3. Configure the API (user secrets locally, app settings on Azure — EO-409):
   - `ApprovalFlow:Enabled` = `true`
   - `ApprovalFlow:FlowUrl` = the HTTP trigger URL of the flow
   - `ApprovalFlow:CallbackSecret` = the same shared secret
4. Frontend configuration (`public/config/runtime-config.js`): `approvalMode: "m365"` — no flow URL and no SharePoint site needed in the client.
5. Apply the EF migration `EO410_VacationRequestApprovalFields` (`dotnet ef database update`) and deploy the API.

Without `ApprovalFlow` configuration the start-approval endpoint returns 503 and the frontend falls back to the mock workflow with a logged warning.

---

## EO-207 Architecture (SharePoint-based, legacy `sharepoint` data source)

The static SPA cannot receive HTTP callbacks. Therefore the approval decision path is **pull-based**:

```
RPP App ── POST ──▶ Power Automate Flow (HTTP trigger)
                         │
                         ▼
               Create Approval (Microsoft Approvals connector)
                         │
                         ▼
               Synchronous response with approvalReferenceId + flowRunId
                         │
                         ▼
               (Approval decision happens in Teams / Approvals app)
                         │
                         ▼
               Flow writes decision back to SharePoint list `VacationRequests`
                         │
RPP App ◀── manual refresh / repository read ── SharePoint `VacationRequests`
```

Only **approved** requests are persisted as absences in the planning engine.

## Power Automate Flow Definition

### Trigger
- **HTTP** (POST)
- Request Body JSON Schema (must match `PowerAutomateApprovalInput`):

```json
{
  "type": "object",
  "properties": {
    "requestId": { "type": "string" },
    "teamId": { "type": "string" },
    "userId": { "type": "string" },
    "userDisplayName": { "type": "string" },
    "absenceType": { "type": "string" },
    "startDate": { "type": "string", "format": "date" },
    "startHalf": { "type": "string", "enum": ["fullDay", "morning", "afternoon"] },
    "endDate": { "type": "string", "format": "date" },
    "endHalf": { "type": "string", "enum": ["fullDay", "morning", "afternoon"] },
    "comment": { "type": "string" },
    "commentToApprover": { "type": "string" },
    "policyId": { "type": "string" },
    "routingRuleId": { "type": "string" },
    "approverId": { "type": "string" }
  },
  "required": ["requestId", "teamId", "userId", "userDisplayName", "absenceType", "startDate", "endDate", "policyId", "routingRuleId", "approverId"]
}
```

### Actions

1. **Create an approval** (Microsoft Approvals connector)
   - Title: `Ferienantrag / Vacation Request - {{userDisplayName}} ({{startDate}} - {{endDate}})`
   - Assigned to: `approverId` (or lookup from Graph if needed)
   - Details: include request data, commentToApprover, link back to RPP (if Teams deep link available)

2. **Parse JSON** from the approval response to extract `approvalReferenceId` and `flowRunId`.

3. **Respond to HTTP request** immediately with:
   ```json
   {
     "requestId": "...",
     "approvalReferenceId": "...",
     "flowRunId": "...",
     "status": "pendingApproval"
   }
   ```

4. **Wait for approval outcome** (parallel branch or "When an approval is completed" trigger – but since we use the synchronous pattern, the flow continues after the first response).

5. **Update SharePoint item** in list `VacationRequests`:
   - Match by `RequestId`
   - Set fields: `Status`, `DecisionBy`, `DecisionDate`, `DecisionComment`, `ApprovalReferenceId`, `FlowRunId`

### Response Contract (`PowerAutomateApprovalOutput`)
See `src/models/approval.ts`.

## Configuration in RPP

Set in `runtime-config.js` (or via App Admin + local override):

```js
window.__RESOURCE_PRESENCE_PLANNER_CONFIG__ = {
  "approvalMode": "m365",
  "approvalFlowUrl": "https://prod-XYZ.logic.azure.com/workflows/...", 
  "sharePointSiteUrl": "https://organisation-a.sharepoint.com/sites/rpp"
};
```

The flow URL must be on `*.logic.azure.com` or `*.api.powerplatform.com`.

## Permissions

- Flow needs `Sites.ReadWrite.All` (or minimal SharePoint write permissions on the `VacationRequests` list).
- RPP Teams App needs `Sites.ReadWrite.All` delegated/application permission (already documented in EO-207).

## Testing

- Use `approvalMode=mock` for development (full simulation remains available).
- Switch to `m365` only when flow + SharePoint list are ready.
- Decision made in Microsoft Teams Approvals app must appear in RPP after manual status refresh.

## Future Extensions

- Multi-stage approvals
- Delegation & reminders (stay in Microsoft Approvals)
- Automatic polling (EO-109 "Sync is Explicit" principle respected for now)

Last updated: 2026-07-15 (EO-207 completion)

## Implementation Artifact

For implementation handover in Power Automate Designer, use:

- `docs/rpp-approval-flow.json`

This artifact contains a step-by-step blueprint aligned to EO-207 contracts and the `VacationRequests` writeback model.