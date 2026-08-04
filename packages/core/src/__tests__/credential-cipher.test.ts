import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { encryptCredential, decryptCredential } from '../utils/credential-cipher.js';

describe('credential cipher', () => {
  const originalKey = process.env.ENCRYPTION_KEY;

  afterEach(() => {
    if (originalKey === undefined) delete process.env.ENCRYPTION_KEY;
    else process.env.ENCRYPTION_KEY = originalKey;
  });

  it('roundtrips a credential with a key set', () => {
    process.env.ENCRYPTION_KEY = 'some-secret-key';
    const encrypted = encryptCredential('hunter2');
    expect(encrypted).not.toContain('hunter2');
    expect(encrypted.startsWith('enc:')).toBe(true);
    expect(decryptCredential(encrypted)).toBe('hunter2');
  });

  it('passes legacy plaintext through', () => {
    process.env.ENCRYPTION_KEY = 'some-secret-key';
    expect(decryptCredential('raw-token')).toBe('raw-token');
    expect(decryptCredential(null)).toBeNull();
    expect(decryptCredential(undefined)).toBeNull();
  });

  it('stores plaintext when no key is set', () => {
    delete process.env.ENCRYPTION_KEY;
    expect(encryptCredential('plain-token')).toBe('plain-token');
  });

  it('returns null when encrypted value cannot be decrypted without a key', () => {
    process.env.ENCRYPTION_KEY = 'old-key';
    const encrypted = encryptCredential('secret');
    delete process.env.ENCRYPTION_KEY;
    expect(decryptCredential(encrypted)).toBeNull();
  });
});
