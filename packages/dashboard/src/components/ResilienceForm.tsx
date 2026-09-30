import React, { useState } from 'react';
import {
  Card,
  InputNumber,
  Switch,
  Input,
  Button,
  Space,
  Tag,
  Divider,
  Typography,
  Alert,
  message,
  theme,
} from 'antd';
import { PlusOutlined, DeleteOutlined, SaveOutlined, RobotOutlined } from '@ant-design/icons';
import { api } from '../api';

interface ResilienceFormProps {
  bot: { id: string; config: Record<string, unknown> };
  onSaved: () => void;
}

interface BudgetOverride {
  action: string;
  maxRequests: number;
  windowMs: number;
}

const ACTION_EXAMPLES = ['sendMessage', 'say', 'tweet', 'reply', 'react', 'getPrice'];

/**
 * Guided editor for the per-bot resilience knobs that otherwise live in raw
 * config JSON: the outbound rate budget (global per-bot cap + per-action-type
 * budgets), human-like behavior and account warming. Saves by merging into the
 * existing config, so unrelated keys survive untouched.
 */
export function ResilienceForm({ bot, onSaved }: ResilienceFormProps) {
  const { token } = theme.useToken();
  const config = bot.config ?? {};

  const [rateLimitPerMinute, setRateLimitPerMinute] = useState<number | null>(
    typeof config.rateLimitPerMinute === 'number' ? config.rateLimitPerMinute : null,
  );

  const budgets =
    (config.rateLimitBudgets as
      | {
          default?: { maxRequests?: number; windowMs?: number };
          overrides?: Record<string, { maxRequests: number; windowMs: number }>;
        }
      | undefined) ?? {};
  const [budgetDefault, setBudgetDefault] = useState({
    maxRequests: budgets.default?.maxRequests ?? 30,
    windowMs: budgets.default?.windowMs ?? 60_000,
  });
  const [overrides, setOverrides] = useState<BudgetOverride[]>(
    Object.entries(budgets.overrides ?? {}).map(([action, b]) => ({
      action,
      maxRequests: b.maxRequests,
      windowMs: b.windowMs,
    })),
  );

  const behavior =
    (config.behavior as
      { enabled?: boolean; humanDelay?: boolean | { scale?: number } } | undefined) ?? {};
  const [behaviorEnabled, setBehaviorEnabled] = useState<boolean>(behavior.enabled === true);
  const humanDelay = typeof behavior.humanDelay === 'object' ? behavior.humanDelay : null;
  const [humanDelayOn, setHumanDelayOn] = useState<boolean>(
    behavior.humanDelay === true || humanDelay !== null,
  );
  const [humanDelayScale, setHumanDelayScale] = useState<number | null>(humanDelay?.scale ?? null);

  const warming =
    (config.warming as
      | {
          durationDays?: number;
          maxDailyActions?: number;
          maxDailyPosts?: number;
          firstPostDay?: number;
        }
      | undefined) ?? {};
  const [warmingOn, setWarmingOn] = useState<boolean>(Object.keys(warming).length > 0);
  const [warmingCfg, setWarmingCfg] = useState({
    durationDays: warming.durationDays ?? 5,
    maxDailyActions: warming.maxDailyActions ?? 5,
    maxDailyPosts: warming.maxDailyPosts ?? 2,
    firstPostDay: warming.firstPostDay ?? 3,
  });

  const [aiEnabled, setAiEnabled] = useState<boolean>(config.aiEnabled === true);
  const [aiModel, setAiModel] = useState<string>(
    typeof config.aiModel === 'string' ? config.aiModel : '',
  );
  const [aiSystemPrompt, setAiSystemPrompt] = useState<string>(
    typeof config.aiSystemPrompt === 'string' ? config.aiSystemPrompt : '',
  );

  const setOverride = (index: number, patch: Partial<BudgetOverride>): void => {
    setOverrides((prev) => prev.map((o, i) => (i === index ? { ...o, ...patch } : o)));
  };

  const save = async () => {
    const patch: Record<string, unknown> = {};
    // null = cleared by the user -> drop the key entirely (undefined keys are
    // omitted when the config is serialized to the API, deleting the setting).
    if (rateLimitPerMinute !== null) patch.rateLimitPerMinute = rateLimitPerMinute;
    else patch.rateLimitPerMinute = undefined;

    const budgetsPatch: {
      default: { maxRequests: number; windowMs: number };
      overrides: Record<string, { maxRequests: number; windowMs: number }>;
    } = {
      default: budgetDefault,
      overrides: {},
    };
    for (const o of overrides) {
      if (o.action.trim().length > 0) {
        budgetsPatch.overrides[o.action.trim()] = {
          maxRequests: o.maxRequests,
          windowMs: o.windowMs,
        };
      }
    }
    // Write budgets when the bot already had them, or the form carries any.
    if (Object.keys(budgetsPatch.overrides).length > 0 || budgets.default !== undefined) {
      patch.rateLimitBudgets = budgetsPatch;
    } else {
      patch.rateLimitBudgets = undefined;
    }

    const behaviorPatch: Record<string, unknown> = { enabled: behaviorEnabled };
    if (humanDelayOn) {
      behaviorPatch.humanDelay = humanDelayScale !== null ? { scale: humanDelayScale } : true;
    }
    if (behaviorEnabled || humanDelayOn || Object.keys(behavior).length > 0) {
      patch.behavior = behaviorPatch;
    } else {
      patch.behavior = undefined;
    }

    if (warmingOn) patch.warming = warmingCfg;
    else patch.warming = undefined;

    // Local AI auto-reply (Ollama): an explicit toggle; model and system
    // prompt are kept only while filled in (cleared fields remove the keys).
    patch.aiEnabled = aiEnabled;
    patch.aiModel = aiModel.trim().length > 0 ? aiModel.trim() : undefined;
    patch.aiSystemPrompt = aiSystemPrompt.trim().length > 0 ? aiSystemPrompt.trim() : undefined;

    try {
      await api.patch(`/bots/${bot.id}`, { config: { ...config, ...patch } });
      message.success('Resilience settings saved');
      onSaved();
    } catch (err) {
      message.error(err instanceof Error ? err.message : 'Save failed');
    }
  };

  const row = (label: string, hint: string, control: React.ReactNode) => (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16, marginBottom: 14 }}>
      <div style={{ width: 210, flexShrink: 0 }}>
        <div style={{ fontWeight: 600, fontSize: 13.5 }}>{label}</div>
        <div style={{ fontSize: 12, color: token.colorTextTertiary, marginTop: 2 }}>{hint}</div>
      </div>
      <div style={{ flex: 1 }}>{control}</div>
    </div>
  );

  return (
    <Card className="bh-card" variant="borderless">
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 20 }}
        message="These settings protect the bot from platform API limits and anti-spam detection. They are also editable as raw JSON on the Info tab."
      />

      <Typography.Text strong style={{ fontSize: 14 }}>
        Outbound rate limits
      </Typography.Text>
      <div style={{ marginTop: 14, marginBottom: 22 }}>
        {row(
          'Per-bot cap (per minute)',
          'Hard budget for all outbound actions of this bot. Empty = use the global window.',
          <InputNumber
            min={1}
            max={1000}
            value={rateLimitPerMinute}
            onChange={(v) => setRateLimitPerMinute(v as number | null)}
            placeholder="e.g. 30"
            style={{ width: 140 }}
          />,
        )}
        {row(
          'Default budget',
          'Window used by action types without a specific override (30 per 60s by default).',
          <Space>
            <InputNumber
              min={1}
              max={1_000_000}
              value={budgetDefault.maxRequests}
              onChange={(v) =>
                setBudgetDefault((p) => ({ ...p, maxRequests: (v as number) ?? 30 }))
              }
              style={{ width: 120 }}
            />
            <Typography.Text type="secondary">requests per</Typography.Text>
            <InputNumber
              min={100}
              max={86_400_000}
              value={budgetDefault.windowMs}
              onChange={(v) =>
                setBudgetDefault((p) => ({ ...p, windowMs: (v as number) ?? 60_000 }))
              }
              style={{ width: 140 }}
              addonAfter="ms"
            />
          </Space>,
        )}
        {row(
          'Per-action budgets',
          'Give an endpoint its own window so a tweet burst never starves chat messages.',
          <Space direction="vertical" style={{ width: '100%' }} size={8}>
            {overrides.map((o, i) => (
              <Space key={i} wrap>
                <Input
                  placeholder="action (e.g. tweet)"
                  value={o.action}
                  onChange={(e) => setOverride(i, { action: e.target.value })}
                  style={{ width: 160 }}
                  list="bothive-action-examples"
                />
                <InputNumber
                  min={1}
                  max={1_000_000}
                  value={o.maxRequests}
                  onChange={(v) => setOverride(i, { maxRequests: (v as number) ?? 1 })}
                  style={{ width: 110 }}
                  placeholder="limit"
                />
                <InputNumber
                  min={100}
                  max={86_400_000}
                  value={o.windowMs}
                  onChange={(v) => setOverride(i, { windowMs: (v as number) ?? 60_000 })}
                  style={{ width: 130 }}
                  addonAfter="ms"
                />
                <Button
                  size="small"
                  type="text"
                  danger
                  icon={<DeleteOutlined />}
                  onClick={() => setOverrides((prev) => prev.filter((_, idx) => idx !== i))}
                />
              </Space>
            ))}
            <Button
              size="small"
              icon={<PlusOutlined />}
              onClick={() =>
                setOverrides((prev) => [...prev, { action: '', maxRequests: 10, windowMs: 60_000 }])
              }
            >
              Add budget override
            </Button>
            <datalist id="bothive-action-examples">
              {ACTION_EXAMPLES.map((a) => (
                <option key={a} value={a} />
              ))}
            </datalist>
          </Space>,
        )}
      </div>

      <Divider style={{ margin: '0 0 18px' }} />

      <Typography.Text strong style={{ fontSize: 14 }}>
        Human-like behavior
      </Typography.Text>
      <div style={{ marginTop: 14, marginBottom: 22 }}>
        {row(
          'Sleep/wake schedule',
          'Stall reconnects inside sleep windows so the bot behaves like a human account.',
          <Switch checked={behaviorEnabled} onChange={setBehaviorEnabled} />,
        )}
        {row(
          'Send delays',
          'Add a human-like pause before publishing actions (messages, tweets, replies).',
          <Space>
            <Switch checked={humanDelayOn} onChange={setHumanDelayOn} />
            {humanDelayOn && (
              <>
                <Typography.Text type="secondary">scale</Typography.Text>
                <InputNumber
                  min={0}
                  max={100}
                  step={0.5}
                  value={humanDelayScale}
                  onChange={(v) => setHumanDelayScale(v as number | null)}
                  style={{ width: 100 }}
                />
              </>
            )}
          </Space>,
        )}
      </div>

      <Divider style={{ margin: '0 0 18px' }} />

      <Typography.Text strong style={{ fontSize: 14 }}>
        Account warming
      </Typography.Text>
      <div style={{ marginTop: 14, marginBottom: 22 }}>
        {row(
          'Enabled',
          'Cap daily actions/posts while the account is new to avoid anti-spam flags.',
          <Switch checked={warmingOn} onChange={setWarmingOn} />,
        )}
        {warmingOn && (
          <Space wrap size={16}>
            {(
              [
                ['durationDays', 'Duration (days)', 1, 365],
                ['maxDailyActions', 'Actions/day', 0, 100_000],
                ['maxDailyPosts', 'Posts/day', 0, 100_000],
                ['firstPostDay', 'First post on day', 1, 365],
              ] as const
            ).map(([key, label, min, max]) => (
              <div key={key}>
                <div style={{ fontSize: 12, color: token.colorTextTertiary, marginBottom: 4 }}>
                  {label}
                </div>
                <InputNumber
                  min={min}
                  max={max}
                  value={warmingCfg[key]}
                  onChange={(v) => setWarmingCfg((p) => ({ ...p, [key]: (v as number) ?? min }))}
                  style={{ width: 120 }}
                />
              </div>
            ))}
          </Space>
        )}
      </div>

      <Divider style={{ margin: '0 0 18px' }} />

      <Typography.Text strong style={{ fontSize: 14 }}>
        <RobotOutlined style={{ marginRight: 8, color: token.colorPrimary }} />
        AI auto-reply (Ollama)
      </Typography.Text>
      <div style={{ marginTop: 14, marginBottom: 22 }}>
        {row(
          'Enabled',
          'Answer incoming messages with a locally hosted LLM (see docs/ai.md).',
          <Switch checked={aiEnabled} onChange={setAiEnabled} />,
        )}
        {aiEnabled && (
          <>
            {row(
              'Model',
              'Ollama model name served by the workers (defaults to the AI_DEFAULT_MODEL).',
              <Input
                placeholder="e.g. qwen2.5:7b"
                value={aiModel}
                onChange={(e) => setAiModel(e.target.value)}
                style={{ maxWidth: 320 }}
              />,
            )}
            {row(
              'System prompt',
              'Optional instructions that shape the bot personality.',
              <Input.TextArea
                rows={3}
                placeholder="e.g. You are a friendly stream assistant…"
                value={aiSystemPrompt}
                onChange={(e) => setAiSystemPrompt(e.target.value)}
                style={{ maxWidth: 520 }}
              />,
            )}
          </>
        )}
      </div>

      <Button type="primary" icon={<SaveOutlined />} onClick={save}>
        Save resilience settings
      </Button>
      {overrides.length > 0 && (
        <span style={{ marginLeft: 12 }}>
          <Tag color="geekblue">budgets</Tag>
          <Tag color="purple">{behaviorEnabled ? 'behavior on' : 'behavior off'}</Tag>
          {warmingOn && <Tag color="gold">warming</Tag>}
          {aiEnabled && <Tag color="cyan">AI on</Tag>}
        </span>
      )}
    </Card>
  );
}
