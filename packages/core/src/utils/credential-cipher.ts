import { createHash } from 'node:crypto';
import { encrypt, decrypt } from './crypto.js';

const ENC_PREFIX = 'enc:';
const DEFAULT_VERSION = 'v1';

interface KeyRegistry {
  current: { version: string; key: string };
  legacy: Map<string, string>;
}

let keyRegistry: KeyRegistry | null = null;

function buildKeyRegistry(): KeyRegistry {
  const keysEnv = process.env.ENCRYPTION_KEYS;
  const singleKeyEnv = process.env.ENCRYPTION_KEY;

  if (keysEnv) {
    const entries = keysEnv
      .split(',')
      .map((e) => e.trim())
      .filter(Boolean);
    if (entries.length === 0)
      throw new Error('[credential-cipher] ENCRYPTION_KEYS is set but empty');

    const current = entries[entries.length - 1];
    const [currentVersion, currentRaw] = current.split(':');
    if (!currentRaw)
      throw new Error('[credential-cipher] ENCRYPTION_KEYS format must be version:key,...');

    const currentKey = createHash('sha256').update(currentRaw).digest('hex');
    const legacy = new Map<string, string>();

    for (let i = 0; i < entries.length - 1; i++) {
      const [ver, raw] = entries[i].split(':');
      if (!raw)
        throw new Error(
          `[credential-cipher] ENCRYPTION_KEYS entry "${entries[i]}" missing version:key format`,
        );
      legacy.set(ver, createHash('sha256').update(raw).digest('hex'));
    }

    return { current: { version: currentVersion, key: currentKey }, legacy };
  }

  if (singleKeyEnv) {
    const key = createHash('sha256').update(singleKeyEnv).digest('hex');
    return { current: { version: DEFAULT_VERSION, key }, legacy: new Map() };
  }

  return { current: { version: DEFAULT_VERSION, key: '' }, legacy: new Map() };
}

function getRegistry(): KeyRegistry {
  if (!keyRegistry) keyRegistry = buildKeyRegistry();
  return keyRegistry;
}

export function resetKeyRegistry(): void {
  keyRegistry = null;
}

function getKey(): string {
  return getRegistry().current.key;
}

function getKeyVersion(): string {
  return getRegistry().current.version;
}

let warned = false;

export function encryptCredential(value: string): string {
  const registry = getRegistry();
  const key = registry.current.key;
  if (!key) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        '[credential-cipher] ENCRYPTION_KEY is required in production — refusing to store credentials in plaintext',
      );
    }
    if (!warned) {
      warned = true;
      console.warn(
        '[credential-cipher] ENCRYPTION_KEY not set — storing credentials in plaintext (dev only)',
      );
    }
    return value;
  }
  try {
    return `${ENC_PREFIX}${registry.current.version}:${encrypt(value, key)}`;
  } catch (err) {
    console.error('[credential-cipher] encryption failed:', err);
    throw new Error(
      '[credential-cipher] encryption failed — refusing to store credential in plaintext',
      { cause: err },
    );
  }
}

export function decryptCredential(value: string | null | undefined): string | null {
  if (!value) return null;
  if (!value.startsWith(ENC_PREFIX)) return value;

  const payload = value.slice(ENC_PREFIX.length);
  const registry = getRegistry();

  const parts = payload.split(':');
  let version: string;
  let encryptedPart: string;

  if (parts.length === 4) {
    [version, encryptedPart] = [parts[0], parts.slice(1).join(':')];
  } else if (parts.length === 3) {
    version = DEFAULT_VERSION;
    encryptedPart = payload;
  } else {
    console.error('[credential-cipher] invalid encrypted payload format');
    return null;
  }

  const key =
    version === registry.current.version ? registry.current.key : registry.legacy.get(version);
  if (!key) {
    console.error(`[credential-cipher] no key found for version "${version}"`);
    return null;
  }

  try {
    return decrypt(encryptedPart, key);
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

/**
 * Re-encrypts a value from an old key version to the current key version.
 * Returns the value unchanged if it's already encrypted with the current version.
 */
export function reencryptCredential(value: string | null | undefined): string | null {
  if (!value) return null;
  if (!value.startsWith(ENC_PREFIX)) return encryptCredential(value);

  const payload = value.slice(ENC_PREFIX.length);
  const parts = payload.split(':');
  const registry = getRegistry();

  let version: string;
  if (parts.length === 4) {
    version = parts[0];
  } else if (parts.length === 3) {
    version = DEFAULT_VERSION;
  } else {
    return null;
  }

  if (version === registry.current.version) return value;

  const decrypted = decryptCredential(value);
  if (!decrypted) return null;
  return encryptCredential(decrypted);
}
