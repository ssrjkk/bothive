import { describe, it, expect } from 'vitest';
import { BotStateMachine, BotState, BotTransition } from '../state-machine/bot-state.js';

describe('BotStateMachine', () => {
  it('starts in Idle state', () => {
    const sm = new BotStateMachine();
    expect(sm.currentState).toBe(BotState.Idle);
  });

  it('transitions Idle -> Connecting on Start', async () => {
    const sm = new BotStateMachine();
    await sm.dispatch(BotTransition.Start);
    expect(sm.currentState).toBe(BotState.Connecting);
  });

  it('transitions Connecting -> Running on Connect', async () => {
    const sm = new BotStateMachine(BotState.Connecting);
    await sm.dispatch(BotTransition.Connect);
    expect(sm.currentState).toBe(BotState.Running);
  });

  it('transitions Running -> Error on Fail', async () => {
    const sm = new BotStateMachine(BotState.Running);
    await sm.dispatch(BotTransition.Fail);
    expect(sm.currentState).toBe(BotState.Error);
  });

  it('transitions Error -> Reconnecting on Reconnect', async () => {
    const sm = new BotStateMachine(BotState.Error);
    await sm.dispatch(BotTransition.Reconnect);
    expect(sm.currentState).toBe(BotState.Reconnecting);
  });

  it('throws on invalid transition', async () => {
    const sm = new BotStateMachine(BotState.Idle);
    await expect(sm.dispatch(BotTransition.Disconnect)).rejects.toThrow();
  });

  it('calls listeners on transition', async () => {
    const sm = new BotStateMachine();
    const calls: { from: BotState; to: BotState }[] = [];

    sm.on(BotTransition.Start, async (from, to) => {
      calls.push({ from, to });
    });

    await sm.dispatch(BotTransition.Start);
    expect(calls).toHaveLength(1);
    expect(calls[0].from).toBe(BotState.Idle);
    expect(calls[0].to).toBe(BotState.Connecting);
  });

  it('can() returns true for valid transitions', () => {
    const sm = new BotStateMachine(BotState.Running);
    expect(sm.can(BotTransition.Stop)).toBe(true);
    expect(sm.can(BotTransition.Pause)).toBe(true);
    expect(sm.can(BotTransition.Start)).toBe(false);
  });

  it('isActive returns correct state', () => {
    const sm = new BotStateMachine();
    expect(sm.isActive()).toBe(false);
    sm.reset(BotState.Running);
    expect(sm.isActive()).toBe(true);
  });
});
