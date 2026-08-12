export type PatternParamType = 'string' | 'text' | 'number' | 'boolean' | 'select';

export interface PatternParamSpec {
  key: string;
  label: string;
  type: PatternParamType;
  required?: boolean;
  default?: string | number | boolean;
  placeholder?: string;
  options?: Array<{ value: string; label: string }>;
}

export interface GeneratedScriptConfig {
  trigger: string;
  filters?: Array<Record<string, unknown>>;
  actions: Array<Record<string, unknown>>;
  variables?: Record<string, unknown>;
  cooldown?: number;
  interval?: number;
}

export interface PatternDefinition {
  id: string;
  name: string;
  description: string;
  platforms: string[];
  params: PatternParamSpec[];
  generate: (params: Record<string, unknown>) => GeneratedScriptConfig;
}

const TRIGGER_OPTIONS = [
  { value: 'message', label: 'Message' },
  { value: 'follow', label: 'Follow' },
  { value: 'subscribe', label: 'Subscribe' },
  { value: 'donation', label: 'Donation' },
  { value: 'comment', label: 'Comment' },
];

function str(params: Record<string, unknown>, key: string, fallback = ''): string {
  const v = params[key];
  return typeof v === 'string' ? v : fallback;
}

function num(params: Record<string, unknown>, key: string, fallback: number): number {
  const v = params[key];
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
}

const MAX_LIST_ITEMS = 100;
const MAX_ITEM_LENGTH = 200;
const MAX_TEXT_LENGTH = 4000;
const MAX_VARIANTS = 100;

function splitList(value: string): string[] {
  return value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, MAX_LIST_ITEMS)
    .map((s) => s.slice(0, MAX_ITEM_LENGTH));
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Generated keyword regexes land in `regex` filters, which validateScriptConfig
// caps at 500 characters. Build the alternation under a budget so a long but
// legitimate keyword list can't generate a config that always fails validation
// with a confusing "regex exceeds 500 characters" error.
const MAX_KEYWORD_REGEX = 400;

function keywordRegex(words: string[]): string {
  const parts: string[] = [];
  let length = 0;
  for (const word of words) {
    const escaped = escapeRegex(word);
    const cost = escaped.length + (parts.length > 0 ? 1 : 0);
    if (length + cost > MAX_KEYWORD_REGEX) break;
    parts.push(escaped);
    length += cost;
  }
  return parts.join('|');
}

function capText(value: string, max = MAX_TEXT_LENGTH): string {
  return value.length > max ? value.slice(0, max) : value;
}

const COUNTER_NAME_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/** Counter names become Redis keys and property paths — restrict to a safe charset. */
function counterName(params: Record<string, unknown>, fallback: string): string {
  const name = str(params, 'counterName', fallback);
  return COUNTER_NAME_PATTERN.test(name) ? name : fallback;
}

