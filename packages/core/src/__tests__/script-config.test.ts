import { describe, it, expect } from 'vitest';
import { validateScriptConfig } from '../validation/script-config.js';

describe('validateScriptConfig', () => {
  it('accepts a minimal valid config', () => {
    expect(validateScriptConfig({ actions: [{ type: 'reply', payload: { text: 'hi' } }] })).toEqual([]);
  });

  it('accepts pattern-style filters and nested if actions', () => {
    const config = {
      filters: [{ type: 'regex', value: '\\b(hello)\\b' }],
      actions: [
        { type: 'if', condition: { field: 'amount', operator: 'gt', value: 5 }, actions: [{ type: 'reply', payload: { text: 'thanks' } }] },
      ],
    };
    expect(validateScriptConfig(config)).toEqual([]);
  });

  it('rejects non-object configs', () => {
    expect(validateScriptConfig(null)).toHaveLength(1);
    expect(validateScriptConfig([1, 2])).toHaveLength(1);
  });

  it('rejects catastrophic-backtracking regexes', () => {
    const errors = validateScriptConfig({
      filters: [{ type: 'regex', value: '^([a-z]+)+$' }],
      actions: [{ type: 'reply', payload: { text: 'x' } }],
    });
    expect(errors.some((e) => e.includes('nested quantifiers'))).toBe(true);
  });

  it('rejects very long regexes', () => {
    const errors = validateScriptConfig({
      filters: [{ type: 'regex', value: 'a'.repeat(600) }],
      actions: [],
    });
    expect(errors.some((e) => e.includes('exceeds'))).toBe(true);
  });

  it('rejects invalid regexes', () => {
    const errors = validateScriptConfig({
      filters: [{ type: 'regex', value: '(unclosed' }],
      actions: [],
    });
    expect(errors.some((e) => e.includes('does not compile'))).toBe(true);
  });

  it('rejects custom code that escapes the sandbox', () => {
    const errors = validateScriptConfig({
      actions: [{ type: 'custom', payload: { code: 'this.constructor.constructor("return process")()' } }],
    });
    expect(errors.some((e) => e.includes('forbidden'))).toBe(true);
  });

  it('rejects custom code that uses process directly', () => {
    const errors = validateScriptConfig({
      actions: [{ type: 'custom', payload: { code: 'await ctx.api.fetch("http://x"); process.exit(1)' } }],
    });
    expect(errors.some((e) => e.includes('forbidden'))).toBe(true);
  });

  it('rejects custom filters with forbidden constructs', () => {
    const errors = validateScriptConfig({
      filters: [{ type: 'custom', value: 'ctx.constructor' }],
      actions: [],
    });
    expect(errors.some((e) => e.includes('forbidden'))).toBe(true);
  });

  it('rejects oversized delay actions', () => {
    const errors = validateScriptConfig({
      actions: [{ type: 'delay', payload: { ms: 999_999_999 } }],
    });
    expect(errors.some((e) => e.includes('delay'))).toBe(true);
  });

  it('rejects webhook actions targeting private addresses', () => {
    const errors = validateScriptConfig({
      actions: [{ type: 'webhook', payload: { url: 'http://127.0.0.1:3000/hook' } }],
    });
    expect(errors.some((e) => e.includes('disallowed URL'))).toBe(true);
  });

  it('accepts webhook actions targeting public addresses', () => {
    expect(validateScriptConfig({
      actions: [{ type: 'webhook', payload: { url: 'https://example.com/hook' } }],
    })).toEqual([]);
  });

  it('rejects too many actions', () => {
    const actions = Array.from({ length: 300 }, () => ({ type: 'log', payload: { message: 'x' } }));
    const errors = validateScriptConfig({ actions });
    expect(errors.some((e) => e.includes('too many actions'))).toBe(true);
  });

  it('rejects deep nesting', () => {
    let actions: unknown[] = [{ type: 'reply', payload: { text: 'x' } }];
    for (let i = 0; i < 10; i++) actions = [{ type: 'if', condition: {}, actions }];
    const errors = validateScriptConfig({ actions });
    expect(errors.some((e) => e.includes('nesting'))).toBe(true);
  });

  it('rejects oversized payload strings', () => {
    const errors = validateScriptConfig({
      actions: [{ type: 'reply', payload: { text: 'x'.repeat(50_000) } }],
    });
    expect(errors.some((e) => e.includes('exceeds'))).toBe(true);
  });
});
