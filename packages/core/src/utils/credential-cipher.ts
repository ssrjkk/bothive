import { createHash } from 'node:crypto';
import { encrypt, decrypt } from './crypto.js';

const ENC_PREFIX = 'enc:';

function getKey(): string {
  const raw = process.env.ENCRYPTION_KEY ?? '';
  if (!raw) return '';
  return createHash('sha256').update(raw).digest('hex');
}

let warned = false;

export function encryptCredential(value: string): string {
  const key = getKey();
  if (!key) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        '[credential-cipher] ENCRYPTION_KEY is required in production — refusing to store credentials in plaintext',
      );
    }
    if (!warned) {
      warned = true;
      console.warn('[credential-cipher] ENCRYPTION_KEY not set — storing credentials in plaintext (dev only)');
    }
    return value;
  }
  try {
    return `${ENC_PREFIX}${encrypt(value, key)}`;
  } catch (err) {
    console.error('[credential-cipher] encryption failed:', err);
    throw new Error('[credential-cipher] encryption failed — refusing to store credential in plaintext', { cause: err });
  }
}

export function decryptCredential(value: string | null | undefined): string | null {
  if (!value) return null;
  if (!value.startsWith(ENC_PREFIX)) return value;
  const key = getKey();
  if (!key) {
    console.error('[credential-cipher] cannot decrypt: ENCRYPTION_KEY not set');
    return null;
  }
  try {
    return decrypt(value.slice(ENC_PREFIX.length), key);
  } catch (err) {
    console.error('[credential-cipher] decryption failed:', err);
    return null;
  }
}

/**
 * Returns the value unchanged when it is already in encrypted form (round-trip
 * of a backup export), otherwise encrypts a plaintext value so imported
 * credentials are stored the same way as API-created ones.
 */
export function ensureEncrypted(value: string | null | undefined): string | null {
  if (!value) return null;
  if (value.startsWith(ENC_PREFIX)) return value;
  return encryptCredential(value);
}
