import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Button, Spinner, Textarea } from "@fluentui/react-components";
import {
  ArrowRightRegular,
  DocumentBulletListRegular,
  QuestionCircleRegular,
  SendRegular,
  ThumbDislikeRegular,
  ThumbLikeRegular
} from "@fluentui/react-icons";
import { useLogger } from "../../core/logging";
import type { TranslationKey } from "../../localization/translations";
import type {
  HelpChatContext,
  HelpChatMessage,
  HelpFeedbackRating,
  HelpStarterPrompt
} from "../../models/helpAssistant";
import type { RouteKey } from "../../models/navigation";
import { createDefaultHelpRepository } from "../../repositories/defaultHelpRepositories";
import styles from "./HelpChat.module.css";

/**
 * EO-450 FR-450.8: the chat surface, rendered inside the help drawer (`HelpPanel`).
 *
 * There is deliberately no workspace tab: a tab replaces the page the user is asking
 * about, which is exactly wrong for «Weshalb ist das hier rot?» — the red thing has to
 * stay on screen. The drawer keeps the page visible, and the page context in FR-450.5
 * is therefore simply the active route.
 *
 * The title is owned by the drawer header, so this component starts at the action row.
 */
interface HelpChatProps {
  readonly currentPage: RouteKey;
  readonly language: string;
  readonly userRole: HelpChatContext["userRole"];
  readonly onNavigate: (route: RouteKey) => void;
  readonly t: (key: TranslationKey) => string;
}

const starterPrompts: readonly HelpStarterPrompt[] = [
  { id: "outlook", questionKey: "helpStarterOutlook" },
  { id: "presence", questionKey: "helpStarterPresence" }
];

/** Extra starters only for team owners / app admins (owner-scoped knowledge). */
const teamOwnerStarterPrompts: readonly HelpStarterPrompt[] = [
  { id: "teamAdmin", questionKey: "helpStarterTeamAdmin" },
  { id: "minimumStaffing", questionKey: "helpStarterMinimumStaffing" }
];

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

