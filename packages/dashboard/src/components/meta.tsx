import React from 'react';
import { Tag, theme } from 'antd';

export const PLATFORM_COLORS: Record<string, { tag: string; hex: string }> = {
  telegram: { tag: 'cyan', hex: '#229ed9' },
  twitch: { tag: 'purple', hex: '#9146ff' },
  youtube: { tag: 'red', hex: '#f6000f' },
  twitter: { tag: 'blue', hex: '#1d9bf0' },
  crypto: { tag: 'orange', hex: '#f7931a' },
};

export const PLATFORMS: string[] = Object.keys(PLATFORM_COLORS);

export const STATUS_META: Record<string, { tag: string; color: string; pulse?: boolean }> = {
  running: { tag: 'success', color: '#16a34a', pulse: true },
  idle: { tag: 'default', color: '#94a3b8' },
  paused: { tag: 'warning', color: '#f59e0b' },
  error: { tag: 'error', color: '#ef4444' },
  connecting: { tag: 'processing', color: '#3b82f6', pulse: true },
  reconnecting: { tag: 'geekblue', color: '#6d5dfc', pulse: true },
};

export const LEVEL_META: Record<string, { tag: string; color: string }> = {
  info: { tag: 'processing', color: '#3b82f6' },
  warn: { tag: 'warning', color: '#f59e0b' },
  error: { tag: 'error', color: '#ef4444' },
  debug: { tag: 'default', color: '#94a3b8' },
};

export const TRIGGER_TAGS: Record<string, string> = {
  message: 'processing',
  follow: 'success',
  subscribe: 'purple',
  donation: 'gold',
  comment: 'cyan',
  interval: 'geekblue',
  status: 'magenta',
  raid: 'volcano',
  host: 'orange',
  price: 'volcano',
  signal: 'gold',
  trade: 'green',
};

export const ROLE_TAGS: Record<string, string> = { admin: 'geekblue', viewer: 'default' };

export function platformHex(platform: string): string {
  return PLATFORM_COLORS[platform.toLowerCase()]?.hex ?? '#64748b';
}

export function StatusBadge({ status }: { status: string }) {
  const meta = STATUS_META[status] ?? { tag: 'default', color: '#94a3b8' };
  return (
    <Tag color={meta.tag} style={{ borderRadius: 999, paddingInline: 10 }}>
      <span className="bh-platform" style={{ gap: 7 }}>
        <span
          className={`bh-dot ${meta.pulse ? 'bh-dot--pulse' : ''}`}
          style={{ background: meta.color }}
        />
        {status}
      </span>
    </Tag>
  );
}

export function PlatformTag({ platform }: { platform: string }) {
  const { token } = theme.useToken();
  const meta = PLATFORM_COLORS[platform.toLowerCase()];
  const color = meta?.hex ?? '#64748b';
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '1px 10px 1px 6px',
        borderRadius: 999,
        border: `1px solid ${token.colorBorderSecondary}`,
        background: token.colorBgLayout,
        fontSize: 13,
        lineHeight: '20px',
      }}
    >
      <span className="bh-dot" style={{ background: color }} />
      <span style={{ textTransform: 'capitalize' }}>{platform}</span>
    </span>
  );
}

export function LevelTag({ level }: { level: string }) {
  const meta = LEVEL_META[level] ?? { tag: 'default', color: '#94a3b8' };
  return (
    <Tag color={meta.tag} style={{ borderRadius: 999, paddingInline: 10 }}>
      {level}
    </Tag>
  );
}

export function RoleTag({ role }: { role: string }) {
  return (
    <Tag color={ROLE_TAGS[role] ?? 'default'} style={{ borderRadius: 999, paddingInline: 10 }}>
      {role}
    </Tag>
  );
}
