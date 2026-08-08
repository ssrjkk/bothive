import { describe, it, expect } from 'vitest';
import { getPattern, listPatterns } from '../patterns/library.js';

describe('Pattern library', () => {
  it('exposes the expected pattern set', () => {
    const ids = listPatterns().map((p) => p.id);
    expect(ids).toContain('welcome');
    expect(ids).toContain('auto-reply');
    expect(ids).toContain('command');
    expect(ids).toContain('counter');
    expect(ids).toContain('moderation');
    expect(ids).toContain('random-response');
    expect(ids).toContain('donation-thanks');
    expect(ids).toContain('link-guard');
    expect(ids).toContain('heartbeat');
    expect(ids).toContain('raid-host-thanks');
    expect(ids).toContain('threshold-alert');
    expect(ids).toHaveLength(11);
  });

  it('listPatterns strips the generate function', () => {
    for (const p of listPatterns()) {
      expect(p).not.toHaveProperty('generate');
      expect(p.id).toBeTruthy();
      expect(p.params).toBeInstanceOf(Array);
    }
  });

  it('getPattern finds a pattern by id and returns undefined otherwise', () => {
    expect(getPattern('counter')?.name).toBe('Counter tracker');
    expect(getPattern('nope')).toBeUndefined();
  });

  it('welcome pattern builds a greeting reply', () => {
    const config = getPattern('welcome')!.generate({
      trigger: 'follow',
      message: 'Hi {username}!',
    });
    expect(config.trigger).toBe('follow');
    expect(config.actions).toEqual([{ type: 'reply', payload: { text: 'Hi {username}!' } }]);
  });

  it('welcome pattern posts to a channel for follow events when a channel is given', () => {
    const config = getPattern('welcome')!.generate({
      trigger: 'follow',
      message: 'Welcome {username}!',
      channel: '#mychannel',
    });
    expect(config.actions).toEqual([
      { type: 'say', payload: { channel: '#mychannel', message: 'Welcome {username}!' } },
    ]);
  });

  it('welcome pattern still replies when channel is empty', () => {
    const config = getPattern('welcome')!.generate({
      trigger: 'follow',
      message: 'Hi',
      channel: '',
    });
    expect(config.actions).toEqual([{ type: 'reply', payload: { text: 'Hi' } }]);
  });

  it('link-guard pattern warns on URLs with a cooldown', () => {
    const config = getPattern('link-guard')!.generate({ warning: 'No links', cooldown: 15 });
    expect(config.filters![0]).toEqual({ type: 'regex', value: '(?:https?:\\/\\/|www\\.)\\S+' });
    expect(config.cooldown).toBe(15);
    expect(config.actions).toEqual([{ type: 'reply', payload: { text: 'No links' } }]);
  });

  it('link-guard skips cooldown when set to zero', () => {
    const config = getPattern('link-guard')!.generate({ warning: 'No links', cooldown: 0 });
    expect(config.cooldown).toBeUndefined();
  });

  it('heartbeat pattern schedules an interval with a say action', () => {
    const config = getPattern('heartbeat')!.generate({
      intervalSeconds: 120,
      message: 'beep',
      channel: '#x',
    });
    expect(config.trigger).toBe('interval');
    expect(config.interval).toBe(120);
    expect(config.cooldown).toBe(120);
    expect(config.actions).toEqual([{ type: 'say', payload: { channel: '#x', message: 'beep' } }]);
  });

  it('heartbeat pattern logs instead when no channel is given', () => {
    const config = getPattern('heartbeat')!.generate({
      intervalSeconds: 60,
      message: 'beep',
      channel: '',
    });
    expect(config.actions).toEqual([{ type: 'log', payload: { level: 'info', message: 'beep' } }]);
  });

  it('heartbeat pattern enforces a minimum interval', () => {
    const config = getPattern('heartbeat')!.generate({
      intervalSeconds: 1,
      message: 'x',
      channel: '',
    });
    expect(config.interval).toBe(10);
  });

  it('auto-reply escapes keywords into a regex filter and applies cooldown', () => {
    const config = getPattern('auto-reply')!.generate({
      keywords: 'hello, hi.',
      reply: 'Hey!',
      cooldown: 30,
    });
    expect(config.filters![0].type).toBe('regex');
    expect(config.filters![0].value).toBe('\\b(hello|hi\\.)\\b');
    expect(config.cooldown).toBe(30);
    expect(config.actions).toEqual([{ type: 'reply', payload: { text: 'Hey!' } }]);
  });

  it('command pattern builds a prefix-scoped regex', () => {
    const config = getPattern('command')!.generate({
      prefix: '/',
      command: 'start',
      reply: 'Welcome!',
    });
    expect(config.filters![0].value).toBe('^/start\\b');
  });

  it('counter pattern increments and references the counter in the reply', () => {
    const config = getPattern('counter')!.generate({
      counterName: 'visits',
      reply: 'You are visitor {counters.visits}',
    });
    expect(config.actions[0]).toEqual({ type: 'increment_counter', payload: { name: 'visits' } });
    expect(config.actions).toContainEqual({
      type: 'reply',
      payload: { text: 'You are visitor {counters.visits}' },
    });
  });

  it('moderation pattern warns on banned words with cooldown', () => {
    const config = getPattern('moderation')!.generate({
      banned: 'spam,scam',
      warning: 'Stop that',
      cooldown: 5,
    });
    expect(config.filters![0].value).toBe('\\b(spam|scam)\\b');
    expect(config.cooldown).toBe(5);
    expect(config.actions[0].type).toBe('reply');
  });

  it('random-response pattern splits variants and emits random_reply', () => {
    const config = getPattern('random-response')!.generate({
      keywords: '!roll',
      variants: 'A\nB\nC',
    });
    expect(config.actions).toEqual([
      { type: 'random_reply', payload: { variants: ['A', 'B', 'C'] } },
    ]);
  });

  it('donation-thanks pattern gates on amount threshold', () => {
    const config = getPattern('donation-thanks')!.generate({
      minAmount: 5,
      thanks: 'Thanks {amount}',
    });
    expect(config.trigger).toBe('donation');
    const ifStep = config.actions[0];
    expect(ifStep.type).toBe('if');
    expect(ifStep.condition).toEqual({ field: 'amount', operator: 'gt', value: 5 });
  });

  it('raid-host-thanks pattern replies directly when no minimum is set', () => {
    const config = getPattern('raid-host-thanks')!.generate({
      trigger: 'raid',
      message: 'ty!',
      minViewers: 0,
    });
    expect(config.trigger).toBe('raid');
    expect(config.actions).toEqual([{ type: 'reply', payload: { text: 'ty!' } }]);
  });

  it('raid-host-thanks pattern gates on viewer count with gte', () => {
    const config = getPattern('raid-host-thanks')!.generate({
      trigger: 'host',
      message: 'ty!',
      minViewers: 50,
    });
    expect(config.trigger).toBe('host');
    const ifStep = config.actions[0];
    expect(ifStep.type).toBe('if');
    expect(ifStep.condition).toEqual({ field: 'viewers', operator: 'gte', value: 50 });
  });

  it('threshold-alert pattern increments then announces at a milestone', () => {
    const config = getPattern('threshold-alert')!.generate({
      counterName: 'visits',
      threshold: 100,
      message: 'Milestone {counters.visits}',
    });
    expect(config.actions[0]).toEqual({ type: 'increment_counter', payload: { name: 'visits' } });
    const ifStep = config.actions[1];
    expect(ifStep.type).toBe('if');
    expect(ifStep.condition).toEqual({ field: 'counters.visits', operator: 'gte', value: 100 });
  });
});
