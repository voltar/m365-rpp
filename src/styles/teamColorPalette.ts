import type { TranslationKey } from "../localization/translations";

// EO-423/EO-424: fixed Fluent palette plus optional custom HEX colors.
// Team styles stay deterministic and provide contrast-safe text color for HEX.

export const teamColorKeys = [
  "blue",
  "green",
  "marigold",
  "berry",
  "teal",
  "pumpkin",
  "lavender",
  "seafoam",
  "cranberry",
  "platinum"
] as const;

export type TeamColorKey = (typeof teamColorKeys)[number];

export interface TeamColorStyle {
  readonly background: string;
  readonly border: string;
  readonly text: string;
}

const hexColorPattern = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

const paletteTokenNameByKey: Record<TeamColorKey, string> = {
  blue: "Blue",
  green: "Green",
  marigold: "Marigold",
  berry: "Berry",
  teal: "Teal",
  pumpkin: "Pumpkin",
  lavender: "Lavender",
  seafoam: "Seafoam",
  cranberry: "Cranberry",
  platinum: "Platinum"
};

export const teamColorLabelKeyByKey: Record<TeamColorKey, TranslationKey> = {
  blue: "teamColorBlue",
  green: "teamColorGreen",
  marigold: "teamColorMarigold",
  berry: "teamColorBerry",
  teal: "teamColorTeal",
  pumpkin: "teamColorPumpkin",
  lavender: "teamColorLavender",
  seafoam: "teamColorSeafoam",
  cranberry: "teamColorCranberry",
  platinum: "teamColorPlatinum"
};

export function getTeamColorStyle(colorKey: TeamColorKey): TeamColorStyle {
  const token = paletteTokenNameByKey[colorKey];

  return {
    background: `var(--colorPalette${token}Background2)`,
    border: `var(--colorPalette${token}BorderActive)`,
    text: `var(--colorPalette${token}Foreground2)`
  };
}

export function isTeamColorKey(value: string | undefined): value is TeamColorKey {
  return Boolean(value) && (teamColorKeys as readonly string[]).includes(value as string);
}

export function isHexColor(value: string | undefined): value is string {
  return Boolean(value) && hexColorPattern.test(value as string);
}

export function getAssignedTeamColorStyle(teamName: string, assignedColor?: string): TeamColorStyle {
  if (isTeamColorKey(assignedColor)) {
    return getTeamColorStyle(assignedColor);
  }

  if (isHexColor(assignedColor)) {
    return {
      background: assignedColor,
      border: "var(--app-border-strong)",
      text: getReadableTextColor(assignedColor)
    };
  }

  return getTeamColorStyle(resolveTeamColorKey(teamName));
}

/**
 * Deterministic fallback so the by-team mode works before any color was
 * assigned: hash the team name onto the palette (stable across sessions).
 */
export function resolveTeamColorKey(teamName: string, assignedColor?: string): TeamColorKey {
  if (isTeamColorKey(assignedColor)) {
    return assignedColor;
  }

  let hash = 0;

  for (let index = 0; index < teamName.length; index += 1) {
    hash = (hash * 31 + teamName.charCodeAt(index)) >>> 0;
  }

  return teamColorKeys[hash % teamColorKeys.length]!;
}

function getReadableTextColor(hexColor: string): string {
  const normalized = normalizeHexColor(hexColor);
  const red = Number.parseInt(normalized.slice(1, 3), 16);
  const green = Number.parseInt(normalized.slice(3, 5), 16);
  const blue = Number.parseInt(normalized.slice(5, 7), 16);

  // YIQ brightness approximation for simple, stable contrast decisions.
  const brightness = (red * 299 + green * 587 + blue * 114) / 1000;
  return brightness >= 140 ? "#1f1f1f" : "#ffffff";
}

function normalizeHexColor(color: string): string {
  if (color.length === 7) {
    return color;
  }

  const short = color.slice(1);
  return `#${short[0]}${short[0]}${short[1]}${short[1]}${short[2]}${short[2]}`;
}
