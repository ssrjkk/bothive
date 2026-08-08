const WEAK_SECRETS = new Set([
  'change-me',
  'change-me-to-a-random-secret',
  'change-me-in-production',
  'your-32-char-key-here-change-it',
  'your-pepper-here-change-it',
  '0123456789abcdef0123456789abcdef',
  'bothive-default-pepper',
]);

export function isStrongSecret(value: string | undefined, minLength = 16): boolean {
  if (!value || value.length < minLength) return false;
  return !WEAK_SECRETS.has(value.trim().toLowerCase());
}

export function validateApiSecrets(): void {
  const jwtSecret = process.env.JWT_SECRET;
  if (!isStrongSecret(jwtSecret)) {
    throw new Error(
      'JWT_SECRET must be set to a strong random value (at least 16 characters, not a default). ' +
        "Generate one with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"",
    );
  }

  const encryptionKey = process.env.ENCRYPTION_KEY;
  if (!isStrongSecret(encryptionKey)) {
    throw new Error(
      'ENCRYPTION_KEY must be set to a strong random value (at least 16 characters, not a default). ' +
        'WARNING: changing it later makes previously stored credentials undecryptable.',
    );
  }

  const pepper = process.env.PASSWORD_PEPPER;
  if (pepper !== undefined && pepper !== '' && !isStrongSecret(pepper)) {
    throw new Error('PASSWORD_PEPPER must not use a known default value');
  }
  if ((pepper === undefined || pepper === '') && process.env.NODE_ENV === 'production') {
    throw new Error('PASSWORD_PEPPER must be set in production');
  }
}

export function validateWorkerSecrets(): void {
  const encryptionKey = process.env.ENCRYPTION_KEY;
  if (process.env.NODE_ENV === 'production' && !isStrongSecret(encryptionKey)) {
    throw new Error('ENCRYPTION_KEY must be set to a strong random value in production');
  }
}
