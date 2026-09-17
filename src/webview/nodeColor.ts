export const DEFAULT_NODE_BACKGROUND_FALLBACK = "#f3f3f3";
export const DEFAULT_NODE_FOREGROUND_FALLBACK = "#1f1f1f";

export const NODE_COLOR_SWATCHES = [
  "#f14c4c",
  "#e2a336",
  "#e5c116",
  "#4caf50",
  "#2472c8",
  "#a074c4",
  "#8b8b8b",
] as const;

type Rgb = { red: number; green: number; blue: number };

function parseHexColor(color: string): Rgb {
  const compact = color.slice(1);
  const expanded =
    compact.length === 3
      ? compact
          .split("")
          .map((channel) => channel + channel)
          .join("")
      : compact;
  return {
    red: Number.parseInt(expanded.slice(0, 2), 16),
    green: Number.parseInt(expanded.slice(2, 4), 16),
    blue: Number.parseInt(expanded.slice(4, 6), 16),
  };
}

function linearize(channel: number): number {
  const normalized = channel / 255;
  return normalized <= 0.04045
    ? normalized / 12.92
    : ((normalized + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance(color: string): number {
  const { red, green, blue } = parseHexColor(color);
  return 0.2126 * linearize(red) + 0.7152 * linearize(green) + 0.0722 * linearize(blue);
}

export function contrastRatio(first: string, second: string): number {
  const lighter = Math.max(relativeLuminance(first), relativeLuminance(second));
  const darker = Math.min(relativeLuminance(first), relativeLuminance(second));
  return (lighter + 0.05) / (darker + 0.05);
}

/**
 * Black or white always provides at least 4.58:1 against an opaque sRGB
 * background. Choosing the stronger ratio keeps custom node text above the
 * MAS 1.4.3 minimum of 4.5:1.
 */
export function contrastingTextColor(background: string): "#000000" | "#ffffff" {
  const blackContrast = contrastRatio(background, "#000000");
  const whiteContrast = contrastRatio(background, "#ffffff");
  return blackContrast >= whiteContrast ? "#000000" : "#ffffff";
}
