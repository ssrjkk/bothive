import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

const PEPPER = process.env.PASSWORD_PEPPER ?? 'bothive-default-pepper';

if (PEPPER === 'bothive-default-pepper' && process.env.NODE_ENV === 'production') {
  throw new Error('PASSWORD_PEPPER must be set to a strong random value in production');
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password + PEPPER, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const derived = scryptSync(password + PEPPER, salt, 64).toString('hex');
  try {
    return timingSafeEqual(Buffer.from(derived), Buffer.from(hash));
  } catch {
    return false;
  }
}
