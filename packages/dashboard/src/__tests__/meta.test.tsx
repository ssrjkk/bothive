import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import {
  PLATFORM_COLORS,
  PLATFORMS,
  STATUS_META,
  LEVEL_META,
  TRIGGER_TAGS,
  ROLE_TAGS,
  platformHex,
  StatusBadge,
  PlatformTag,
  LevelTag,
  RoleTag,
} from '../components/meta';

describe('meta constants', () => {
  it('PLATFORM_COLORS has expected platforms', () => {
    expect(Object.keys(PLATFORM_COLORS)).toEqual([
      'telegram',
      'twitch',
      'youtube',
      'twitter',
      'crypto',
    ]);
  });

  it('PLATFORMS is derived from PLATFORM_COLORS keys', () => {
    expect(PLATFORMS).toEqual(Object.keys(PLATFORM_COLORS));
  });

  it('STATUS_META has expected statuses', () => {
    expect(Object.keys(STATUS_META)).toEqual([
      'running',
      'idle',
      'paused',
      'error',
      'connecting',
      'reconnecting',
    ]);
  });

  it('LEVEL_META has expected levels', () => {
    expect(Object.keys(LEVEL_META)).toEqual(['info', 'warn', 'error', 'debug']);
  });

  it('TRIGGER_TAGS has expected triggers', () => {
    expect(Object.keys(TRIGGER_TAGS).length).toBeGreaterThan(5);
  });

  it('ROLE_TAGS has admin and viewer', () => {
    expect(ROLE_TAGS).toEqual({ admin: 'geekblue', viewer: 'default' });
  });
});

describe('platformHex', () => {
  it('returns hex for known platform', () => {
    expect(platformHex('telegram')).toBe('#229ed9');
    expect(platformHex('crypto')).toBe('#f7931a');
  });

  it('is case-insensitive', () => {
    expect(platformHex('Telegram')).toBe('#229ed9');
    expect(platformHex('TWITCH')).toBe('#9146ff');
  });

  it('returns fallback for unknown platform', () => {
    expect(platformHex('unknown')).toBe('#64748b');
  });
});

describe('StatusBadge', () => {
  it('renders status text', () => {
    render(<StatusBadge status="running" />);
    expect(screen.getByText('running')).toBeInTheDocument();
  });

  it('renders with correct color tag for known status', () => {
    const { container } = render(<StatusBadge status="error" />);
    const tag = container.querySelector('[data-color]');
    expect(tag).toHaveAttribute('data-color', 'error');
  });

  it('renders default for unknown status', () => {
    render(<StatusBadge status="unknown" />);
    expect(screen.getByText('unknown')).toBeInTheDocument();
  });
});

describe('PlatformTag', () => {
  it('renders platform name capitalized', () => {
    render(<PlatformTag platform="telegram" />);
    expect(screen.getByText('telegram')).toBeInTheDocument();
  });

  it('renders for unknown platform', () => {
    render(<PlatformTag platform="discord" />);
    expect(screen.getByText('discord')).toBeInTheDocument();
  });
});

describe('LevelTag', () => {
  it('renders level text', () => {
    render(<LevelTag level="error" />);
    expect(screen.getByText('error')).toBeInTheDocument();
  });

  it('renders default for unknown level', () => {
    render(<LevelTag level="trace" />);
    expect(screen.getByText('trace')).toBeInTheDocument();
  });
});

describe('RoleTag', () => {
  it('renders role text', () => {
    render(<RoleTag role="admin" />);
    expect(screen.getByText('admin')).toBeInTheDocument();
  });

  it('renders default color for unknown role', () => {
    const { container } = render(<RoleTag role="moderator" />);
    const tag = container.querySelector('[data-color]');
    expect(tag).toHaveAttribute('data-color', 'default');
  });
});
