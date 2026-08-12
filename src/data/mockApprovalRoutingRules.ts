import type { ApprovalRoutingRule } from "../models/approval";

export const mockApprovalRoutingRules: readonly ApprovalRoutingRule[] = [
  {
    id: "approval-routing-platform-gianni",
    teamId: "platform-services",
    requesterUserId: "gianni-zanetti",
    approverUserId: "department-head-platform",
    approvalRequired: true,
    enabled: true
  },
  {
    id: "approval-routing-platform-department-head",
    teamId: "platform-services",
    requesterUserId: "department-head-platform",
    approvalRequired: false,
    enabled: true
  }
];
