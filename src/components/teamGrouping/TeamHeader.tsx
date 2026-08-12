import type { TeamResourceGroup } from "../../models/teamGrouping";
import type { TeamColorStyle } from "../../styles/teamColorPalette";
import { ExpandCollapseButton } from "./ExpandCollapseButton";
import styles from "./TeamGrouping.module.css";

interface TeamHeaderProps {
  readonly group: TeamResourceGroup;
  readonly isExpanded: boolean;
  readonly resourceCountLabel: string;
  readonly toggleLabel: string;
  readonly onToggle: () => void;
  readonly rowIndex: number;
  readonly teamColorStyle?: TeamColorStyle;
}

export function TeamHeader({ group, isExpanded, resourceCountLabel, toggleLabel, onToggle, rowIndex, teamColorStyle }: TeamHeaderProps) {
  return (
    <div
      className={styles.groupHeader}
      style={{
        gridRow: rowIndex,
        background: teamColorStyle?.background,
        borderBottomColor: teamColorStyle?.border,
        borderRightColor: teamColorStyle?.border,
        color: teamColorStyle?.text
      }}
    >
      <div
        className={styles.headerContent}
        style={{
          background: teamColorStyle?.background,
          borderRightColor: teamColorStyle?.border,
          color: teamColorStyle?.text
        }}
      >
        <ExpandCollapseButton isExpanded={isExpanded} label={toggleLabel} onToggle={onToggle} />
        <span className={styles.teamName} style={{ color: teamColorStyle?.text }}>{group.teamName}</span>
        <span
          className={styles.countBadge}
          style={{
            borderColor: teamColorStyle?.border,
            color: teamColorStyle?.text
          }}
        >
          {resourceCountLabel}
        </span>
      </div>
      <span className={styles.rule} aria-hidden="true" style={{ borderTopColor: teamColorStyle?.border }} />
    </div>
  );
}
