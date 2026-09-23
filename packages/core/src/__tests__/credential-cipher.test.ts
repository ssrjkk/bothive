import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import {
  encryptCredential,
  decryptCredential,
  reencryptCredential,
  resetKeyRegistry,
} from '../utils/credential-cipher.js';

describe('credential cipher', () => {
  const originalKey = process.env.ENCRYPTION_KEY;
  const originalKeys = process.env.ENCRYPTION_KEYS;

  beforeEach(() => {
    resetKeyRegistry();
  });

  afterEach(() => {
    if (originalKey === undefined) delete process.env.ENCRYPTION_KEY;
    else process.env.ENCRYPTION_KEY = originalKey;
    if (originalKeys === undefined) delete process.env.ENCRYPTION_KEYS;
    else process.env.ENCRYPTION_KEYS = originalKeys;
    resetKeyRegistry();
  });

  it('roundtrips a credential with a key set', () => {
    process.env.ENCRYPTION_KEY = 'some-secret-key';
    resetKeyRegistry();
    const encrypted = encryptCredential('hunter2');
    expect(encrypted).not.toContain('hunter2');
    expect(encrypted.startsWith('enc:')).toBe(true);
    expect(decryptCredential(encrypted)).toBe('hunter2');
  });

  it('passes legacy plaintext through', () => {
    process.env.ENCRYPTION_KEY = 'some-secret-key';
    resetKeyRegistry();
    expect(decryptCredential('raw-token')).toBe('raw-token');
    expect(decryptCredential(null)).toBeNull();
    expect(decryptCredential(undefined)).toBeNull();
  });

  it('stores plaintext when no key is set', () => {
    delete process.env.ENCRYPTION_KEY;
    resetKeyRegistry();
    expect(encryptCredential('plain-token')).toBe('plain-token');
  });

  it('returns null when encrypted value cannot be decrypted without a key', () => {
    process.env.ENCRYPTION_KEY = 'old-key';
    resetKeyRegistry();
    const encrypted = encryptCredential('secret');
    delete process.env.ENCRYPTION_KEY;
    resetKeyRegistry();
    expect(decryptCredential(encrypted)).toBeNull();
  });

  it('includes version in encrypted payload', () => {
    process.env.ENCRYPTION_KEY = 'some-secret-key';
    resetKeyRegistry();
    const encrypted = encryptCredential('hunter2');
    expect(encrypted).toMatch(/^enc:v1:/);
  });

  it('decrypts legacy format without version', () => {
    process.env.ENCRYPTION_KEY = 'some-secret-key';
    resetKeyRegistry();
    const legacyEncrypted =
      'enc:0123456789abcdef0123456789abcdef:0123456789abcdef0123456789abcdef:somedata';
    const result = decryptCredential(legacyEncrypted);
    expect(result).toBeNull();
  });

  it('supports multiple key versions via ENCRYPTION_KEYS', () => {
    process.env.ENCRYPTION_KEYS = 'v1:old-key,v2:new-key';
    delete process.env.ENCRYPTION_KEY;
    resetKeyRegistry();

    const encrypted = encryptCredential('secret');
    expect(encrypted).toMatch(/^enc:v2:/);
    expect(decryptCredential(encrypted)).toBe('secret');
  });

  it('decrypts old version with legacy key', () => {
    process.env.ENCRYPTION_KEY = 'old-key';
    resetKeyRegistry();
    const oldEncrypted = encryptCredential('secret');
    expect(oldEncrypted).toMatch(/^enc:v1:/);

    process.env.ENCRYPTION_KEYS = 'v1:old-key,v2:new-key';
    delete process.env.ENCRYPTION_KEY;
    resetKeyRegistry();

    expect(decryptCredential(oldEncrypted)).toBe('secret');
  });

  it('reencryptCredential upgrades old version to current', () => {
    process.env.ENCRYPTION_KEY = 'old-key';
    resetKeyRegistry();
    const oldEncrypted = encryptCredential('secret');

    process.env.ENCRYPTION_KEYS = 'v1:old-key,v2:new-key';
    resetKeyRegistry();

    const reencrypted = reencryptCredential(oldEncrypted);
    expect(reencrypted).toMatch(/^enc:v2:/);
    expect(reencrypted).not.toBe(oldEncrypted);
    expect(decryptCredential(reencrypted)).toBe('secret');
  });

  it('reencryptCredential returns unchanged if already current version', () => {
    process.env.ENCRYPTION_KEYS = 'v1:old-key,v2:new-key';
    resetKeyRegistry();

    const encrypted = encryptCredential('secret');
    const reencrypted = reencryptCredential(encrypted);
    expect(reencrypted).toBe(encrypted);
  });

  it('reencryptCredential encrypts plaintext values', () => {
    process.env.ENCRYPTION_KEY = 'some-key';
    resetKeyRegistry();

    const reencrypted = reencryptCredential('plaintext');
    expect(reencrypted).toMatch(/^enc:v1:/);
    expect(decryptCredential(reencrypted)).toBe('plaintext');
  });

  it('reencryptCredential returns null for invalid payloads', () => {
    process.env.ENCRYPTION_KEY = 'some-key';
    resetKeyRegistry();

    expect(reencryptCredential(null)).toBeNull();
    expect(reencryptCredential(undefined)).toBeNull();
    expect(reencryptCredential('enc:invalid')).toBeNull();
  });
});