export const patterns: PatternDefinition[] = [
  {
    id: 'welcome',
    name: 'Welcome / Greeting',
    description: 'Sends a personalized greeting when a follow, subscription or join event arrives.',
    platforms: ['twitch', 'telegram', 'youtube', 'twitter'],
    params: [
      {
        key: 'trigger',
        label: 'Trigger',
        type: 'select',
        required: true,
        default: 'follow',
        options: TRIGGER_OPTIONS,
      },
      {
        key: 'message',
        label: 'Greeting message',
        type: 'text',
        required: true,
        default: 'Welcome, {username}! Glad to see you. 👋',
        placeholder: 'Use {username} for the user name',
      },
      {
        key: 'channel',
        label: 'Channel to post into (optional, for follow events)',
        type: 'string',
        default: '',
        placeholder: 'e.g. #ssrjkk or a Telegram channel id',
      },
    ],
    generate: (params) => {
      const trigger = str(params, 'trigger', 'follow');
      const channel = str(params, 'channel');
      const text = capText(str(params, 'message'));
      if (trigger === 'follow' && channel) {
        return { trigger, actions: [{ type: 'say', payload: { channel, message: text } }] };
      }
      return { trigger, actions: [{ type: 'reply', payload: { text } }] };
    },
  },
  {
    id: 'auto-reply',
    name: 'Auto-reply to keywords',
    description: 'Replies to messages that match a keyword list or a regular expression.',
    platforms: ['telegram', 'twitch'],
    params: [
      {
        key: 'trigger',
        label: 'Trigger',
        type: 'select',
        required: true,
        default: 'message',
        options: TRIGGER_OPTIONS,
      },
      {
        key: 'keywords',
        label: 'Keywords (comma separated)',
        type: 'string',
        required: true,
        default: 'hello,hi',
        placeholder: 'e.g. hello, hi, !ping',
      },
      {
        key: 'reply',
        label: 'Reply text',
        type: 'text',
        required: true,
        default: 'Hello there! {text}',
      },
      { key: 'cooldown', label: 'Cooldown (seconds)', type: 'number', default: 0 },
    ],
    generate: (params) => {
      const keywords = splitList(str(params, 'keywords', 'hello'));
      // An explicitly empty keyword list must not produce `\b()\b`, which would
      // match every message; fall back to the pattern default instead.
      const regex = keywordRegex(keywords.length > 0 ? keywords : ['hello']);
      const config: GeneratedScriptConfig = {
        trigger: str(params, 'trigger', 'message'),
        filters: [{ type: 'regex', value: `\\b(${regex})\\b` }],
        actions: [{ type: 'reply', payload: { text: capText(str(params, 'reply')) } }],
      };
      const cooldown = num(params, 'cooldown', 0);
      if (cooldown > 0) config.cooldown = cooldown;
      return config;
    },
  },
  {
    id: 'command',
    name: 'Command responder',
    description: 'Responds to slash/! commands like /start, /help or !rules.',
    platforms: ['telegram', 'twitch'],
    params: [
      {
        key: 'trigger',
        label: 'Trigger',
        type: 'select',
        required: true,
        default: 'message',
        options: TRIGGER_OPTIONS,
      },
      {
        key: 'prefix',
        label: 'Command prefix',
        type: 'select',
        required: true,
        default: '/',
        options: [
          { value: '/', label: '/ (Telegram)' },
          { value: '!', label: '! (Twitch)' },
        ],
      },
      { key: 'command', label: 'Command name', type: 'string', required: true, default: 'start' },
      {
        key: 'reply',
        label: 'Reply text',
        type: 'text',
        required: true,
        default: 'Available commands:\n/start – start here\n/help – show help',
      },
    ],
    generate: (params) => ({
      trigger: str(params, 'trigger', 'message'),
      filters: [
        {
          type: 'regex',
          value: `^${escapeRegex(str(params, 'prefix', '/'))}${escapeRegex(str(params, 'command'))}\\b`,
        },
      ],
      actions: [{ type: 'reply', payload: { text: capText(str(params, 'reply')) } }],
    }),
  },
  {
    id: 'counter',
    name: 'Counter tracker',
    description: 'Counts how many times the trigger fires and reports the current count.',
    platforms: ['telegram', 'twitch'],
    params: [
      {
        key: 'trigger',
        label: 'Trigger',
        type: 'select',
        required: true,
        default: 'message',
        options: TRIGGER_OPTIONS,
      },
      {
        key: 'counterName',
        label: 'Counter name',
        type: 'string',
        required: true,
        default: 'visits',
      },
      {
        key: 'reply',
        label: 'Reply template',
        type: 'text',
        required: true,
        default: 'Count so far: {counters.{counterName}}',
      },
    ],
    generate: (params) => {
      const name = counterName(params, 'visits');
      const reply = capText(str(params, 'reply').replaceAll('{counterName}', name));
      return {
        trigger: str(params, 'trigger', 'message'),
        actions: [
          { type: 'increment_counter', payload: { name } },
          { type: 'reply', payload: { text: reply } },
        ],
      };
    },
  },
  {
    id: 'moderation',
    name: 'Moderation',
    description: 'Detects banned words and replies with a warning.',
    platforms: ['telegram', 'twitch'],
    params: [
      {
        key: 'trigger',
        label: 'Trigger',
        type: 'select',
        required: true,
        default: 'message',
        options: TRIGGER_OPTIONS,
      },
      {
        key: 'banned',
        label: 'Banned words (comma separated)',
        type: 'string',
        required: true,
        default: 'spam,scam',
      },
      {
        key: 'warning',
        label: 'Warning text',
        type: 'text',
        required: true,
        default: '@{username}, please keep the chat friendly.',
      },
      { key: 'cooldown', label: 'Cooldown (seconds)', type: 'number', default: 10 },
    ],
    generate: (params) => {
      const banned = splitList(str(params, 'banned', 'spam'));
      const regex = keywordRegex(banned.length > 0 ? banned : ['spam']);
      const config: GeneratedScriptConfig = {
        trigger: str(params, 'trigger', 'message'),
        filters: [{ type: 'regex', value: `\\b(${regex})\\b` }],
        actions: [{ type: 'reply', payload: { text: capText(str(params, 'warning')) } }],
      };
      const cooldown = num(params, 'cooldown', 10);
      if (cooldown > 0) config.cooldown = cooldown;
      return config;
    },
  },
  {
    id: 'random-response',
    name: 'Random responses',
    description: 'Picks a random message from a list every time the trigger fires.',
    platforms: ['telegram', 'twitch'],
    params: [
      {
        key: 'trigger',
        label: 'Trigger',
        type: 'select',
        required: true,
        default: 'message',
        options: TRIGGER_OPTIONS,
      },
      {
        key: 'keywords',
        label: 'Keywords (comma separated)',
        type: 'string',
        required: true,
        default: '!roll',
      },
      {
        key: 'variants',
        label: 'Responses (one per line)',
        type: 'text',
        required: true,
        default: 'You rolled a 6!\nBetter luck next time!\nIt is a mystery.',
      },
    ],
    generate: (params) => {
      const keywords = splitList(str(params, 'keywords', '!roll'));
      const regex = keywordRegex(keywords.length > 0 ? keywords : ['!roll']);
      const variants = str(params, 'variants')
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(0, MAX_VARIANTS)
        .map((v) => v.slice(0, MAX_TEXT_LENGTH));
      return {
        trigger: str(params, 'trigger', 'message'),
        filters: [{ type: 'regex', value: `^(${regex})\\b` }],
        actions: [{ type: 'random_reply', payload: { variants } }],
      };
    },
  },
  {
    id: 'donation-thanks',
    name: 'Donation thanks',
    description: 'Thank donors once the donation reaches a minimum amount.',
    platforms: ['twitch'],
    params: [
      {
        key: 'minAmount',
        label: 'Minimum amount (currency units)',
        type: 'number',
        required: true,
        default: 1,
      },
      {
        key: 'thanks',
        label: 'Thanks text',
        type: 'text',
        required: true,
        default: 'Thank you {username} for the {amount} donation!',
      },
    ],
    generate: (params) => ({
      trigger: 'donation',
      actions: [
        {
          type: 'if',
          condition: { field: 'amount', operator: 'gt', value: num(params, 'minAmount', 1) },
          actions: [{ type: 'reply', payload: { text: capText(str(params, 'thanks')) } }],
        },
      ],
    }),
  },
  {
    id: 'link-guard',
    name: 'Link guard',
    description:
      'Detects URLs in chat and warns against spam links. Uses a cooldown to stay quiet.',
    platforms: ['telegram', 'twitch'],
    params: [
      {
        key: 'trigger',
        label: 'Trigger',
        type: 'select',
        required: true,
        default: 'message',
        options: TRIGGER_OPTIONS,
      },
      {
        key: 'warning',
        label: 'Warning text',
        type: 'text',
        required: true,
        default: '@{username}, please do not post links here.',
      },
      { key: 'cooldown', label: 'Cooldown (seconds)', type: 'number', default: 30 },
    ],
    generate: (params) => {
      const config: GeneratedScriptConfig = {
        trigger: str(params, 'trigger', 'message'),
        filters: [{ type: 'regex', value: '(?:https?:\\/\\/|www\\.)\\S+' }],
        actions: [{ type: 'reply', payload: { text: capText(str(params, 'warning')) } }],
      };
      const cooldown = num(params, 'cooldown', 30);
      if (cooldown > 0) config.cooldown = cooldown;
      return config;
    },
  },
  {
    id: 'heartbeat',
    name: 'Heartbeat / periodic message',
    description: 'Posts a periodic message (or logs) while the bot is connected, on a schedule.',
    platforms: ['telegram', 'twitch', 'youtube', 'twitter'],
    params: [
      {
        key: 'intervalSeconds',
        label: 'Interval (seconds)',
        type: 'number',
        required: true,
        default: 300,
      },
      {
        key: 'message',
        label: 'Message text',
        type: 'text',
        required: true,
        default: 'Still alive and running.',
      },
      {
        key: 'channel',
        label: 'Channel to post into (optional)',
        type: 'string',
        default: '',
        placeholder: 'e.g. #ssrjkk — leave empty to log only',
      },
    ],
    generate: (params) => {
      const interval = Math.max(
        10,
        Math.min(86400, Math.round(num(params, 'intervalSeconds', 300))),
      );
      const channel = str(params, 'channel');
      const message = capText(str(params, 'message'));
      const config: GeneratedScriptConfig = {
        trigger: 'interval',
        interval,
        cooldown: interval,
        actions: channel
          ? [{ type: 'say', payload: { channel, message } }]
          : [{ type: 'log', payload: { level: 'info', message } }],
      };
      return config;
    },
  },
  {
    id: 'raid-host-thanks',
    name: 'Raid / host thanks',
    description:
      'Thanks a Twitch raid or host when it arrives, optionally only above a minimum viewer count.',
    platforms: ['twitch'],
    params: [
      {
        key: 'trigger',
        label: 'Trigger',
        type: 'select',
        required: true,
        default: 'raid',
        options: [
          { value: 'raid', label: 'Raid' },
          { value: 'host', label: 'Host' },
        ],
      },
      {
        key: 'message',
        label: 'Thanks text',
        type: 'text',
        required: true,
        default: 'Thanks for the raid, {username}! Welcome all raiders.',
      },
      { key: 'minViewers', label: 'Minimum viewers (0 = always)', type: 'number', default: 0 },
    ],
    generate: (params) => {
      const trigger = str(params, 'trigger', 'raid');
      const text = str(params, 'message');
      const minViewers = num(params, 'minViewers', 0);
      const reply = { type: 'reply', payload: { text } };
      return {
        trigger,
        actions:
          minViewers > 0
            ? [
                {
                  type: 'if',
                  condition: { field: 'viewers', operator: 'gte', value: minViewers },
                  actions: [reply],
                },
              ]
            : [reply],
      };
    },
  },
  {
    id: 'threshold-alert',
    name: 'Threshold alert',
    description:
      'Tracks a counter and announces when it reaches a milestone (e.g. every 100 visits).',
    platforms: ['telegram', 'twitch'],
    params: [
      {
        key: 'trigger',
        label: 'Trigger',
        type: 'select',
        required: true,
        default: 'message',
        options: TRIGGER_OPTIONS,
      },
      {
        key: 'counterName',
        label: 'Counter name',
        type: 'string',
        required: true,
        default: 'visits',
      },
      {
        key: 'threshold',
        label: 'Threshold (announce at this count)',
        type: 'number',
        required: true,
        default: 100,
      },
      {
        key: 'message',
        label: 'Alert text',
        type: 'text',
        required: true,
        default: 'We hit {counters.{counterName}}! Milestone reached. 🎉',
      },
    ],
    generate: (params) => {
      const name = counterName(params, 'visits');
      const threshold = num(params, 'threshold', 100);
      const message = str(params, 'message').replaceAll('{counterName}', name);
      return {
        trigger: str(params, 'trigger', 'message'),
        actions: [
          { type: 'increment_counter', payload: { name } },
          {
            type: 'if',
            condition: { field: `counters.${name}`, operator: 'gte', value: threshold },
            actions: [{ type: 'reply', payload: { text: message } }],
          },
        ],
      };
    },
  },
];

export function getPattern(id: string): PatternDefinition | undefined {
  return patterns.find((p) => p.id === id);
}

export function listPatterns(): Array<Omit<PatternDefinition, 'generate'>> {
  return patterns.map(({ generate: _g, ...meta }) => meta);
}
