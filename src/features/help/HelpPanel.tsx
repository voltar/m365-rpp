import {
  Button,
  DrawerBody,
  DrawerHeader,
  DrawerHeaderTitle,
  OverlayDrawer
} from "@fluentui/react-components";
import { DismissRegular } from "@fluentui/react-icons";
import type { TranslationKey } from "../../localization/translations";
import type { HelpChatContext } from "../../models/helpAssistant";
import type { RouteKey } from "../../models/navigation";
import { HelpChat } from "./HelpChat";
import styles from "./HelpPanel.module.css";

/**
 * EO-450 FR-450.8: the help assistant as a right-hand drawer rather than a workspace tab.
 *
 * The page the user is asking about stays on screen next to the answer, which is what makes
 * "why is this red?" a sensible question to ask. Because the drawer never replaces the active
 * route, the page context in FR-450.5 is simply the current route - no "last visited page"
 * bookkeeping is needed.
 *
 * Fluent UI's OverlayDrawer supplies the surface, focus trap, Escape handling and animation,
 * so no custom overlay is maintained here.
 */
interface HelpPanelProps {
  readonly open: boolean;
  readonly currentPage: RouteKey;
  readonly language: string;
  readonly userRole: HelpChatContext["userRole"];
  readonly onNavigate: (route: RouteKey) => void;
  readonly onClose: () => void;
  readonly t: (key: TranslationKey) => string;
}

export function HelpPanel({
  open,
  currentPage,
  language,
  userRole,
  onNavigate,
  onClose,
  t
}: HelpPanelProps) {
  return (
    <OverlayDrawer
      open={open}
      position="end"
      size="medium"
      onOpenChange={(_event, data) => {
        if (!data.open) {
          onClose();
        }
      }}
    >
      <DrawerHeader>
        <DrawerHeaderTitle
          action={
            <Button
              appearance="subtle"
              aria-label={t("helpPanelClose")}
              icon={<DismissRegular />}
              onClick={onClose}
            />
          }
        >
          {t("helpPageTitle")}
        </DrawerHeaderTitle>
      </DrawerHeader>

      <DrawerBody className={styles.body}>
        <HelpChat
          currentPage={currentPage}
          language={language}
          onNavigate={(route) => {
            // Following a source link means the user wants the page, not the chat on top of it.
            onNavigate(route);
            onClose();
          }}
          userRole={userRole}
          t={t}
        />
      </DrawerBody>
    </OverlayDrawer>
  );
}
