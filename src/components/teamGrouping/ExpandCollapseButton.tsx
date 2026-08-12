import { Button } from "@fluentui/react-components";
import { ChevronDownRegular, ChevronRightRegular } from "@fluentui/react-icons";

interface ExpandCollapseButtonProps {
  readonly isExpanded: boolean;
  readonly label: string;
  readonly onToggle: () => void;
}

export function ExpandCollapseButton({ isExpanded, label, onToggle }: ExpandCollapseButtonProps) {
  return (
    <Button
      appearance="subtle"
      aria-expanded={isExpanded}
      aria-label={label}
      icon={isExpanded ? <ChevronDownRegular /> : <ChevronRightRegular />}
      onClick={onToggle}
      size="small"
    />
  );
}
