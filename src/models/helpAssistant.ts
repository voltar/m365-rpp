import type { TranslationKey } from "../localization/translations";
import type { RouteKey } from "./navigation";

/**
 * EO-450: domain model of the read-only help assistant.
 *
 * The assistant answers exclusively from the curated user knowledge base
 * (`docs/user`, `docs/faq`, `docs/glossary`, `docs/release-notes`). It never
 * performs write actions and never surfaces source code or internal
 * configuration - see EO-450 FR-450.7.
 */

/**
 * Role the backend uses to shape the answer.
 * `teamLead` / `appAdmin` may receive knowledge marked audience team-owner (Team Admin Center).
 * `employee` must not receive owner-only how-to content.
 */
export type HelpUserRole = "employee" | "teamLead" | "appAdmin";

/**
 * Call context handed to the backend with every question (EO-450 FR-450.5).
 * It is what makes "why is this red?" answerable: the assistant knows which
 * page the user is looking at.
 */
export interface HelpChatContext {
  readonly language: string;
  readonly currentPage: RouteKey;
  readonly workspaceId?: string;
  readonly userRole: HelpUserRole;
  readonly selectedEmployeeId?: string;
}

/** A citation into the knowledge base, rendered under the answer (EO-450 FR-450.6). */
export interface HelpAnswerSource {
  /** Human-readable document title, e.g. "Team-Kapazität". */
  readonly title: string;
  /** Navigation path inside RPP, e.g. "Team-Kapazität → Wochenübersicht". Never a URL. */
  readonly rppPage?: string;
  /** Route the "open" affordance navigates to, when the source maps to a route. */
  readonly route?: RouteKey;
}

export type HelpMessageAuthor = "user" | "assistant";

export interface HelpChatMessage {
  readonly id: string;
  readonly author: HelpMessageAuthor;
  readonly content: string;
  readonly sources?: readonly HelpAnswerSource[];
  readonly createdAt: string;
  /** Set once the user rates the answer; only meaningful for assistant messages. */
  readonly feedback?: HelpFeedbackRating;
  /** True when the assistant could not answer from the knowledge base. */
  readonly unanswered?: boolean;
}

export interface HelpChatRequest {
  readonly question: string;
  readonly context: HelpChatContext;
  /** Prior turns, so the backend can resolve follow-up questions. */
  readonly history: readonly HelpChatMessage[];
}

export interface HelpChatAnswer {
  readonly content: string;
  readonly sources: readonly HelpAnswerSource[];
  readonly unanswered: boolean;
}

export type HelpFeedbackRating = "helpful" | "notHelpful";

export interface HelpFeedback {
  readonly messageId: string;
  readonly rating: HelpFeedbackRating;
  readonly context: HelpChatContext;
}

/** A suggested question offered before the conversation starts (EO-450 FR-450.8). */
export interface HelpStarterPrompt {
  readonly id: string;
  readonly questionKey: TranslationKey;
}
