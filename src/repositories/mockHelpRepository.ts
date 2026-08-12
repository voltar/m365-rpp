import type { TranslationKey } from "../localization/translations";
import type { HelpChatAnswer, HelpChatRequest, HelpUserRole } from "../models/helpAssistant";
import type { RouteKey } from "../models/navigation";
import type { HelpRepository } from "./helpRepositories";
import type { RepositoryResult } from "./planningRepositories";

/**
 * EO-450 / curated KB refresh: demo provider for mock mode.
 * Answers mirror docs/user|faq|glossary. Entries with audience "team-owner"
 * are only used when the caller is teamLead or appAdmin.
 */

type HelpAudience = "user" | "team-owner";

interface MockKnowledgeEntry {
  readonly keywords: readonly string[];
  readonly answerKey: TranslationKey;
  readonly sourceKey: TranslationKey;
  readonly route?: RouteKey;
  readonly page?: RouteKey;
  /** Default user — visible to everyone. team-owner only for owners/admins. */
  readonly audience?: HelpAudience;
}

const knowledgeEntries: readonly MockKnowledgeEntry[] = [
  {
    keywords: ["halb", "halbtag", "half", "tageshälfte", "vormittag", "nachmittag", "0.5"],
    answerKey: "helpMockAnswerHalfDay",
    sourceKey: "helpMockSourceAbsences",
    route: "overview"
  },
  {
    keywords: ["genehm", "approval", "approve", "bewillig", "antrag"],
    answerKey: "helpMockAnswerApprovalRequired",
    sourceKey: "helpMockSourceApprovals",
    route: "approvals",
    page: "approvals"
  },
  {
    keywords: ["sekundär", "secondary", "weitere teams", "zusatzposition", "default team", "primär", "primary"],
    answerKey: "helpMockAnswerSecondaryTeam",
    sourceKey: "helpMockSourceGlossary"
  },
  {
    keywords: ["outlook", "kalender", "calendar", "synchron", "sync", "termin"],
    answerKey: "helpMockAnswerOutlookSync",
    sourceKey: "helpMockSourceOutlookSync",
    route: "settings"
  },
  {
    keywords: ["sehe", "fehlt", "nicht sichtbar", "missing", "see a person", "person nicht", "taucht"],
    answerKey: "helpMockAnswerPersonMissing",
    sourceKey: "helpMockSourceTimeline",
    route: "overview",
    page: "overview"
  },
  {
    keywords: ["präsenz", "presence", "unterschied", "difference", "abwesenheit und"],
    answerKey: "helpMockAnswerPresenceVsAbsence",
    sourceKey: "helpMockSourceGlossary"
  },
  {
    keywords: ["rot", "red", "kritisch", "critical", "warnung", "warning", "unterbesetz", "mindestbesetz"],
    answerKey: "helpMockAnswerWhyRed",
    sourceKey: "helpMockSourceCapacity",
    route: "teamCapacity",
    page: "teamCapacity"
  },
  {
    keywords: ["ferien", "vacation", "saldo", "guthaben", "resttage", "balance", "anspruch"],
    answerKey: "helpMockAnswerVacationBalance",
    sourceKey: "helpMockSourceAbsences",
    route: "overview"
  },
  {
    keywords: ["report", "auswertung", "analyse", "power bi", "organisation"],
    answerKey: "helpMockAnswerReports",
    sourceKey: "helpMockSourceReports",
    route: "reports",
    page: "reports"
  },
  {
    keywords: ["einstellung", "settings", "benachrichtig", "notification", "sprache", "language"],
    answerKey: "helpMockAnswerSettings",
    sourceKey: "helpMockSourceSettings",
    route: "settings",
    page: "settings"
  },
  {
    keywords: ["start", "erste schritte", "getting started", "wo finde", "navigation"],
    answerKey: "helpMockAnswerGettingStarted",
    sourceKey: "helpMockSourceGettingStarted",
    route: "overview"
  },
  // Team-owner only (Team Admin Center how-to)
  {
    keywords: [
      "team admin",
      "mindestbesetzung",
      "required staffing",
      "abwesenheitstyp",
      "absence type",
      "standard-genehmiger",
      "default approver",
      "mitglieder verwalten",
      "member add",
      "teammitglieder",
      "genehmigungsrichtlinie",
      "approval policy"
    ],
    answerKey: "helpMockAnswerTeamAdmin",
    sourceKey: "helpMockSourceTeamAdmin",
    route: "teamAdmin",
    page: "teamAdmin",
    audience: "team-owner"
  },
  {
    keywords: ["berechtigung", "rolle", "role", "unberechtigt", "owner", "besitzer", "access denied"],
    answerKey: "helpMockAnswerRoles",
    sourceKey: "helpMockSourceTeamsAndRoles",
    page: "teamAdmin"
  }
];

function canUseAudience(audience: HelpAudience | undefined, role: HelpUserRole): boolean {
  if (!audience || audience === "user") {
    return true;
  }

  return role === "teamLead" || role === "appAdmin";
}

export function createMockHelpRepository(t: (key: TranslationKey) => string): HelpRepository {
  return {
    async askQuestion(request: HelpChatRequest): Promise<RepositoryResult<HelpChatAnswer>> {
      await delay(450);

      const role = request.context.userRole;
      const entry = findEntry(request, role);

      if (!entry) {
        // Owner-only topic asked by a non-owner: clear refusal, no admin how-to.
        if (looksLikeTeamAdminQuestion(request.question) && !canUseAudience("team-owner", role)) {
          return {
            ok: true,
            value: {
              content: t("helpMockAnswerTeamAdminRestricted"),
              sources: [
                {
                  title: t("helpMockSourceTeamsAndRoles"),
                  rppPage: t("navTeamAdmin")
                }
              ],
              unanswered: false
            }
          };
        }

        return {
          ok: true,
          value: {
            content: t("helpMockAnswerUnknown"),
            sources: [],
            unanswered: true
          }
        };
      }

      return {
        ok: true,
        value: {
          content: t(entry.answerKey),
          sources: [
            {
              title: t(entry.sourceKey),
              rppPage: entry.route ? t(routeLabelKeys[entry.route]) : undefined,
              route: entry.route
            }
          ],
          unanswered: false
        }
      };
    },

    async submitFeedback(): Promise<RepositoryResult<void>> {
      return { ok: true, value: undefined };
    }
  };
}

function findEntry(request: HelpChatRequest, role: HelpUserRole): MockKnowledgeEntry | undefined {
  const question = request.question.toLowerCase();
  const visible = knowledgeEntries.filter((entry) => canUseAudience(entry.audience, role));

  const direct = visible.find((entry) => entry.keywords.some((keyword) => question.includes(keyword)));
  if (direct) {
    return direct;
  }

  return visible.find((entry) => entry.page === request.context.currentPage);
}

function looksLikeTeamAdminQuestion(question: string): boolean {
  const q = question.toLowerCase();
  return [
    "team admin",
    "mindestbesetzung",
    "required staffing",
    "abwesenheitstyp",
    "genehmigungsrichtlinie",
    "approval policy",
    "mitglieder verwalten",
    "default approver",
    "standard-genehmiger"
  ].some((keyword) => q.includes(keyword));
}

const routeLabelKeys: Record<RouteKey, TranslationKey> = {
  overview: "navOverview",
  teamCapacity: "navTeamCapacity",
  teamAdmin: "navTeamAdmin",
  appAdmin: "navAppAdmin",
  reports: "navReports",
  approvals: "navApprovals",
  settings: "navSettings",
  info: "navInfo"
};

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
