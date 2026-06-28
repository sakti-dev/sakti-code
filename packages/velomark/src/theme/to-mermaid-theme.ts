import type { VelomarkTheme } from "./types";

const parseHexChannel = (value: string): number => Number.parseInt(value, 16);
const HEX_PREFIX_RE = /^#/;

const toRgb = (hexColor: string): [number, number, number] | null => {
  const normalized = hexColor.trim().replace(HEX_PREFIX_RE, "");

  if (normalized.length === 3) {
    return [
      parseHexChannel(`${normalized[0]}${normalized[0]}`),
      parseHexChannel(`${normalized[1]}${normalized[1]}`),
      parseHexChannel(`${normalized[2]}${normalized[2]}`),
    ];
  }

  if (normalized.length === 6) {
    return [
      parseHexChannel(normalized.slice(0, 2)),
      parseHexChannel(normalized.slice(2, 4)),
      parseHexChannel(normalized.slice(4, 6)),
    ];
  }

  return null;
};

const relativeLuminance = (hexColor: string): number => {
  const rgb = toRgb(hexColor);

  if (!rgb) {
    return 1;
  }

  const linearized = rgb.map((channel) => {
    const normalized = channel / 255;
    return normalized <= 0.039_28
      ? normalized / 12.92
      : ((normalized + 0.055) / 1.055) ** 2.4;
  });
  const red = linearized[0] ?? 1;
  const green = linearized[1] ?? 1;
  const blue = linearized[2] ?? 1;

  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
};

const isDarkSurface = (theme: VelomarkTheme): boolean =>
  relativeLuminance(theme.color.surface.base) < 0.4;

export interface VelomarkMermaidThemeVariables {
  actorBkg: string;
  actorBorder: string;
  actorTextColor: string;
  background: string;
  clusterBkg: string;
  clusterBorder: string;
  darkMode: boolean;
  edgeLabelBackground: string;
  lineColor: string;
  mainBkg: string;
  nodeBkg: string;
  nodeBorder: string;
  nodeTextColor: string;
  noteBkgColor: string;
  noteBorderColor: string;
  noteTextColor: string;
  primaryBorderColor: string;
  primaryColor: string;
  primaryTextColor: string;
  secondaryBorderColor: string;
  secondaryColor: string;
  secondaryTextColor: string;
  tertiaryBorderColor: string;
  tertiaryColor: string;
  tertiaryTextColor: string;
  textColor: string;
}

export const toMermaidThemeVariables = (
  theme: VelomarkTheme
): VelomarkMermaidThemeVariables => {
  const darkMode = isDarkSurface(theme);

  return {
    actorBkg: theme.color.diagram.nodeBackground,
    actorBorder: theme.color.diagram.border,
    actorTextColor: theme.color.diagram.nodeForeground,
    background: theme.color.diagram.background,
    clusterBkg: theme.color.surface.elevated,
    clusterBorder: theme.color.diagram.border,
    darkMode,
    edgeLabelBackground: theme.color.surface.base,
    lineColor: theme.color.diagram.line,
    mainBkg: theme.color.surface.diagram,
    nodeBorder: theme.color.diagram.border,
    nodeBkg: theme.color.diagram.nodeBackground,
    nodeTextColor: theme.color.diagram.nodeForeground,
    noteBkgColor: theme.color.surface.elevated,
    noteBorderColor: theme.color.diagram.border,
    noteTextColor: theme.color.text.primary,
    primaryBorderColor: theme.color.diagram.border,
    primaryColor: theme.color.diagram.primary,
    primaryTextColor: theme.color.text.inverse,
    secondaryBorderColor: theme.color.diagram.border,
    secondaryColor: theme.color.diagram.secondary,
    secondaryTextColor: theme.color.text.inverse,
    textColor: theme.color.diagram.text,
    tertiaryBorderColor: theme.color.diagram.border,
    tertiaryColor: theme.color.diagram.nodeBackground,
    tertiaryTextColor: theme.color.diagram.nodeForeground,
  };
};
