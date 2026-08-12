import type { ResourceSummary } from "../models/resource";

export const mockResources: readonly ResourceSummary[] = [
  {
    id: "resource-alex-mueller",
    displayName: "Alex Mueller",
    initials: "GZ",
    organization: "Organisation-A",
    primaryTeam: "SQL",
    additionalTeams: ["M365 Platform", "PKI", "Lehrlingsbetreuung"],
    vacation: { annualEntitlement: 25, booked: 0, remaining: 25 }
  },
  {
    id: "resource-anne-keller",
    displayName: "Anne Keller",
    initials: "AK",
    organization: "Organisation-A",
    primaryTeam: "M365 Platform",
    additionalTeams: ["Security", "Operations"],
    vacation: { annualEntitlement: 25, booked: 0, remaining: 25 }
  },
  {
    id: "resource-marc-weber",
    displayName: "Marc Weber",
    initials: "MW",
    organization: "Organisation-B",
    primaryTeam: "Service Desk",
    additionalTeams: ["Teams", "Workplace"],
    employmentRate: 0.8,
    workingDays: [1, 2, 3, 4],
    vacation: { annualEntitlement: 25, booked: 0, remaining: 25 }
  },
  {
    id: "resource-sara-meier",
    displayName: "Sara Meier",
    initials: "SM",
    organization: "Organisation-A",
    primaryTeam: "Security",
    additionalTeams: ["M365 Platform", "Operations"],
    employmentRate: 0.9,
    vacation: { annualEntitlement: 28, booked: 0, remaining: 28 }
  },
  {
    id: "resource-david-rossi",
    displayName: "David Rossi",
    initials: "DR",
    organization: "Organisation-B",
    primaryTeam: "Workplace",
    additionalTeams: ["Service Desk", "Teams"],
    employmentRate: 0.6,
    workingDays: [1, 3, 5],
    vacation: { annualEntitlement: 25, booked: 0, remaining: 25 }
  },
  {
    id: "resource-lena-baumann",
    displayName: "Lena Baumann",
    initials: "LB",
    organization: "Organisation-A",
    primaryTeam: "Operations",
    additionalTeams: ["Storage"],
    vacation: { annualEntitlement: 25, booked: 0, remaining: 25 }
  },
  {
    id: "resource-noah-frei",
    displayName: "Noah Frei",
    initials: "NF",
    organization: "Organisation-B",
    primaryTeam: "M365 Platform",
    additionalTeams: ["Operations"],
    employmentRate: 0.8,
    vacation: { annualEntitlement: 25, booked: 0, remaining: 25 }
  },
  {
    id: "resource-mila-schmid",
    displayName: "Mila Schmid",
    initials: "MS",
    organization: "Organisation-A",
    primaryTeam: "M365 Platform",
    additionalTeams: ["Teams"],
    employmentRate: 0.7,
    workingDays: [1, 2, 4, 5],
    vacation: { annualEntitlement: 25, booked: 0, remaining: 25 }
  },
  {
    id: "resource-tim-huber",
    displayName: "Tim Huber",
    initials: "TH",
    organization: "Organisation-B",
    primaryTeam: "Security",
    additionalTeams: ["Operations"],
    vacation: { annualEntitlement: 25, booked: 0, remaining: 25 }
  },
  {
    id: "resource-jonas-steiner",
    displayName: "Jonas Steiner",
    initials: "JS",
    organization: "Organisation-A",
    primaryTeam: "Operations",
    additionalTeams: ["Storage"],
    vacation: { annualEntitlement: 25, booked: 0, remaining: 25 }
  },
  {
    id: "resource-nina-wyss",
    displayName: "Nina Wyss",
    initials: "NW",
    organization: "Organisation-B",
    primaryTeam: "Service Desk",
    additionalTeams: ["Workplace", "M365 Platform"],
    vacation: { annualEntitlement: 25, booked: 0, remaining: 25 }
  },
  {
    id: "resource-patrick-moser",
    displayName: "Patrick Moser",
    initials: "PM",
    organization: "Organisation-A",
    primaryTeam: "Storage",
    additionalTeams: ["Operations"],
    vacation: { annualEntitlement: 25, booked: 0, remaining: 25 }
  },
  {
    id: "resource-elena-graf",
    displayName: "Elena Graf",
    initials: "EG",
    organization: "Organisation-B",
    primaryTeam: "Storage",
    additionalTeams: ["Security"],
    employmentRate: 0.5,
    workingDays: [2, 3, 4],
    vacation: { annualEntitlement: 25, booked: 0, remaining: 25 }
  },
  {
    id: "resource-oliver-kunz",
    displayName: "Oliver Kunz",
    initials: "OK",
    organization: "Organisation-A",
    primaryTeam: "PKI",
    additionalTeams: ["Security"],
    vacation: { annualEntitlement: 25, booked: 0, remaining: 25 }
  },
  {
    id: "resource-lea-marti",
    displayName: "Lea Marti",
    initials: "LM",
    organization: "Organisation-B",
    primaryTeam: "Network",
    additionalTeams: ["Security"],
    vacation: { annualEntitlement: 25, booked: 0, remaining: 25 }
  },
  {
    id: "resource-fabian-wolf",
    displayName: "Fabian Wolf",
    initials: "FW",
    organization: "Organisation-A",
    primaryTeam: "SQL",
    additionalTeams: ["Operations"],
    vacation: { annualEntitlement: 25, booked: 0, remaining: 25 }
  },
  {
    id: "resource-amira-hess",
    displayName: "Amira Hess",
    initials: "AH",
    organization: "Organisation-B",
    primaryTeam: "SQL",
    additionalTeams: ["Service Desk"],
    employmentRate: 0.8,
    vacation: { annualEntitlement: 28, booked: 0, remaining: 28 }
  },
  {
    id: "resource-matteo-bieri",
    displayName: "Matteo Bieri",
    initials: "MB",
    organization: "Organisation-A",
    primaryTeam: "SQL",
    additionalTeams: ["Storage"],
    vacation: { annualEntitlement: 25, booked: 0, remaining: 25 }
  },
  {
    id: "resource-svenja-rickli",
    displayName: "Svenja Rickli",
    initials: "SR",
    organization: "Organisation-B",
    primaryTeam: "Virtualization",
    additionalTeams: ["Storage", "Operations"],
    vacation: { annualEntitlement: 25, booked: 0, remaining: 25 }
  },
  {
    id: "resource-jan-niederer",
    displayName: "Jan Niederer",
    initials: "JN",
    organization: "Organisation-A",
    primaryTeam: "Virtualization",
    additionalTeams: ["Cloud"],
    employmentRate: 0.8,
    workingDays: [1, 2, 3, 5],
    vacation: { annualEntitlement: 25, booked: 0, remaining: 25 }
  },
  {
    id: "resource-celine-arbenz",
    displayName: "Celine Arbenz",
    initials: "CA",
    organization: "Organisation-B",
    primaryTeam: "Security",
    additionalTeams: ["M365 Platform"],
    vacation: { annualEntitlement: 25, booked: 0, remaining: 25 }
  },
  {
    id: "resource-roman-bachmann",
    displayName: "Roman Bachmann",
    initials: "RB",
    organization: "Organisation-A",
    primaryTeam: "Network",
    additionalTeams: ["Operations"],
    vacation: { annualEntitlement: 25, booked: 0, remaining: 25 }
  },
  {
    id: "resource-livia-camenisch",
    displayName: "Livia Camenisch",
    initials: "LC",
    organization: "Organisation-B",
    primaryTeam: "Workplace",
    additionalTeams: ["Teams"],
    vacation: { annualEntitlement: 25, booked: 0, remaining: 25 }
  },
  {
    id: "resource-dario-fischer",
    displayName: "Dario Fischer",
    initials: "DF",
    organization: "Organisation-A",
    primaryTeam: "M365 Platform",
    additionalTeams: ["Teams"],
    vacation: { annualEntitlement: 25, booked: 0, remaining: 25 }
  },
  {
    id: "resource-simone-egli",
    displayName: "Simone Egli",
    initials: "SE",
    organization: "Organisation-B",
    primaryTeam: "Workplace",
    additionalTeams: ["Security"],
    vacation: { annualEntitlement: 25, booked: 0, remaining: 25 }
  },
  {
    id: "resource-tobias-erni",
    displayName: "Tobias Erni",
    initials: "TE",
    organization: "Organisation-A",
    primaryTeam: "Service Desk",
    additionalTeams: ["Workplace"],
    vacation: { annualEntitlement: 25, booked: 0, remaining: 25 }
  },
  {
    id: "resource-maria-roth",
    displayName: "Maria Roth",
    initials: "MR",
    organization: "Organisation-B",
    primaryTeam: "Operations",
    additionalTeams: ["Service Desk"],
    vacation: { annualEntitlement: 28, booked: 0, remaining: 28 }
  },
  {
    id: "resource-philipp-zeller",
    displayName: "Philipp Zeller",
    initials: "PZ",
    organization: "Organisation-A",
    primaryTeam: "Cloud",
    additionalTeams: ["Operations"],
    vacation: { annualEntitlement: 25, booked: 0, remaining: 25 }
  },
  {
    id: "resource-ines-vogel",
    displayName: "Ines Vogel",
    initials: "IV",
    organization: "Organisation-B",
    primaryTeam: "PKI",
    additionalTeams: ["Security"],
    vacation: { annualEntitlement: 25, booked: 0, remaining: 25 }
  },
  {
    id: "resource-kevin-meier",
    displayName: "Kevin Meier",
    initials: "KM",
    organization: "Organisation-A",
    primaryTeam: "Teams",
    additionalTeams: ["M365 Platform"],
    vacation: { annualEntitlement: 25, booked: 0, remaining: 25 }
  },
  {
    id: "resource-julia-frick",
    displayName: "Julia Frick",
    initials: "JF",
    organization: "Organisation-B",
    primaryTeam: "Operations",
    additionalTeams: ["Service Desk"],
    vacation: { annualEntitlement: 25, booked: 0, remaining: 25 }
  }
];
