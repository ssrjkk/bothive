import { isWebhookUrlAllowed } from '../webhooks/index.js';

const MAX_FILTERS = 20;
const MAX_FILTER_VALUE = 500;
const MAX_REGEX_LENGTH = 500;
const MAX_CUSTOM_EXPRESSION = 500;
const MAX_CUSTOM_CODE = 4000;
const MAX_ACTIONS = 200;
const MAX_NESTING = 5;
const MAX_DELAY_MS = 300_000;
const MAX_PAYLOAD_STRING = 10_000;

// Sandboxes (vm) are not a security boundary on their own. These are the usual
// escape vectors; the worker also refuses to run code that trips them.
const FORBIDDEN_CODE_PATTERNS = [
  /\bprocess\b/,
  /\brequire\s*\(/,
  /\bmodule\b/,
  /\bexports\b/,
  /\bglobalThis\b/,
  /\bglobal\b/,
  /\bFunction\b/,
  /\beval\s*\(/,
  /\bconstructor\b/,
  /__proto__/,
  /\bprototype\b/,
  /\bimport\b/,
];

// Classic catastrophic-backtracking shape: a group that contains a quantifier
// and is itself quantified, e.g. (a+)+, (\d*)*, (a?|b){2,}.
export const QUANTIFIED_GROUP_REDOS = /\([^)]*[+*{][^)]*\)[+*?{]/;

export function isRegexSafe(value: string, maxLength = MAX_REGEX_LENGTH): boolean {
  if (value.length > maxLength) return false;
  if (QUANTIFIED_GROUP_REDOS.test(value)) return false;
  try {
    new RegExp(value, 'i');
  } catch {
    return false;
  }
  return true;
}

export interface ScriptConfigShape {
  filters?: unknown;
  actions?: unknown;
  variables?: unknown;
}

function checkCode(value: string, maxLength: number): string | null {
  if (value.length > maxLength) return `code exceeds ${maxLength} characters`;
  for (const pattern of FORBIDDEN_CODE_PATTERNS) {
    if (pattern.test(value)) return 'code uses forbidden constructs';
  }
  return null;
}

function checkRegex(value: string): string | null {
  if (!isRegexSafe(value)) {
    if (value.length > MAX_REGEX_LENGTH) return 'regex exceeds 500 characters';
    if (QUANTIFIED_GROUP_REDOS.test(value)) return 'regex uses dangerous nested quantifiers';
    return 'regex does not compile';
  }
  return null;
}

function checkFilters(filters: unknown, errors: string[]): void {
  if (!Array.isArray(filters)) return;
  if (filters.length > MAX_FILTERS) {
    errors.push('too many filters');
    return;
  }
  for (const filter of filters) {
    if (!filter || typeof filter !== 'object' || Array.isArray(filter)) {
      errors.push('filter must be an object');
      continue;
    }
    const f = filter as Record<string, unknown>;
    const value = typeof f.value === 'string' ? f.value : '';
    switch (f.type) {
      case 'regex': {
        const err = checkRegex(value);
        if (err) errors.push(`filter regex: ${err}`);
        break;
      }
      case 'custom': {
        const err = checkCode(value, MAX_CUSTOM_EXPRESSION);
        if (err) errors.push(`filter custom: ${err}`);
        break;
      }
      case 'keyword':
      case 'role':
        if (value.length > MAX_FILTER_VALUE) errors.push('filter value too long');
        break;
      default:
        errors.push(`filter type "${String(f.type)}" is not supported`);
    }
  }
}

function checkCondition(condition: unknown, errors: string[]): void {
  if (!condition || typeof condition !== 'object' || Array.isArray(condition)) {
    errors.push('condition must be an object');
    return;
  }
  const c = condition as Record<string, unknown>;
  // A regex condition is compiled and run on the worker's main thread with no
  // VM timeout, so a catastrophic pattern there would stall the process. It is
  // validated here at save time, same as filter regexes.
  if (c.operator === 'regex') {
    const err = checkRegex(typeof c.value === 'string' ? c.value : '');
    if (err) errors.push(`condition regex: ${err}`);
  }
}

function checkPayloadStrings(payload: unknown, prefix: string, errors: string[]): void {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return;
  for (const [key, value] of Object.entries(payload as Record<string, unknown>)) {
    if (typeof value === 'string' && value.length > MAX_PAYLOAD_STRING) {
      errors.push(`${prefix}.${key} exceeds ${MAX_PAYLOAD_STRING} characters`);
    }
  }
}

function walkActions(actions: unknown, depth: number, errors: string[], counter: { n: number }): void {
  if (!Array.isArray(actions)) {
    if (actions !== undefined) errors.push('actions must be an array');
    return;
  }
  for (const step of actions) {
    counter.n += 1;
    if (counter.n > MAX_ACTIONS) {
      errors.push('too many actions');
      return;
    }
    if (!step || typeof step !== 'object' || Array.isArray(step)) {
      errors.push('action must be an object');
      continue;
    }
    const s = step as Record<string, unknown>;
    if (typeof s.type !== 'string' || s.type.length === 0) {
      errors.push('action requires a type');
      continue;
    }

    if (s.condition !== undefined) checkCondition(s.condition, errors);

    if (s.payload && typeof s.payload === 'object' && !Array.isArray(s.payload)) {
      checkPayloadStrings(s.payload, `action "${s.type}" payload`, errors);
    }

    switch (s.type) {
      case 'if': {
        if (depth + 1 > MAX_NESTING) errors.push('action nesting is too deep');
        walkActions(s.actions, depth + 1, errors, counter);
        break;
      }
      case 'custom': {
        const payload = s.payload as Record<string, unknown> | undefined;
        const code = payload && typeof payload.code === 'string' ? payload.code : undefined;
        if (typeof code !== 'string') {
          errors.push('custom action requires payload.code');
        } else {
          const err = checkCode(code, MAX_CUSTOM_CODE);
          if (err) errors.push(`custom action: ${err}`);
        }
        break;
      }
      case 'delay': {
        const payload = s.payload as Record<string, unknown> | undefined;
        const ms = payload && typeof payload.ms === 'number' ? payload.ms : 0;
        if (ms > MAX_DELAY_MS) errors.push('delay exceeds 300000ms');
        break;
      }
      case 'webhook': {
        const payload = s.payload as Record<string, unknown> | undefined;
        const url = payload && typeof payload.url === 'string' ? payload.url : '';
        if (!url || !isWebhookUrlAllowed(url)) {
          errors.push('webhook action uses a disallowed URL');
        }
        break;
      }
      default:
        break;
    }
  }
}

/**
 * Validates a script config shape (filters + actions) for safety limits.
 * Returns a list of problems; an empty array means the config is acceptable.
 */
export function validateScriptConfig(config: unknown): string[] {
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    return ['config must be an object'];
  }
  const c = config as ScriptConfigShape;
  const errors: string[] = [];
  checkFilters(c.filters, errors);
  walkActions(c.actions, 0, errors, { n: 0 });
  return errors;
}
