export interface VelomarkTheme {
  color: {
    text: {
      primary: string;
      muted: string;
      accent: string;
      inverse: string;
    };
    surface: {
      base: string;
      elevated: string;
      code: string;
      codeStrong: string;
      quote: string;
      tableHeader: string;
      tableStripe: string;
      math: string;
      diagram: string;
    };
    border: {
      default: string;
      strong: string;
      accent: string;
    };
    link: {
      default: string;
      hover: string;
    };
    code: {
      languageBadgeBackground: string;
      languageBadgeForeground: string;
      copyButtonBackground: string;
      copyButtonForeground: string;
      copyButtonHoverBackground: string;
      copyButtonCopiedBackground: string;
      copyButtonCopiedForeground: string;
    };
    quote: {
      border: string;
      foreground: string;
    };
    diagram: {
      background: string;
      text: string;
      primary: string;
      secondary: string;
      border: string;
      line: string;
      nodeBackground: string;
      nodeForeground: string;
    };
  };
  radius: {
    sm: string;
    md: string;
    lg: string;
    pill: string;
  };
  shadow: {
    xs: string;
    sm: string;
  };
  spacing: {
    blockGap: string;
    inlineCodeX: string;
    inlineCodeY: string;
    codePaddingX: string;
    codePaddingY: string;
  };
  typography: {
    bodyFont: string;
    monoFont: string;
    lineHeight: string;
  };
}

export type VelomarkThemeName = "default" | "dark";
