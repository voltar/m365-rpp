import type { HelpChatAnswer, HelpChatRequest, HelpFeedback } from "../models/helpAssistant";
import type { RepositoryResult } from "./planningRepositories";

/**
 * EO-450 FR-450.4: the UI never talks to Foundry or any AI service directly.
 * It calls this repository, whose API implementation talks to the RPP Web API,
 * which in turn reaches Foundry via Managed Identity. The browser holds no keys.
 */
export interface HelpRepository {
  /** Ask a question. Answers derive exclusively from the curated knowledge base. */
  askQuestion(request: HelpChatRequest): Promise<RepositoryResult<HelpChatAnswer>>;

  /** Record a Hilfreich / Nicht hilfreich rating for an answer (EO-450 FR-450.8). */
  submitFeedback(feedback: HelpFeedback): Promise<RepositoryResult<void>>;
}

export interface HelpRepositories {
  readonly help: HelpRepository;
}
