import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt) as (
  password: string,
  salt: string,
  keylen: number,
) => Promise<Buffer>;

const PEPPER = process.env.PASSWORD_PEPPER ?? 'bothive-default-pepper';

if (PEPPER === 'bothive-default-pepper' && process.env.NODE_ENV === 'production') {
  throw new Error('PASSWORD_PEPPER must be set to a strong random value in production');
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString('hex');
  const hash = await scryptAsync(password + PEPPER, salt, 64);
  return `${salt}:${hash.toString('hex')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const derived = await scryptAsync(password + PEPPER, salt, 64);
  try {
    return timingSafeEqual(derived, Buffer.from(hash, 'hex'));
  } catch {
    return false;
  }
}
