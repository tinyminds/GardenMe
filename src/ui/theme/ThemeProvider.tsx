import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { loadThemeSettingsJson, saveThemeSettingsJson } from "@/core/settings/themeSettings";
import { DEFAULT_THEME_TOKENS, mergeThemeTokens, type ThemeTokens } from "@/ui/theme/themeTokens";

type ThemeContextValue = {
  theme: ThemeTokens;
  setToken: (key: keyof ThemeTokens, value: string) => void;
  applyThemePreset: (tokens: Partial<ThemeTokens>) => void;
  resetTheme: () => void;
  isReady: boolean;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

export function ThemeProvider(props: { children: ReactNode }) {
  const [theme, setTheme] = useState<ThemeTokens>(DEFAULT_THEME_TOKENS);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    (async () => {
      const raw = await loadThemeSettingsJson();
      if (!raw) {
        setIsReady(true);
        return;
      }

      try {
        const parsed = JSON.parse(raw) as Partial<ThemeTokens>;
        setTheme(mergeThemeTokens(parsed));
      } catch {
        setTheme(DEFAULT_THEME_TOKENS);
      } finally {
        setIsReady(true);
      }
    })().catch(() => {
      setTheme(DEFAULT_THEME_TOKENS);
      setIsReady(true);
    });
  }, []);

  const persist = useCallback(async (nextTheme: ThemeTokens) => {
    await saveThemeSettingsJson(JSON.stringify(nextTheme));
  }, []);

  const setToken = useCallback(
    (key: keyof ThemeTokens, value: string) => {
      setTheme((prev) => {
        const next = { ...prev, [key]: value.trim() || prev[key] };
        void persist(next);
        return next;
      });
    },
    [persist]
  );

  const resetTheme = useCallback(() => {
    setTheme(DEFAULT_THEME_TOKENS);
    void persist(DEFAULT_THEME_TOKENS);
  }, [persist]);

  const applyThemePreset = useCallback(
    (tokens: Partial<ThemeTokens>) => {
      const next = mergeThemeTokens(tokens);
      setTheme(next);
      void persist(next);
    },
    [persist]
  );

  const contextValue = useMemo<ThemeContextValue>(
    () => ({
      theme,
      setToken,
      applyThemePreset,
      resetTheme,
      isReady,
    }),
    [theme, setToken, applyThemePreset, resetTheme, isReady]
  );

  return <ThemeContext.Provider value={contextValue}>{props.children}</ThemeContext.Provider>;
}

export function useTheme() {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error("useTheme must be used inside ThemeProvider");
  }
  return context;
}