export function HelpChat({ currentPage, language, userRole, onNavigate, t }: HelpChatProps) {
  const logger = useLogger();
  const repository = useMemo(() => createDefaultHelpRepository(t, logger), [t, logger]);
  const [messages, setMessages] = useState<readonly HelpChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [isBusy, setIsBusy] = useState(false);
  const [errorKey, setErrorKey] = useState<TranslationKey>();
  const transcriptRef = useRef<HTMLDivElement>(null);

  const context = useMemo<HelpChatContext>(
    () => ({ language, currentPage, userRole }),
    [language, currentPage, userRole]
  );

  useEffect(() => {
    // Keep the newest turn in view without stealing focus from the input.
    transcriptRef.current?.scrollTo({ top: transcriptRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, isBusy]);

  const ask = useCallback(
    async (question: string): Promise<void> => {
      const trimmed = question.trim();

      if (!trimmed || isBusy) {
        return;
      }

      const userMessage: HelpChatMessage = {
        id: createMessageId("user"),
        author: "user",
        content: trimmed,
        createdAt: new Date().toISOString()
      };

      const history = messages;
      setMessages((current) => [...current, userMessage]);
      setDraft("");
      setErrorKey(undefined);
      setIsBusy(true);

      const result = await repository.askQuestion({ question: trimmed, context, history });

      setIsBusy(false);

      if (!result.ok) {
        setErrorKey("helpErrorRequestFailed");
        logger.warn("Help assistant request failed.", {
          source: "ui",
          component: "HelpChat",
          operation: "ask",
          details: { code: result.error.code }
        });

        return;
      }

      setMessages((current) => [
        ...current,
        {
          id: createMessageId("assistant"),
          author: "assistant",
          content: result.value.content,
          sources: result.value.sources,
          unanswered: result.value.unanswered,
          createdAt: new Date().toISOString()
        }
      ]);
    },
    [context, isBusy, logger, messages, repository]
  );

  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    void ask(draft);
  };

  const handleFeedback = (messageId: string, rating: HelpFeedbackRating): void => {
    setMessages((current) =>
      current.map((message) => (message.id === messageId ? { ...message, feedback: rating } : message))
    );

    void repository.submitFeedback({ messageId, rating, context });
  };

  const isEmpty = messages.length === 0;
  const visibleStarters =
    userRole === "teamLead" || userRole === "appAdmin"
      ? [...starterPrompts, ...teamOwnerStarterPrompts]
      : starterPrompts;

  return (
    <section className={styles.help} aria-label={t("helpPageTitle")}>
      <div className={styles.panelActions}>
        <Button
          appearance="secondary"
          icon={<QuestionCircleRegular />}
          onClick={() => void ask(`${t("helpAboutThisPage")}: ${t(routeLabelKeys[currentPage])}`)}
          disabled={isBusy}
        >
          {t("helpAboutThisPage")}
        </Button>
      </div>

      <div className={styles.transcript} ref={transcriptRef} role="log" aria-live="polite">
        {isEmpty ? (
          <div className={styles.intro}>
            <p className={styles.introText}>{t("helpIntroText")}</p>
            <div className={styles.starters}>
              {visibleStarters.map((prompt) => (
                <Button
                  appearance="outline"
                  className={styles.starter}
                  icon={<ArrowRightRegular />}
                  key={prompt.id}
                  onClick={() => void ask(t(prompt.questionKey))}
                >
                  {t(prompt.questionKey)}
                </Button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((message) => (
            <article
              className={message.author === "user" ? styles.userMessage : styles.assistantMessage}
              key={message.id}
            >
              <span className={styles.author}>
                {message.author === "user" ? t("helpAuthorYou") : t("helpAuthorAssistant")}
              </span>
              <p className={styles.messageText}>{message.content}</p>

              {message.sources && message.sources.length > 0 ? (
                <div className={styles.sources}>
                  <span className={styles.sourcesLabel}>
                    <DocumentBulletListRegular /> {t("helpSourceLabel")}
                  </span>
                  {message.sources.map((source, index) => (
                    <span className={styles.source} key={`${message.id}-source-${index}`}>
                      {source.title}
                      {source.route ? (
                        <Button
                          appearance="transparent"
                          size="small"
                          onClick={() => onNavigate(source.route as RouteKey)}
                        >
                          {t("helpOpenPage")}
                        </Button>
                      ) : null}
                    </span>
                  ))}
                </div>
              ) : null}

              {message.author === "assistant" && !message.unanswered ? (
                <div className={styles.feedback}>
                  <span className={styles.feedbackLabel}>{t("helpFeedbackQuestion")}</span>
                  <Button
                    appearance={message.feedback === "helpful" ? "primary" : "subtle"}
                    aria-label={t("helpFeedbackHelpful")}
                    icon={<ThumbLikeRegular />}
                    onClick={() => handleFeedback(message.id, "helpful")}
                    size="small"
                    title={t("helpFeedbackHelpful")}
                  />
                  <Button
                    appearance={message.feedback === "notHelpful" ? "primary" : "subtle"}
                    aria-label={t("helpFeedbackNotHelpful")}
                    icon={<ThumbDislikeRegular />}
                    onClick={() => handleFeedback(message.id, "notHelpful")}
                    size="small"
                    title={t("helpFeedbackNotHelpful")}
                  />
                  {message.feedback ? <span className={styles.feedbackThanks}>{t("helpFeedbackThanks")}</span> : null}
                </div>
              ) : null}
            </article>
          ))
        )}

        {isBusy ? (
          <div className={styles.busy}>
            <Spinner size="tiny" /> <span>{t("helpThinking")}</span>
          </div>
        ) : null}

        {errorKey ? <p className={styles.error}>{t(errorKey)}</p> : null}
      </div>

      <form className={styles.composer} onSubmit={handleSubmit}>
        <Textarea
          aria-label={t("helpInputLabel")}
          className={styles.input}
          disabled={isBusy}
          onChange={(_event, data) => setDraft(data.value)}
          placeholder={t("helpInputPlaceholder")}
          resize="vertical"
          value={draft}
        />
        <Button
          appearance="primary"
          disabled={isBusy || draft.trim().length === 0}
          icon={<SendRegular />}
          type="submit"
        >
          {t("helpSend")}
        </Button>
      </form>

      <p className={styles.disclaimer}>{t("helpDisclaimer")}</p>
    </section>
  );
}

function createMessageId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
