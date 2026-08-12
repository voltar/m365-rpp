import type { ApprovalPolicy } from "../models/approval";

export const mockApprovalPolicies: readonly ApprovalPolicy[] = [
  {
    id: "approval-policy-platform-employee",
    teamId: "platform-services",
    plannerRole: "employee",
    approvalRequired: true,
    enabled: true,
    description: "Platform Services employees require an explicitly configured Microsoft Approval."
  },
  {
    id: "approval-policy-platform-team-lead",
    teamId: "platform-services",
    plannerRole: "teamLead",
    approvalRequired: true,
    enabled: true,
    description: "Platform Services team leads require an explicitly configured department-head approval."
  },
  {
    id: "approval-policy-platform-department-head",
    teamId: "platform-services",
    plannerRole: "departmentHead",
    approvalRequired: false,
    enabled: true,
    description: "Department heads can plan directly by default."
  },
  {
    id: "approval-policy-organisation-b-collaboration-employee",
    teamId: "organisation-b-collaboration",
    plannerRole: "employee",
    approvalRequired: false,
    enabled: true,
    description: "Organisation-B collaboration team members can plan directly."
  },
  {
    id: "approval-policy-default-employee",
    teamId: "default",
    plannerRole: "employee",
    approvalRequired: true,
    enabled: true,
    description: "Default policy for new teams: employees require approval."
  },
  {
    id: "approval-policy-default-department-head",
    teamId: "default",
    plannerRole: "departmentHead",
    approvalRequired: false,
    enabled: true,
    description: "Default policy for new teams: department heads can plan directly."
  },
  {
    id: "approval-policy-default-guest",
    teamId: "default",
    plannerRole: "guest",
    approvalRequired: false,
    enabled: true,
    description: "Default policy for new teams: guests can plan directly."
  }
];
