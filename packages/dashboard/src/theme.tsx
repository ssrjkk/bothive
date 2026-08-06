import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { ConfigProvider, theme as antdTheme } from 'antd';

export type ThemeName = 'light' | 'dark';

export const BRAND = {
  primary: '#6d5dfc',
  primaryDark: '#8b7bff',
  accent: '#c46bff',
  gradient: 'linear-gradient(135deg, #6d5dfc 0%, #9b6bff 55%, #c46bff 100%)',
  honey: '#fbbf24',
};

const STORAGE_KEY = 'bothive:theme';

const ThemeContext = createContext<{ theme: ThemeName; toggleTheme: () => void }>({
  theme: 'light',
  toggleTheme: () => {},
});

export const useTheme = () => useContext(ThemeContext);

function initialTheme(): ThemeName {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === 'light' || stored === 'dark') return stored;
    if (window.matchMedia?.('(prefers-color-scheme: dark)').matches) return 'dark';
  } catch {
    /* storage unavailable — fall through to light */
  }
  return 'light';
}

const fontFamily =
  "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, 'Apple Color Emoji', 'Segoe UI Emoji', sans-serif";

const lightTokens = {
  colorPrimary: BRAND.primary,
  colorInfo: BRAND.primary,
  colorSuccess: '#16a34a',
  colorWarning: '#f59e0b',
  colorError: '#ef4444',
  colorBgLayout: '#f3f4fb',
  colorBgContainer: '#ffffff',
  colorTextBase: '#1f2437',
  colorBorderSecondary: 'rgba(31, 36, 55, 0.1)',
  controlOutline: 'rgba(109, 93, 252, 0.2)',
  borderRadius: 10,
  borderRadiusLG: 14,
  borderRadiusSM: 8,
  fontFamily,
  controlHeight: 36,
  fontWeightStrong: 700,
  boxShadowTertiary: '0 6px 24px rgba(45, 37, 92, 0.08)',
};

const darkTokens = {
  colorPrimary: BRAND.primaryDark,
  colorInfo: BRAND.primaryDark,
  colorSuccess: '#34d399',
  colorWarning: '#fbbf24',
  colorError: '#f87171',
  colorBgLayout: '#0d1021',
  colorBgContainer: '#151830',
  colorTextBase: '#e7e9f7',
  colorBorderSecondary: 'rgba(255, 255, 255, 0.09)',
  controlOutline: 'rgba(139, 123, 255, 0.28)',
  borderRadius: 10,
  borderRadiusLG: 14,
  borderRadiusSM: 8,
  fontFamily,
  controlHeight: 36,
  fontWeightStrong: 700,
  boxShadowTertiary: '0 6px 24px rgba(0, 0, 0, 0.45)',
};

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<ThemeName>(initialTheme);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      /* ignore */
    }
    document.documentElement.dataset.theme = theme;
    const meta = document.querySelector('meta[name="theme-color"]');
    meta?.setAttribute('content', theme === 'dark' ? '#0d1021' : '#f3f4fb');
  }, [theme]);

  const value = useMemo(
    () => ({
      theme,
      toggleTheme: () => setTheme((t) => (t === 'light' ? 'dark' : 'light')),
    }),
    [theme],
  );

  return (
    <ThemeContext.Provider value={value}>
      <ConfigProvider
        theme={{
          algorithm: theme === 'dark' ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
          token: theme === 'dark' ? darkTokens : lightTokens,
          components: {
            Button: {
              fontWeight: 600,
              primaryShadow: theme === 'dark' ? '0 6px 18px rgba(109, 93, 252, 0.35)' : '0 6px 18px rgba(109, 93, 252, 0.28)',
            },
            Card: {
              boxShadowTertiary: theme === 'dark' ? '0 4px 20px rgba(0,0,0,0.35)' : '0 1px 2px rgba(31,36,55,0.04), 0 8px 24px rgba(31,36,55,0.06)',
            },
            Table: {
              headerBg: theme === 'dark' ? '#1a1e35' : '#f7f8fd',
              headerColor: theme === 'dark' ? '#c3c9e8' : '#454a63',
              rowHoverBg: theme === 'dark' ? 'rgba(139,123,255,0.08)' : 'rgba(109,93,252,0.05)',
              headerBorderRadius: 10,
            },
            Tabs: {
              titleFontSize: 14,
              inkBarColor: BRAND.primary,
            },
            Menu: {
              darkItemBg: 'transparent',
              darkSubMenuItemBg: 'transparent',
              darkItemColor: 'rgba(226,229,248,0.72)',
              darkItemHoverBg: 'rgba(255,255,255,0.08)',
              darkItemSelectedBg: 'rgba(109,93,252,0.35)',
              darkItemSelectedColor: '#ffffff',
            },
            Progress: {
              defaultColor: BRAND.primary,
            },
            Tag: {
              defaultBg: theme === 'dark' ? 'rgba(255,255,255,0.08)' : 'rgba(31,36,55,0.06)',
              defaultColor: theme === 'dark' ? '#c3c9e8' : '#454a63',
            },
            Tooltip: {
              colorBgSpotlight: theme === 'dark' ? '#1a1e35' : '#2a2f4a',
            },
          },
        }}
      >
        {children}
      </ConfigProvider>
    </ThemeContext.Provider>
  );
}
