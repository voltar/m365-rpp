import { useEffect, useState } from "react";
import { Button } from "@fluentui/react-components";
import { AddRegular, DeleteRegular } from "@fluentui/react-icons";
import type { TranslationKey } from "../../../localization/translations";
import {
  getOrgConfig,
  patchOrgConfig,
  type OrgConfig,
  type OrgConfigEntry,
  type OrgConfigMapping
} from "../services/teamAdminApi";
import styles from "./OrganisationLocationCard.module.css";

interface OrganisationLocationCardProps {
  readonly canEdit: boolean;
  readonly t: (key: TranslationKey) => string;
}

/**
 * EO-415: editable flat lists for organisations and office locations plus the
 * mapping of raw Graph profile values (companyName / officeLocation) onto them.
 */
export function OrganisationLocationCard({ canEdit, t }: OrganisationLocationCardProps) {
  const [organisations, setOrganisations] = useState<readonly OrgConfigEntry[]>([]);
  const [locations, setLocations] = useState<readonly OrgConfigEntry[]>([]);
  const [mappings, setMappings] = useState<readonly OrgConfigMapping[]>([]);
  const [unmappedOrganisations, setUnmappedOrganisations] = useState<readonly string[]>([]);
  const [unmappedLocations, setUnmappedLocations] = useState<readonly string[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState<{ readonly kind: "ok" | "error"; readonly text: string }>();

  const applyConfig = (config: OrgConfig) => {
    setOrganisations(config.organisations);
    setLocations(config.locations);
    setMappings(config.mappings);
    setUnmappedOrganisations(config.unmappedOrganisationValues);
    setUnmappedLocations(config.unmappedLocationValues);
  };

  useEffect(() => {
    getOrgConfig()
      .then((config) => {
        applyConfig(config);
        setIsLoading(false);
      })
      .catch(() => {
        setMessage({ kind: "error", text: t("orgConfigLoadError") });
        setIsLoading(false);
      });
    // load once on mount; t is stable per locale and the card reloads with the page
  }, []);

  const save = async () => {
    setIsSaving(true);
    setMessage(undefined);

    // Blank rows (added but never named) are treated as "not added" instead of
    // failing the whole save with the server-side name validation.
    const cleanedOrganisations = organisations
      .map((entry) => ({ ...entry, name: entry.name.trim() }))
      .filter((entry) => entry.name);
    const cleanedLocations = locations
      .map((entry) => ({ ...entry, name: entry.name.trim() }))
      .filter((entry) => entry.name);

    try {
      const config = await patchOrgConfig({ organisations: cleanedOrganisations, locations: cleanedLocations, mappings });
      applyConfig(config);
      setMessage({ kind: "ok", text: t("orgConfigSaved") });
    } catch {
      setMessage({ kind: "error", text: t("orgConfigSaveError") });
    } finally {
      setIsSaving(false);
    }
  };

  const setMapping = (kind: OrgConfigMapping["kind"], graphValue: string, targetId: string) => {
    setMappings((current) => {
      const withoutValue = current.filter(
        (mapping) => !(mapping.kind === kind && mapping.graphValue.toLowerCase() === graphValue.toLowerCase())
      );

      return targetId
        ? [...withoutValue, { id: "", kind, graphValue, targetId }]
        : withoutValue;
    });
  };

  if (isLoading) {
    return (
      <section className={styles.card} aria-label={t("orgConfigTitle")}>
        <h4>{t("orgConfigTitle")}</h4>
        <p className={styles.muted}>{t("planningBootstrapLoading")}</p>
      </section>
    );
  }

  return (
    <section className={styles.card} aria-label={t("orgConfigTitle")}>
      <div>
        <h4>{t("orgConfigTitle")}</h4>
        <p className={styles.muted}>{t("orgConfigDescription")}</p>
      </div>

      <div className={styles.listGrid}>
        <EntryList
          entries={organisations}
          canEdit={canEdit}
          title={t("orgConfigOrganisations")}
          addLabel={t("orgConfigAdd")}
          removeLabel={t("orgConfigRemove")}
          onChange={setOrganisations}
        />
        <EntryList
          entries={locations}
          canEdit={canEdit}
          title={t("orgConfigLocations")}
          addLabel={t("orgConfigAdd")}
          removeLabel={t("orgConfigRemove")}
          onChange={setLocations}
        />
      </div>

      <MappingSection
        title={t("orgConfigOrganisationMappings")}
        kind="organisation"
        targets={organisations}
        mappings={mappings}
        unmappedValues={unmappedOrganisations}
        canEdit={canEdit}
        unassignedLabel={t("orgConfigUnassigned")}
        onSetMapping={setMapping}
      />
      <MappingSection
        title={t("orgConfigLocationMappings")}
        kind="location"
        targets={locations}
        mappings={mappings}
        unmappedValues={unmappedLocations}
        canEdit={canEdit}
        unassignedLabel={t("orgConfigUnassigned")}
        onSetMapping={setMapping}
      />

      {message ? (
        <p className={message.kind === "error" ? styles.errorText : styles.okText} role={message.kind === "error" ? "alert" : "status"}>
          {message.text}
        </p>
      ) : null}

      <div className={styles.actions}>
        <Button appearance="primary" disabled={!canEdit || isSaving} onClick={() => void save()}>
          {t("orgConfigSave")}
        </Button>
      </div>
    </section>
  );
}

function EntryList({
  entries,
  canEdit,
  title,
  addLabel,
  removeLabel,
  onChange
}: {
  readonly entries: readonly OrgConfigEntry[];
  readonly canEdit: boolean;
  readonly title: string;
  readonly addLabel: string;
  readonly removeLabel: string;
  readonly onChange: (entries: readonly OrgConfigEntry[]) => void;
}) {
  return (
    <div className={styles.entryList}>
      <h5>{title}</h5>
      {entries.map((entry, index) => (
        <div className={styles.entryRow} key={entry.id || `new-${index}`}>
          <input
            disabled={!canEdit}
            value={entry.name}
            onChange={(event) =>
              onChange(entries.map((candidate, candidateIndex) =>
                candidateIndex === index ? { ...candidate, name: event.target.value } : candidate
              ))
            }
          />
          <Button
            appearance="subtle"
            aria-label={removeLabel}
            disabled={!canEdit}
            icon={<DeleteRegular />}
            onClick={() => onChange(entries.filter((_, candidateIndex) => candidateIndex !== index))}
          />
        </div>
      ))}
      <Button
        appearance="secondary"
        disabled={!canEdit}
        icon={<AddRegular />}
        size="small"
        onClick={() => onChange([...entries, { id: "", name: "", sortOrder: entries.length }])}
      >
        {addLabel}
      </Button>
    </div>
  );
}

function MappingSection({
  title,
  kind,
  targets,
  mappings,
  unmappedValues,
  canEdit,
  unassignedLabel,
  onSetMapping
}: {
  readonly title: string;
  readonly kind: OrgConfigMapping["kind"];
  readonly targets: readonly OrgConfigEntry[];
  readonly mappings: readonly OrgConfigMapping[];
  readonly unmappedValues: readonly string[];
  readonly canEdit: boolean;
  readonly unassignedLabel: string;
  readonly onSetMapping: (kind: OrgConfigMapping["kind"], graphValue: string, targetId: string) => void;
}) {
  const kindMappings = mappings.filter((mapping) => mapping.kind === kind);
  const rows = [
    ...kindMappings.map((mapping) => ({ graphValue: mapping.graphValue, targetId: mapping.targetId })),
    ...unmappedValues
      .filter((value) => !kindMappings.some((mapping) => mapping.graphValue.toLowerCase() === value.toLowerCase()))
      .map((value) => ({ graphValue: value, targetId: "" }))
  ];

  if (rows.length === 0) {
    return null;
  }

  return (
    <div className={styles.mappingSection}>
      <h5>{title}</h5>
      {rows.map((row) => (
        <div className={styles.mappingRow} key={`${kind}-${row.graphValue}`}>
          <span className={styles.rawValue} title={row.graphValue}>{row.graphValue}</span>
          <select
            disabled={!canEdit}
            value={row.targetId}
            onChange={(event) => onSetMapping(kind, row.graphValue, event.target.value)}
          >
            <option value="">{unassignedLabel}</option>
            {targets.filter((target) => target.id).map((target) => (
              <option key={target.id} value={target.id}>
                {target.name}
              </option>
            ))}
          </select>
        </div>
      ))}
    </div>
  );
}
