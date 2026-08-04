import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { hashPassword, verifyPassword } from '../password.js';

const PEPPER = 'test-pepper';

describe('password hashing', () => {
  beforeEach(() => {
    process.env.PASSWORD_PEPPER = PEPPER;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('hashes and verifies a password roundtrip', async () => {
    const hash = await hashPassword('s3cret');
    expect(hash).not.toContain('s3cret');
    expect(await verifyPassword('s3cret', hash)).toBe(true);
  });

  it('rejects a wrong password', async () => {
    const hash = await hashPassword('s3cret');
    expect(await verifyPassword('wrong', hash)).toBe(false);
  });

  it('rejects legacy un-hashed tokens', async () => {
    expect(await verifyPassword('admin123', 'admin123')).toBe(false);
  });

  it('rejects an invalid stored format', async () => {
    expect(await verifyPassword('x', 'not-a-valid-hash')).toBe(false);
  });
});
