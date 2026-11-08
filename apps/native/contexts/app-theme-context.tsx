import type React from "react";
import { createContext, useCallback, useContext, useEffect, useMemo } from "react";
import { Uniwind, useUniwind } from "uniwind";

export type ThemeName = "light" | "dark";

/** The app does not follow the system appearance; it starts light until the user switches. */
const DEFAULT_THEME: ThemeName = "light";

type AppThemeContextType = {
  currentTheme: ThemeName;
  isLight: boolean;
  isDark: boolean;
  setTheme: (theme: ThemeName) => void;
  toggleTheme: () => void;
};

const AppThemeContext = createContext<AppThemeContextType | undefined>(undefined);

export const AppThemeProvider = ({ children }: { children: React.ReactNode }) => {
  const { theme, hasAdaptiveThemes } = useUniwind();

  // Uniwind starts in adaptive (follow-system) mode; pin an explicit theme once.
  useEffect(() => {
    if (hasAdaptiveThemes) {
      Uniwind.setTheme(DEFAULT_THEME);
    }
  }, [hasAdaptiveThemes]);

  const currentTheme: ThemeName = theme === "dark" ? "dark" : "light";

  const setTheme = useCallback((next: ThemeName) => {
    Uniwind.setTheme(next);
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme(currentTheme === "light" ? "dark" : "light");
  }, [currentTheme, setTheme]);

  const value = useMemo(
    () => ({
      currentTheme,
      isLight: currentTheme === "light",
      isDark: currentTheme === "dark",
      setTheme,
      toggleTheme,
    }),
    [currentTheme, setTheme, toggleTheme]
  );

  return <AppThemeContext.Provider value={value}>{children}</AppThemeContext.Provider>;
};

export function useAppTheme() {
  const context = useContext(AppThemeContext);
  if (!context) {
    throw new Error("useAppTheme must be used within AppThemeProvider");
  }
  return context;
}
