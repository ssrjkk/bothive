import { describe, it, expect, afterEach } from 'vitest';
import { isStrongSecret, validateApiSecrets, validateWorkerSecrets } from '../utils/secrets.js';

const strong = 's3cr3t-'.repeat(4);

describe('isStrongSecret', () => {
  it('rejects missing, short and default values', () => {
    expect(isStrongSecret(undefined)).toBe(false);
    expect(isStrongSecret('')).toBe(false);
    expect(isStrongSecret('short')).toBe(false);
    expect(isStrongSecret('bothive-default-pepper')).toBe(false);
    expect(isStrongSecret('change-me')).toBe(false);
    expect(isStrongSecret('your-32-char-key-here-change-it')).toBe(false);
  });

  it('accepts long random values regardless of case', () => {
    expect(isStrongSecret(strong)).toBe(true);
    expect(isStrongSecret(strong.toUpperCase())).toBe(true);
  });
});

describe('validateApiSecrets', () => {
  afterEach(() => {
    delete process.env.JWT_SECRET;
    delete process.env.ENCRYPTION_KEY;
    delete process.env.PASSWORD_PEPPER;
    delete process.env.NODE_ENV;
  });

  it('throws when JWT_SECRET is missing or weak', () => {
    delete process.env.JWT_SECRET;
    process.env.ENCRYPTION_KEY = strong;
    expect(() => validateApiSecrets()).toThrow(/JWT_SECRET/);
    process.env.JWT_SECRET = 'change-me';
    expect(() => validateApiSecrets()).toThrow(/JWT_SECRET/);
  });

  it('throws when ENCRYPTION_KEY is missing or weak', () => {
    process.env.JWT_SECRET = strong;
    delete process.env.ENCRYPTION_KEY;
    expect(() => validateApiSecrets()).toThrow(/ENCRYPTION_KEY/);
    process.env.ENCRYPTION_KEY = 'bothive-default-pepper';
    expect(() => validateApiSecrets()).toThrow(/ENCRYPTION_KEY/);
  });

  it('throws when PASSWORD_PEPPER is a known default', () => {
    process.env.JWT_SECRET = strong;
    process.env.ENCRYPTION_KEY = strong;
    process.env.PASSWORD_PEPPER = 'bothive-default-pepper';
    expect(() => validateApiSecrets()).toThrow(/PASSWORD_PEPPER/);
  });

  it('requires PASSWORD_PEPPER in production', () => {
    process.env.JWT_SECRET = strong;
    process.env.ENCRYPTION_KEY = strong;
    process.env.NODE_ENV = 'production';
    expect(() => validateApiSecrets()).toThrow(/PASSWORD_PEPPER/);
  });

  it('passes with strong secrets', () => {
    process.env.JWT_SECRET = strong;
    process.env.ENCRYPTION_KEY = strong;
    process.env.PASSWORD_PEPPER = 'another-strong-pepper-value';
    expect(() => validateApiSecrets()).not.toThrow();
  });
});

describe('validateWorkerSecrets', () => {
  afterEach(() => {
    delete process.env.ENCRYPTION_KEY;
    delete process.env.NODE_ENV;
  });

  it('does not block dev runs without a key', () => {
    delete process.env.ENCRYPTION_KEY;
    expect(() => validateWorkerSecrets()).not.toThrow();
  });

  it('requires a strong key in production', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.ENCRYPTION_KEY;
    expect(() => validateWorkerSecrets()).toThrow(/ENCRYPTION_KEY/);
    process.env.ENCRYPTION_KEY = strong;
    expect(() => validateWorkerSecrets()).not.toThrow();
  });
});
