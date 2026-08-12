import { Button } from "@fluentui/react-components";
import type { TranslationKey } from "../../localization/translations";
import type { ApplicationError } from "./ApplicationError";
import styles from "./ErrorBoundary.module.css";

interface ErrorDialogProps {
  readonly error: ApplicationError;
  readonly onReset: () => void;
  readonly t: (key: TranslationKey) => string;
}

export function ErrorDialog({ error, onReset, t }: ErrorDialogProps) {
  return (
    <div className={styles.dialogBackdrop} role="presentation">
      <section className={styles.errorDialog} role="alertdialog" aria-modal="true" aria-labelledby="error-dialog-title">
        <h2 id="error-dialog-title">{t("errorBoundaryTitle")}</h2>
        <p>{t("errorBoundaryMessage")}</p>
        <p className={styles.reference}>
          {t("errorReferenceLabel")}: <strong>{error.correlationId}</strong>
        </p>
        <Button appearance="primary" onClick={onReset}>
          {t("errorRetryAction")}
        </Button>
      </section>
    </div>
  );
}
