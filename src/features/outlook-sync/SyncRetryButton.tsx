import { Button } from "@fluentui/react-components";
import type { TranslationKey } from "../../localization/translations";
import type { VacationRequest } from "../../models/approval";

interface SyncRetryButtonProps {
  readonly request: VacationRequest;
  readonly t: (key: TranslationKey) => string;
  readonly onRetry: (request: VacationRequest) => void;
}

export function SyncRetryButton({ request, t, onRetry }: SyncRetryButtonProps) {
  if (request.outlookSync.syncStatus !== "failed") {
    return null;
  }

  return (
    <Button appearance="secondary" onClick={() => onRetry(request)}>
      {t("outlookSyncRetry")}
    </Button>
  );
}
