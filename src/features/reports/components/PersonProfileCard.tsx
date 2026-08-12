import { useEffect, useState } from "react";
import { Button } from "@fluentui/react-components";
import {
  BuildingRegular,
  ChatRegular,
  DismissRegular,
  LocationRegular,
  MailRegular,
  PeopleTeamRegular
} from "@fluentui/react-icons";
import type { TranslationKey } from "../../../localization/translations";
import type { PersonProfile } from "../personProfile";
import styles from "../ReportsPage.module.css";

type PersonCardTab = "overview" | "organization";

interface PersonProfileCardProps {
  readonly profile: PersonProfile;
  readonly onClose: () => void;
  readonly t: (key: TranslationKey) => string;
}

/**
 * FR-413.5: in-app fallback card shown when the Teams host does not support the
 * native profile card (profile.showProfile, beta). Renders only real data — no
 * simulated presence, availability, or fabricated contact details.
 */
export function PersonProfileCard({ profile, onClose, t }: PersonProfileCardProps) {
  const [activeTab, setActiveTab] = useState<PersonCardTab>("overview");

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const tabs: readonly { readonly key: PersonCardTab; readonly labelKey: TranslationKey }[] = [
    { key: "overview", labelKey: "personCardTabOverview" },
    { key: "organization", labelKey: "personCardTabOrganization" }
  ];

  return (
    <div className={styles.overlay} onClick={onClose} role="presentation">
      <div
        aria-label={profile.formalName}
        className={styles.personCard}
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <Button
          appearance="subtle"
          aria-label={t("personCardClose")}
          className={styles.personClose}
          icon={<DismissRegular />}
          onClick={onClose}
        />

        <div className={styles.personHeader}>
          <span aria-hidden className={styles.personAvatar}>
            {profile.resource.initials}
          </span>
          <div className={styles.personIdentity}>
            <h4 className={styles.personName}>{profile.formalName}</h4>
            <span className={styles.personExtension}>{profile.resource.primaryTeam}</span>
          </div>
        </div>

        <div className={styles.personTabs} role="tablist">
          {tabs.map((tab) => (
            <button
              aria-selected={activeTab === tab.key}
              className={`${styles.personTab} ${activeTab === tab.key ? styles.personTabActive : ""}`}
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              role="tab"
              type="button"
            >
              {t(tab.labelKey)}
            </button>
          ))}
        </div>

        {activeTab === "overview" ? (
          <div className={styles.contactSection}>
            <h5>{t("personCardContactInformation")}</h5>
            <div className={styles.contactGrid}>
              {profile.email ? (
                <ContactItem icon={<MailRegular />} label={t("personCardEmail")} value={profile.email} />
              ) : null}
              {profile.chatAddress ? (
                <ContactItem icon={<ChatRegular />} label={t("personCardChat")} value={profile.chatAddress} />
              ) : null}
              {profile.company ? (
                <ContactItem icon={<BuildingRegular />} label={t("personCardCompany")} value={profile.company} plain />
              ) : null}
              {profile.location ? (
                <ContactItem icon={<LocationRegular />} label={t("personCardWorkLocation")} value={profile.location} plain />
              ) : null}
            </div>
          </div>
        ) : (
          <div className={styles.contactSection}>
            <h5>{t("personCardTabOrganization")}</h5>
            <div className={styles.contactGrid}>
              <ContactItem
                icon={<PeopleTeamRegular />}
                label={t("personCardTeams")}
                value={[profile.resource.primaryTeam, ...profile.resource.additionalTeams].join(", ")}
                plain
              />
              {profile.company ? (
                <ContactItem icon={<BuildingRegular />} label={t("personCardCompany")} value={profile.company} plain />
              ) : null}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

interface ContactItemProps {
  readonly icon: JSX.Element;
  readonly label: string;
  readonly value: string;
  readonly plain?: boolean;
}

function ContactItem({ icon, label, value, plain }: ContactItemProps) {
  return (
    <div className={styles.contactItem}>
      {icon}
      <span className={styles.contactItemText}>
        <span className={styles.contactLabel}>{label}</span>
        <span className={`${styles.contactValue} ${plain ? styles.contactValuePlain : ""}`}>{value}</span>
      </span>
    </div>
  );
}
