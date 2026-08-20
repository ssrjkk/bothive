import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ScriptEngine } from '../script-engine.js';
import type { ScriptConfig } from '../script-engine.js';

function makeApi() {
  return {
    sendMessage: vi.fn().mockResolvedValue(undefined),
    sendPhoto: vi.fn().mockResolvedValue(undefined),
    deleteMessage: vi.fn().mockResolvedValue(undefined),
    say: vi.fn().mockResolvedValue(undefined),
    timeout: vi.fn().mockResolvedValue(undefined),
    tweet: vi.fn().mockResolvedValue(undefined),
    reply: vi.fn().mockResolvedValue(undefined),
    react: vi.fn().mockResolvedValue(undefined),
    log: vi.fn().mockResolvedValue(undefined),
    fetch: vi.fn().mockResolvedValue(undefined),
  };
}

const engine = new ScriptEngine();

beforeEach(() => {
  (engine as unknown as { scripts: Map<string, unknown> }).scripts.clear();
});

describe('ScriptEngine', () => {
  it('matches only the registered trigger type', async () => {
    const api = makeApi();
    const config: ScriptConfig = {
      trigger: 'message',
      actions: [{ type: 'reply', payload: { text: 'hi' } }],
    };
    engine.register('bot1', config);

    await engine.execute('bot1', { type: 'follow', text: 'hello' }, api);
    expect(api.sendMessage).not.toHaveBeenCalled();

    await engine.execute('bot1', { type: 'message', text: 'hello', chatId: 1 }, api);
    expect(api.sendMessage).toHaveBeenCalled();
  });

  it('runs several scripts that share one trigger without overwriting each other', async () => {
    const api = makeApi();
    engine.register('botMulti', {
      id: 'script-a',
      trigger: 'message',
      filters: [{ type: 'keyword', value: 'hello' }],
      actions: [{ type: 'reply', payload: { text: 'greeting' } }],
    });
    engine.register('botMulti', {
      id: 'script-b',
      trigger: 'message',
      filters: [{ type: 'keyword', value: 'bye' }],
      actions: [{ type: 'reply', payload: { text: 'farewell' } }],
    });

    await engine.execute('botMulti', { type: 'message', text: 'hello', chatId: 1 }, api);
    expect(api.sendMessage).toHaveBeenCalledTimes(1);
    expect(api.sendMessage).toHaveBeenCalledWith('1', 'greeting', expect.anything());

    await engine.execute('botMulti', { type: 'message', text: 'bye', chatId: 1 }, api);
    expect(api.sendMessage).toHaveBeenCalledTimes(2);
    expect(api.sendMessage).toHaveBeenLastCalledWith('1', 'farewell', expect.anything());
  });

  it('filters by regex and keyword', async () => {
    const api = makeApi();
    engine.register('bot2', {
      trigger: 'message',
      filters: [{ type: 'regex', value: '^!start' }],
      actions: [{ type: 'reply', payload: { text: 'ok' } }],
    });

    await engine.execute('bot2', { type: 'message', text: '!start now', chatId: 1 }, api);
    expect(api.sendMessage).toHaveBeenCalledTimes(1);

    await engine.execute('bot2', { type: 'message', text: '!stop now', chatId: 1 }, api);
    expect(api.sendMessage).toHaveBeenCalledTimes(1);
  });

  it('interpolates event fields into reply text', async () => {
    const api = makeApi();
    engine.register('bot3', {
      trigger: 'message',
      actions: [{ type: 'reply', payload: { text: 'You said: {text}' } }],
    });

    await engine.execute('bot3', { type: 'message', text: 'hello there', chatId: 42 }, api);
    expect(api.sendMessage).toHaveBeenCalledWith('42', 'You said: hello there', expect.anything());
  });

  it('reacts when messageId and chatId are present', async () => {
    const api = makeApi();
    engine.register('bot4', {
      trigger: 'message',
      actions: [{ type: 'react', payload: { reaction: '🔥' } }],
    });

    await engine.execute('bot4', { type: 'message', text: 'x', chatId: 7, messageId: 99 }, api);
    expect(api.react).toHaveBeenCalledWith(
      expect.objectContaining({ messageId: 99, chatId: 7, reaction: '🔥' }),
    );
  });

  it('skips react when no messageId or chatId', async () => {
    const api = makeApi();
    engine.register('bot5', {
      trigger: 'message',
      actions: [{ type: 'react', payload: {} }],
    });

    await engine.execute('bot5', { type: 'message', text: 'x' }, api);
    expect(api.react).not.toHaveBeenCalled();
  });

  it('evaluates custom filters in a sandbox', async () => {
    const api = makeApi();
    engine.register('bot6', {
      trigger: 'message',
      filters: [{ type: 'custom', value: 'ctx.event.text.length > 5' }],
      actions: [{ type: 'log', payload: { message: 'long' } }],
    });

    await engine.execute('bot6', { type: 'message', text: 'short' }, api);
    expect(api.log).not.toHaveBeenCalled();

    await engine.execute('bot6', { type: 'message', text: 'a much longer text' }, api);
    expect(api.log).toHaveBeenCalled();
  });

  it('caches custom filter sandboxes per bot: same expression never leaks across bots', async () => {
    const apiA = makeApi();
    const apiB = makeApi();
    const expression = 'ctx.event.text.length > 5';
    engine.register('bot6a', {
      id: 'sA',
      trigger: 'message',
      filters: [{ type: 'custom', value: expression }],
      actions: [{ type: 'log', payload: { message: 'a-long' } }],
    });
    engine.register('bot6b', {
      id: 'sB',
      trigger: 'message',
      filters: [{ type: 'custom', value: expression }],
      actions: [{ type: 'log', payload: { message: 'b-long' } }],
    });

    await engine.execute('bot6a', { type: 'message', text: 'short' }, apiA);
    await engine.execute('bot6b', { type: 'message', text: 'a much longer text' }, apiB);
    expect(apiA.log).not.toHaveBeenCalled();
    expect(apiB.log).toHaveBeenCalled();
    expect(apiA.log).not.toHaveBeenCalledWith(expect.anything(), 'b-long');
  });

  it('re-registering the same script id does not fire it twice per event', async () => {
    const api = makeApi();
    const config = {
      id: 'dup-1',
      trigger: 'message',
      actions: [{ type: 'reply', payload: { text: 'once' } }],
    };
    engine.register('bot6c', config);
    engine.register('bot6c', config);

    await engine.execute('bot6c', { type: 'message', text: 'x', chatId: 1 }, api);
    expect(api.sendMessage).toHaveBeenCalledTimes(1);
  });

  it('custom filters cannot access process (sandboxed)', async () => {
    const api = makeApi();
    engine.register('bot7', {
      trigger: 'message',
      filters: [
        {
          type: 'custom',
          value: 'typeof process !== "undefined" ? true : (() => { throw new Error("nope") })()',
        },
      ],
      actions: [{ type: 'log', payload: { message: 'leak' } }],
    });

    await engine.execute('bot7', { type: 'message', text: 'x' }, api);
    expect(api.log).not.toHaveBeenCalled();
  });

  it('custom actions receive a frozen read-only ctx snapshot', async () => {
    const api = makeApi();
    engine.register('bot8', {
      trigger: 'message',
      actions: [{ type: 'custom', payload: { code: 'ctx.event.flag = true' } }],
    });

    const event = { type: 'message', text: 'x' } as Record<string, unknown>;
    await engine.execute('bot8', event, api);
    expect(event.flag).toBeUndefined();
  });

  it('null-prototype ctx blocks the constructor chain even with obfuscated access', async () => {
    const api = makeApi();
    engine.register('bot8b', {
      trigger: 'message',
      actions: [
        { type: 'custom', payload: { code: 'ctx["cons" + "tructor"]("return process")()' } },
      ],
    });

    await expect(
      engine.execute('bot8b', { type: 'message', text: 'x' }, api),
    ).resolves.toBeUndefined();
  });

  it('the bridged api cannot reach host-realm Function (no sandbox escape)', async () => {
    const api = makeApi();
    engine.register('bot8f', {
      trigger: 'message',
      actions: [
        {
          type: 'custom',
          payload: { code: 'ctx.api.sendMessage["cons" + "tructor"]("return process")()' },
        },
      ],
    });

    await expect(
      engine.execute('bot8f', { type: 'message', text: 'x' }, api),
    ).resolves.toBeUndefined();
  });

  it('the bridged api forwards method calls to the host', async () => {
    const api = makeApi();
    engine.register('bot8g', {
      trigger: 'message',
      actions: [
        {
          type: 'custom',
          payload: { code: 'await ctx.api.log("info", "from bridge"); await api.say("#c", "hi")' },
        },
      ],
    });

    await engine.execute('bot8g', { type: 'message', text: 'x' }, api);
    expect(api.log).toHaveBeenCalledWith('info', 'from bridge');
    expect(api.say).toHaveBeenCalledWith('#c', 'hi');
  });

  it('sanitizes api return values (host objects become plain data)', async () => {
    const api = makeApi();
    api.sendMessage.mockResolvedValue({ nested: { deep: true }, dropped: () => 'nope', ctor: 1 });

    engine.register('bot8h', {
      trigger: 'message',
      actions: [
        {
          type: 'custom',
          payload: {
            code: 'const r = await ctx.api.sendMessage(1, "x"); await ctx.api.log("info", r.nested && r.nested.deep && r.dropped === undefined ? "clean" : "dirty")',
          },
        },
      ],
    });

    await engine.execute('bot8h', { type: 'message', text: 'x' }, api);
    expect(api.sendMessage).toHaveBeenCalledWith(1, 'x');
    expect(api.log).toHaveBeenCalledWith('info', 'clean');
  });

  it('returned api values cannot reach host-realm Function', async () => {
    const api = makeApi();
    api.sendMessage.mockResolvedValue({ tag: 'obj' });

    engine.register('bot8i', {
      trigger: 'message',
      actions: [
        {
          type: 'custom',
          payload: {
            code: 'const r = await ctx.api.sendMessage(1, "x"); const F = (r && r["cons"+"tructor"]) ? r["cons"+"tructor"]["cons"+"tructor"] : null; await ctx.api.log("info", F ? "leak" : "clean")',
          },
        },
      ],
    });

    await engine.execute('bot8i', { type: 'message', text: 'x' }, api);
    expect(api.log).toHaveBeenCalledWith('info', 'clean');
  });

  it('fetch json/text stay in the VM realm (no host callable leaks)', async () => {
    const api = makeApi();
    api.fetch.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: new Map([['content-type', 'application/json']]),
      json: async () => ({ hello: 'world' }),
      text: async () => '{"hello":"world"}',
    });

    engine.register('bot8j', {
      trigger: 'message',
      actions: [
        {
          type: 'custom',
          payload: {
            code: 'const r = await ctx.api.fetch("https://example.com"); const j = await r.json(); let verdict = "clean"; try { const F = r.json["cons"+"tructor"]; if (F("return proc"+"ess")()) verdict = "escape"; } catch (e) { verdict = "blocked"; } await ctx.api.log("info", r.ok + ":" + j.hello + ":" + verdict)',
          },
        },
      ],
    });

    await engine.execute('bot8j', { type: 'message', text: 'x' }, api);
    expect(api.log).toHaveBeenCalledWith('info', 'true:world:blocked');
  });

  it('kills infinite-loop custom actions instead of freezing the worker', async () => {
    const api = makeApi();
    engine.register('bot8c', {
      trigger: 'message',
      actions: [
        { type: 'custom', payload: { code: 'while (true) {}' } },
        { type: 'reply', payload: { text: 'after' } },
      ],
    });

    const start = Date.now();
    await engine.execute('bot8c', { type: 'message', text: 'x', chatId: 1 }, api);
    expect(Date.now() - start).toBeLessThan(3000);
    expect(api.sendMessage).toHaveBeenCalledWith('1', 'after', expect.anything());
  });

  it('terminates custom actions that run away after an await (async infinite loop)', async () => {
    const api = makeApi();
    engine.register('bot8k', {
      trigger: 'message',
      actions: [
        // The vm watchdog only bounds the synchronous prefix; this continuation
        // (spawned by a resolved RPC await) would pin an in-process executor
        // forever. The worker thread is terminated instead.
        {
          type: 'custom',
          payload: { code: 'await ctx.api.log("info", "start"); while (true) {}' },
        },
        { type: 'reply', payload: { text: 'after' } },
      ],
    });

    const start = Date.now();
    await engine.execute('bot8k', { type: 'message', text: 'x', chatId: 1 }, api);
    expect(api.log).toHaveBeenCalledWith('info', 'start');
    expect(Date.now() - start).toBeGreaterThanOrEqual(4000);
    expect(api.sendMessage).toHaveBeenCalledWith('1', 'after', expect.anything());
  }, 15000);

  it('kills memory-exhausting custom actions instead of letting them OOM the process', async () => {
    const api = makeApi();
    engine.register('bot8m', {
      trigger: 'message',
      actions: [
        // `a.concat(a)` doubles a string until it exceeds the 64MB vm heap cap;
        // without resourceLimits this would balloon the worker's heap.
        {
          type: 'custom',
          payload: { code: 'let a = "x".repeat(1024); while (true) { a = a.concat(a); }' },
        },
        { type: 'reply', payload: { text: 'after' } },
      ],
    });

    const start = Date.now();
    await engine.execute('bot8m', { type: 'message', text: 'x', chatId: 1 }, api);
    expect(Date.now() - start).toBeLessThan(15000);
    expect(api.sendMessage).toHaveBeenCalledWith('1', 'after', expect.anything());
  }, 30000);
  it('webhook actions block private URLs', async () => {
    const api = makeApi();
    engine.register('bot8d', {
      trigger: 'message',
      actions: [{ type: 'webhook', payload: { url: 'http://127.0.0.1:9999/x' } }],
    });

    await engine.execute('bot8d', { type: 'message', text: 'x' }, api);
    expect(api.fetch).not.toHaveBeenCalled();
  });

  it('sets the cooldown even when the script fails', async () => {
    const api = makeApi();
    engine.register('bot8e', {
      trigger: 'message',
      cooldown: 60,
      actions: [{ type: 'reply', payload: { text: 'boom' } }],
    });

    const failingApi = makeApi();
    failingApi.sendMessage.mockRejectedValue(new Error('platform error'));
    await engine.execute('bot8e', { type: 'message', text: 'a', chatId: 1 }, failingApi);

    await engine.execute('bot8e', { type: 'message', text: 'b', chatId: 1 }, api);
    expect(api.sendMessage).not.toHaveBeenCalled();
  });

  it('honors if conditions', async () => {
    const api = makeApi();
    engine.register('bot9', {
      trigger: 'message',
      actions: [
        {
          type: 'if',
          condition: { field: 'text', operator: 'contains', value: 'yes' },
          actions: [{ type: 'reply', payload: { text: 'confirmed' } }],
        },
      ],
    });

    await engine.execute('bot9', { type: 'message', text: 'no way', chatId: 1 }, api);
    expect(api.sendMessage).not.toHaveBeenCalled();

    await engine.execute('bot9', { type: 'message', text: 'yes please', chatId: 1 }, api);
    expect(api.sendMessage).toHaveBeenCalledWith('1', 'confirmed', expect.anything());
  });

  it('sends webhook payloads via fetch', async () => {
    const api = makeApi();
    engine.register('bot10', {
      trigger: 'message',
      actions: [{ type: 'webhook', payload: { url: 'https://example.com/hook' } }],
    });

    await engine.execute('bot10', { type: 'message', text: 'x' }, api);
    expect(api.fetch).toHaveBeenCalledWith('https://example.com/hook', expect.anything());
  });

  it('filters by role (case-insensitive)', async () => {
    const api = makeApi();
    engine.register('bot11', {
      trigger: 'message',
      filters: [{ type: 'role', value: 'admin' }],
      actions: [{ type: 'reply', payload: { text: 'welcome admin' } }],
    });

    await engine.execute('bot11', { type: 'message', text: 'hi', role: 'member', chatId: 1 }, api);
    expect(api.sendMessage).not.toHaveBeenCalled();

    await engine.execute('bot11', { type: 'message', text: 'hi', role: 'ADMIN', chatId: 1 }, api);
    expect(api.sendMessage).toHaveBeenCalled();
  });

  it('role filter reads from a custom field', async () => {
    const api = makeApi();
    engine.register('bot12', {
      trigger: 'message',
      filters: [{ type: 'role', field: 'from.status', value: 'creator' }],
      actions: [{ type: 'reply', payload: { text: 'ok' } }],
    });

    await engine.execute(
      'bot12',
      { type: 'message', text: 'x', from: { status: 'creator' }, chatId: 1 },
      api,
    );
    expect(api.sendMessage).toHaveBeenCalled();
  });

  it('tolerates invalid regex filters', async () => {
    const api = makeApi();
    engine.register('bot13', {
      trigger: 'message',
      filters: [{ type: 'regex', value: '(' }],
      actions: [{ type: 'reply', payload: { text: 'nope' } }],
    });

    await expect(
      engine.execute('bot13', { type: 'message', text: 'x', chatId: 1 }, api),
    ).resolves.toBeUndefined();
    expect(api.sendMessage).not.toHaveBeenCalled();
  });

  it('blocks async filter expressions that would escape the vm timeout', async () => {
    const api = makeApi();
    engine.register('bot13b', {
      trigger: 'message',
      filters: [{ type: 'custom', value: '(async () => { await 1; return true })()' }],
      actions: [{ type: 'reply', payload: { text: 'fired' } }],
    });

    await engine.execute('bot13b', { type: 'message', text: 'x', chatId: 1 }, api);
    expect(api.sendMessage).not.toHaveBeenCalled();
  });

  it('treats a promise-valued filter expression as no-match', async () => {
    const api = makeApi();
    engine.register('bot13c', {
      trigger: 'message',
      filters: [{ type: 'custom', value: 'Promise.resolve(true)' }],
      actions: [{ type: 'reply', payload: { text: 'fired' } }],
    });

    await engine.execute('bot13c', { type: 'message', text: 'x', chatId: 1 }, api);
    expect(api.sendMessage).not.toHaveBeenCalled();
  });

  it('increment_counter persists across events', async () => {
    const api = makeApi();
    engine.register('bot14', {
      trigger: 'message',
      actions: [
        { type: 'increment_counter', payload: { name: 'hits' } },
        {
          type: 'if',
          condition: { field: 'counters.hits', operator: 'gte', value: 3 },
          actions: [{ type: 'reply', payload: { text: 'three hits' } }],
        },
      ],
    });

    await engine.execute('bot14', { type: 'message', text: 'a', chatId: 1 }, api);
    await engine.execute('bot14', { type: 'message', text: 'b', chatId: 1 }, api);
    expect(api.sendMessage).not.toHaveBeenCalled();

    await engine.execute('bot14', { type: 'message', text: 'c', chatId: 1 }, api);
    expect(api.sendMessage).toHaveBeenCalledWith('1', 'three hits', expect.anything());
  });

  it('forwards events to a target chat', async () => {
    const api = makeApi();
    engine.register('bot15', {
      trigger: 'message',
      actions: [{ type: 'forward', payload: { to: '-100123' } }],
    });

    await engine.execute('bot15', { type: 'message', text: 'hello', chatId: 1 }, api);
    expect(api.sendMessage).toHaveBeenCalledWith('-100123', expect.stringContaining('hello'));
    expect(api.log).toHaveBeenCalledWith('info', expect.stringContaining('Forwarded'));
  });

  it('supports eq/ne/gt/lt/regex/exists conditions', async () => {
    const api = makeApi();
    engine.register('bot16', {
      trigger: 'message',
      actions: [
        {
          type: 'if',
          condition: { field: 'text', operator: 'eq', value: 'ping' },
          actions: [{ type: 'reply', payload: { text: 'pong' } }],
        },
        {
          type: 'if',
          condition: { field: 'count', operator: 'gt', value: 5 },
          actions: [{ type: 'reply', payload: { text: 'many' } }],
        },
        {
          type: 'if',
          condition: { field: 'tag', operator: 'exists' },
          actions: [{ type: 'reply', payload: { text: 'tagged' } }],
        },
        {
          type: 'if',
          condition: { field: 'text', operator: 'regex', value: '^he' },
          actions: [{ type: 'reply', payload: { text: 'hello-ish' } }],
        },
        {
          type: 'if',
          condition: { field: 'text', operator: 'ne', value: 'ping' },
          actions: [{ type: 'reply', payload: { text: 'different' } }],
        },
      ],
    });

    await engine.execute(
      'bot16',
      { type: 'message', text: 'hello world', count: 10, tag: 'x', chatId: 1 },
      api,
    );
    const messages = api.sendMessage.mock.calls.map((c: unknown[]) => c[1]);
    expect(messages).toContain('many');
    expect(messages).toContain('tagged');
    expect(messages).toContain('hello-ish');
    expect(messages).toContain('different');
    expect(messages).not.toContain('pong');

    await engine.execute('bot16', { type: 'message', text: 'ping', chatId: 1 }, api);
    const messages2 = api.sendMessage.mock.calls.map((c: unknown[]) => c[1]);
    expect(messages2).toContain('pong');
    expect(messages2).toContain('different');
  });

  it('interpolates script variables and event paths', async () => {
    const api = makeApi();
    engine.register('bot17', {
      trigger: 'message',
      variables: { greeting: 'Hi', target: 'friend' },
      actions: [{ type: 'reply', payload: { text: '{greeting} {text}, {target}' } }],
    });

    await engine.execute('bot17', { type: 'message', text: 'there', chatId: 9 }, api);
    expect(api.sendMessage).toHaveBeenCalledWith('9', 'Hi there, friend', expect.anything());
  });

  it('respects enabled flag via unregister', async () => {
    const api = makeApi();
    engine.register('bot18', {
      trigger: 'message',
      actions: [{ type: 'reply', payload: { text: 'hi' } }],
    });

    await engine.execute('bot18', { type: 'message', text: 'x', chatId: 1 }, api);
    expect(api.sendMessage).toHaveBeenCalledTimes(1);

    engine.unregister('bot18');
    await engine.execute('bot18', { type: 'message', text: 'x', chatId: 1 }, api);
    expect(api.sendMessage).toHaveBeenCalledTimes(1);
  });

  it('enforces cooldown between firings', async () => {
    const api = makeApi();
    engine.register('bot19', {
      trigger: 'message',
      cooldown: 60,
      actions: [{ type: 'reply', payload: { text: 'slow down' } }],
    });

    await engine.execute('bot19', { type: 'message', text: 'a', chatId: 1 }, api);
    expect(api.sendMessage).toHaveBeenCalledTimes(1);

    await engine.execute('bot19', { type: 'message', text: 'b', chatId: 1 }, api);
    expect(api.sendMessage).toHaveBeenCalledTimes(1);

    (engine as unknown as { cooldowns: Map<string, number> }).cooldowns.clear();
    await engine.execute('bot19', { type: 'message', text: 'c', chatId: 1 }, api);
    expect(api.sendMessage).toHaveBeenCalledTimes(2);
  });

  it('reserves the cooldown synchronously so a hanging run blocks the next fire', async () => {
    const api = makeApi();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    api.sendMessage.mockImplementation(() => gate);
    engine.register('bot19b', {
      trigger: 'message',
      cooldown: 60,
      actions: [{ type: 'reply', payload: { text: 'one at a time' } }],
    });

    const first = engine.execute('bot19b', { type: 'message', text: 'a', chatId: 1 }, api);
    await new Promise((resolve) => setTimeout(resolve, 5));
    await engine.execute('bot19b', { type: 'message', text: 'b', chatId: 1 }, api);
    expect(api.sendMessage).toHaveBeenCalledTimes(1);

    release();
    await first;
    (engine as unknown as { cooldowns: Map<string, number> }).cooldowns.clear();
    await engine.execute('bot19b', { type: 'message', text: 'c', chatId: 1 }, api);
    expect(api.sendMessage).toHaveBeenCalledTimes(2);
  });

  it('random_reply picks one of the variants', async () => {
    const api = makeApi();
    engine.register('bot20', {
      trigger: 'message',
      actions: [{ type: 'random_reply', payload: { variants: ['one', 'two', 'three'] } }],
    });

    for (let i = 0; i < 20; i++) {
      await engine.execute('bot20', { type: 'message', text: 'x', chatId: 1 }, api);
    }
    expect(api.sendMessage).toHaveBeenCalledTimes(20);
    const texts = api.sendMessage.mock.calls.map((c: unknown[]) => c[1]);
    for (const t of texts) {
      expect(['one', 'two', 'three']).toContain(t);
    }
  });

  it('say action sends a channel message', async () => {
    const api = makeApi();
    engine.register('bot21', {
      trigger: 'message',
      actions: [{ type: 'say', payload: { channel: '#mychannel', message: 'Hello {username}' } }],
    });

    await engine.execute('bot21', { type: 'message', text: 'x', username: 'alice' }, api);
    expect(api.say).toHaveBeenCalledWith('#mychannel', 'Hello alice');
  });

  it('conditions read counters and interpolate them', async () => {
    const api = makeApi();
    engine.register('bot22', {
      trigger: 'message',
      actions: [
        { type: 'increment_counter', payload: { name: 'hits' } },
        {
          type: 'if',
          condition: { field: 'counters.hits', operator: 'eq', value: 2 },
          actions: [{ type: 'reply', payload: { text: 'second time! count={counters.hits}' } }],
        },
      ],
    });

    await engine.execute('bot22', { type: 'message', text: 'a', chatId: 1 }, api);
    await engine.execute('bot22', { type: 'message', text: 'b', chatId: 1 }, api);
    expect(api.sendMessage).toHaveBeenCalledTimes(1);
    expect(api.sendMessage).toHaveBeenCalledWith('1', 'second time! count=2', expect.anything());
  });

  it('conditions read variables', async () => {
    const api = makeApi();
    engine.register('bot23', {
      trigger: 'message',
      variables: { mode: 'strict' },
      actions: [
        {
          type: 'if',
          condition: { field: 'variables.mode', operator: 'eq', value: 'strict' },
          actions: [{ type: 'reply', payload: { text: 'strict mode on' } }],
        },
      ],
    });

    await engine.execute('bot23', { type: 'message', text: 'x', chatId: 1 }, api);
    expect(api.sendMessage).toHaveBeenCalled();
  });

  it('gte and lte conditions compare numerically', async () => {
    const api = makeApi();
    engine.register('bot28', {
      trigger: 'message',
      actions: [
        { type: 'increment_counter', payload: { name: 'visits' } },
        {
          type: 'if',
          condition: { field: 'counters.visits', operator: 'gte', value: 3 },
          actions: [{ type: 'reply', payload: { text: 'milestone {counters.visits}' } }],
        },
      ],
    });

    await engine.execute('bot28', { type: 'message', text: 'a', chatId: 1 }, api);
    await engine.execute('bot28', { type: 'message', text: 'b', chatId: 1 }, api);
    expect(api.sendMessage).not.toHaveBeenCalled();

    await engine.execute('bot28', { type: 'message', text: 'c', chatId: 1 }, api);
    expect(api.sendMessage).toHaveBeenCalledWith('1', 'milestone 3', expect.anything());

    await engine.execute('bot28', { type: 'message', text: 'd', chatId: 1 }, api);
    expect(api.sendMessage).toHaveBeenCalledWith('1', 'milestone 4', expect.anything());
  });

  it('condition operators can also be lte', async () => {
    const api = makeApi();
    engine.register('bot29', {
      trigger: 'message',
      actions: [
        { type: 'increment_counter', payload: { name: 'n' } },
        {
          type: 'if',
          condition: { field: 'counters.n', operator: 'lte', value: 2 },
          actions: [{ type: 'reply', payload: { text: 'early' } }],
        },
      ],
    });

    await engine.execute('bot29', { type: 'message', text: 'a', chatId: 1 }, api);
    await engine.execute('bot29', { type: 'message', text: 'b', chatId: 1 }, api);
    expect(api.sendMessage).toHaveBeenCalledTimes(2);

    await engine.execute('bot29', { type: 'message', text: 'c', chatId: 1 }, api);
    expect(api.sendMessage).toHaveBeenCalledTimes(2);
  });

  it('exposes remember/recall on the script api', async () => {
    const remember = vi.fn().mockResolvedValue(undefined);
    const recall = vi.fn().mockResolvedValue('saved');
    const api = { ...makeApi(), remember, recall };

    engine.register('bot24', {
      trigger: 'message',
      actions: [
        {
          type: 'custom',
          payload: {
            code: 'await ctx.api.remember("k", "v"); const v = await ctx.api.recall("k"); await ctx.api.log("info", String(v))',
          },
        },
      ],
    });

    await engine.execute('bot24', { type: 'message', text: 'x' }, api);
    expect(remember).toHaveBeenCalledWith('k', 'v');
    expect(recall).toHaveBeenCalledWith('k');
    expect(api.log).toHaveBeenCalledWith('info', 'saved');
  });

  it('reports bots that have interval scripts', async () => {
    engine.register('bot25', {
      trigger: 'interval',
      interval: 60,
      actions: [{ type: 'log', payload: { message: 'hb' } }],
    });
    engine.register('bot26', {
      trigger: 'message',
      actions: [{ type: 'reply', payload: { text: 'x' } }],
    });
    expect(engine.intervalBots()).toEqual(['bot25']);
  });

  it('does not fire interval scripts when the interval cooldown has not elapsed', async () => {
    const api = makeApi();
    engine.register('bot27', {
      trigger: 'interval',
      interval: 60,
      cooldown: 60,
      actions: [{ type: 'log', payload: { message: 'hb' } }],
    });

    await engine.execute('bot27', { type: 'interval' }, api);
    await engine.execute('bot27', { type: 'interval' }, api);
    expect(api.log).toHaveBeenCalledTimes(1);

    (engine as unknown as { cooldowns: Map<string, number> }).cooldowns.clear();
    await engine.execute('bot27', { type: 'interval' }, api);
    expect(api.log).toHaveBeenCalledTimes(2);
  });

  it('executeOnce runs a config directly, bypassing cooldown', async () => {
    const api = makeApi();
    const config: ScriptConfig = {
      trigger: 'message',
      cooldown: 60,
      actions: [{ type: 'reply', payload: { text: 'manual' } }],
    };

    await engine.executeOnce(config, 'bot30', { type: 'message', text: 'x', chatId: 1 }, api);
    await engine.executeOnce(config, 'bot30', { type: 'message', text: 'x', chatId: 1 }, api);
    expect(api.sendMessage).toHaveBeenCalledTimes(2);
  });

  it('executeOnce still applies filters', async () => {
    const api = makeApi();
    const config: ScriptConfig = {
      trigger: 'message',
      filters: [{ type: 'keyword', value: 'run' }],
      actions: [{ type: 'reply', payload: { text: 'fired' } }],
    };

    await engine.executeOnce(config, 'bot31', { type: 'message', text: 'nope', chatId: 1 }, api);
    expect(api.sendMessage).not.toHaveBeenCalled();

    await engine.executeOnce(config, 'bot31', { type: 'message', text: 'run now', chatId: 1 }, api);
    expect(api.sendMessage).toHaveBeenCalled();
  });
});
