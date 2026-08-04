import { describe, it, expect, vi } from 'vitest';
import { EventBus, Events } from '../events/event-bus.js';

describe('EventBus', () => {
  it('delivers events to registered handlers', async () => {
    const bus = new EventBus();
    const handler = vi.fn().mockResolvedValue(undefined);
    bus.on('test.event', handler);

    await bus.emit('test.event', { id: 1 });
    expect(handler).toHaveBeenCalledWith({ id: 1 });
  });

  it('off removes a handler', async () => {
    const bus = new EventBus();
    const handler = vi.fn().mockResolvedValue(undefined);
    bus.on('test.event', handler);
    bus.off('test.event', handler);

    await bus.emit('test.event', { id: 1 });
    expect(handler).not.toHaveBeenCalled();
  });

  it('isolates handler errors', async () => {
    const bus = new EventBus();
    const bad = vi.fn().mockRejectedValue(new Error('boom'));
    const good = vi.fn().mockResolvedValue(undefined);
    bus.on('test.event', bad);
    bus.on('test.event', good);

    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await expect(bus.emit('test.event', {})).resolves.toBeUndefined();
    expect(good).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('caps history to the last 100 events', async () => {
    const bus = new EventBus();
    for (let i = 0; i < 250; i++) {
      await bus.emit('test.event', i);
    }

    const history = bus.getHistory<number>('test.event', 1000);
    expect(history.length).toBe(100);
    expect(history[0]).toBe(150);
    expect(history[99]).toBe(249);
  });

  it('getHistory respects the limit', async () => {
    const bus = new EventBus();
    await bus.emit('test.event', 1);
    await bus.emit('test.event', 2);
    await bus.emit('test.event', 3);

    expect(bus.getHistory<number>('test.event', 2)).toEqual([2, 3]);
  });

  it('clearHistory removes stored events', async () => {
    const bus = new EventBus();
    await bus.emit('test.event', 1);
    bus.clearHistory();
    expect(bus.getHistory('test.event')).toEqual([]);
  });

  it('exposes the canonical event names', () => {
    expect(Events.BotConnected).toBe('bot.connected');
    expect(Events.BotDisconnected).toBe('bot.disconnected');
    expect(Events.BotError).toBe('bot.error');
  });
});
