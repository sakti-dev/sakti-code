import type {
  BundledLanguage,
  BundledTheme,
  HighlighterGeneric,
  SpecialLanguage,
} from "shiki";

interface ShikiHighlighterInfo {
  highlighter: HighlighterGeneric<BundledLanguage, BundledTheme>;
  loadedLanguages: Set<BundledLanguage>;
}

interface ResolvedShikiHighlighter {
  highlighter: ShikiHighlighterInfo["highlighter"];
  language: BundledLanguage | SpecialLanguage;
}

class ShikiManager {
  private static instance: ShikiManager | null = null;
  private readonly highlighters = new Map<
    BundledTheme,
    Promise<ShikiHighlighterInfo>
  >();

  static getInstance(): ShikiManager {
    if (ShikiManager.instance === null) {
      ShikiManager.instance = new ShikiManager();
    }

    return ShikiManager.instance;
  }

  getHighlighter(theme: BundledTheme): Promise<ShikiHighlighterInfo> {
    const existing = this.highlighters.get(theme);
    if (existing) {
      return existing;
    }

    const pending = (async () => {
      const { createHighlighter } = await import("shiki");
      const highlighter = await createHighlighter({
        langs: [],
        themes: [theme],
      });

      return {
        highlighter,
        loadedLanguages: new Set<BundledLanguage>(),
      };
    })();

    this.highlighters.set(theme, pending);

    return pending;
  }

  async ensureLanguage(
    theme: BundledTheme,
    language: string
  ): Promise<ResolvedShikiHighlighter> {
    const info = await this.getHighlighter(theme);

    if (!language || language === "text") {
      return {
        highlighter: info.highlighter,
        language: "text",
      };
    }

    const { bundledLanguages, bundledLanguagesAlias } = await import("shiki");
    const aliasCandidate =
      bundledLanguagesAlias[language as keyof typeof bundledLanguagesAlias];
    const resolvedLanguage =
      typeof aliasCandidate === "string" ? aliasCandidate : language;
    const bundledLanguage = resolvedLanguage as BundledLanguage;

    if (!Object.hasOwn(bundledLanguages, bundledLanguage)) {
      return {
        highlighter: info.highlighter,
        language: "text",
      };
    }

    if (!info.loadedLanguages.has(bundledLanguage)) {
      await info.highlighter.loadLanguage(bundledLanguage);
      info.loadedLanguages.add(bundledLanguage);
    }

    return {
      highlighter: info.highlighter,
      language: bundledLanguage,
    };
  }
}

export const getShikiManager = (): ShikiManager => ShikiManager.getInstance();
