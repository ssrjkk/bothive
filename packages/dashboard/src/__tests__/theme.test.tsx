import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import React from 'react';
import { ThemeProvider, useTheme, BRAND } from '../theme';

function ThemeConsumer() {
  const { theme, toggleTheme } = useTheme();
  return (
    <div>
      <span data-testid="theme">{theme}</span>
      <button onClick={toggleTheme}>toggle</button>
    </div>
  );
}

describe('BRAND', () => {
  it('has expected color keys', () => {
    expect(BRAND).toHaveProperty('primary');
    expect(BRAND).toHaveProperty('primaryDark');
    expect(BRAND).toHaveProperty('accent');
    expect(BRAND).toHaveProperty('gradient');
    expect(BRAND).toHaveProperty('honey');
  });
});

describe('ThemeProvider', () => {
  beforeEach(() => {
    window.localStorage?.clear();
    delete (document.documentElement as any).dataset.theme;
  });

  it('defaults to light theme', () => {
    render(
      <ThemeProvider>
        <ThemeConsumer />
      </ThemeProvider>,
    );
    expect(screen.getByTestId('theme')).toHaveTextContent('light');
  });

  it('toggles theme on button click', async () => {
    render(
      <ThemeProvider>
        <ThemeConsumer />
      </ThemeProvider>,
    );
    expect(screen.getByTestId('theme')).toHaveTextContent('light');

    await act(async () => {
      screen.getByText('toggle').click();
    });

    expect(screen.getByTestId('theme')).toHaveTextContent('dark');

    await act(async () => {
      screen.getByText('toggle').click();
    });

    expect(screen.getByTestId('theme')).toHaveTextContent('light');
  });

  it('persists theme to localStorage', async () => {
    render(
      <ThemeProvider>
        <ThemeConsumer />
      </ThemeProvider>,
    );

    await act(async () => {
      screen.getByText('toggle').click();
    });

    expect(window.localStorage.getItem('bothive:theme')).toBe('dark');
  });

  it('reads initial theme from localStorage', () => {
    window.localStorage.setItem('bothive:theme', 'dark');
    render(
      <ThemeProvider>
        <ThemeConsumer />
      </ThemeProvider>,
    );
    expect(screen.getByTestId('theme')).toHaveTextContent('dark');
  });

  it('sets data-theme attribute on document element', async () => {
    render(
      <ThemeProvider>
        <ThemeConsumer />
      </ThemeProvider>,
    );
    expect(document.documentElement.dataset.theme).toBe('light');

    await act(async () => {
      screen.getByText('toggle').click();
    });

    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('falls back to light for invalid localStorage value', () => {
    window.localStorage.setItem('bothive:theme', 'invalid');
    render(
      <ThemeProvider>
        <ThemeConsumer />
      </ThemeProvider>,
    );
    expect(screen.getByTestId('theme')).toHaveTextContent('light');
  });
});
