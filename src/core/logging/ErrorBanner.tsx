import { Button } from "@fluentui/react-components";
import type { TranslationKey } from "../../localization/translations";
import type { ApplicationError } from "./ApplicationError";
import styles from "./ErrorBoundary.module.css";

interface ErrorBannerProps {
  readonly error: ApplicationError;
  readonly onReset: () => void;
  readonly t: (key: TranslationKey) => string;
}

export function ErrorBanner({ error, onReset, t }: ErrorBannerProps) {
  return (
    <section className={styles.errorBanner} role="alert" aria-live="assertive">
      <div>
        <h2>{t("errorBoundaryTitle")}</h2>
        <p>{t("errorBoundaryMessage")}</p>
        <p className={styles.reference}>
          {t("errorReferenceLabel")}: <strong>{error.correlationId}</strong>
        </p>
      </div>
      <Button appearance="primary" onClick={onReset}>
        {t("errorRetryAction")}
      </Button>
    </section>
  );
}
