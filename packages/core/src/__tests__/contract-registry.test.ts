import { describe, it, expect } from 'vitest';
import {
  contractVersion,
  isContractSupported,
  assertContractSupported,
  latestContractVersions,
  stampContractVersion,
  EVENT_CONTRACT_VERSION,
  EVENT_ENVELOPE_VERSION,
  PLATFORMS,
} from '../contracts/contract-registry.js';

describe('contract registry', () => {
  it('resolves the base version for any platform/event pair', () => {
    expect(contractVersion('telegram', 'message')).toBe(EVENT_CONTRACT_VERSION);
    expect(contractVersion('twitch', 'raid')).toBe(EVENT_CONTRACT_VERSION);
    expect(contractVersion('crypto', 'price')).toBe(EVENT_CONTRACT_VERSION);
  });

  it('falls back to the base version for unknown events/platforms', () => {
    expect(contractVersion('telegram', 'unknown-event')).toBe(EVENT_CONTRACT_VERSION);
    expect(contractVersion('unknown', 'message')).toBe(EVENT_CONTRACT_VERSION);
  });

  it('treats versions 1..=current as supported', () => {
    expect(isContractSupported('telegram', 'message', 1)).toBe(true);
    expect(isContractSupported('telegram', 'message', EVENT_CONTRACT_VERSION)).toBe(true);
  });

  it('rejects future and malformed versions', () => {
    expect(isContractSupported('telegram', 'message', EVENT_CONTRACT_VERSION + 1)).toBe(false);
    expect(isContractSupported('telegram', 'message', 0)).toBe(false);
    expect(isContractSupported('telegram', 'message', Number.NaN)).toBe(false);
  });

  it('assertContractSupported throws only for unsupported versions', () => {
    expect(() => assertContractSupported('twitch', 'follow', 1)).not.toThrow();
    expect(() => assertContractSupported('twitch', 'follow', EVENT_CONTRACT_VERSION + 1)).toThrow(
      /Unsupported event contract/,
    );
  });

  it('latestContractVersions covers every platform and the error event', () => {
    const versions = latestContractVersions();
    expect(Object.keys(versions)).toEqual(PLATFORMS);
    for (const platform of PLATFORMS) {
      expect(versions[platform].error).toBe(EVENT_CONTRACT_VERSION);
      expect(Object.values(versions[platform]).every((v) => v >= 1)).toBe(true);
    }
  });

  it('stampContractVersion attaches the current version', () => {
    const stamped = stampContractVersion({
      botId: 'b1',
      platform: 'twitter',
      type: 'message',
      payload: { text: 'hi' },
      timestamp: new Date(),
    });
    expect(stamped.v).toBe(contractVersion('twitter', 'message'));
  });

  it('envelope version is a string semver-ish constant', () => {
    expect(EVENT_ENVELOPE_VERSION).toBe('1');
  });
});
