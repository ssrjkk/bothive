export const TOKEN_COOKIE = 'bothive_token';

export function parseCookieHeader(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (key) out[key] = value;
  }
  return out;
}

function isSecure(): boolean {
  return process.env.NODE_ENV === 'production' || process.env.COOKIE_SECURE === 'true';
}

export function buildTokenCookie(token: string, maxAgeSeconds = 86400): string {
  const parts = [
    TOKEN_COOKIE + '=' + token,
    'HttpOnly',
    'Path=/',
    'SameSite=Lax',
    'Max-Age=' + maxAgeSeconds,
  ];
  if (isSecure()) parts.push('Secure');
  return parts.join('; ');
}

export function clearTokenCookie(): string {
  const parts = [TOKEN_COOKIE + '=', 'HttpOnly', 'Path=/', 'SameSite=Lax', 'Max-Age=0'];
  if (isSecure()) parts.push('Secure');
  return parts.join('; ');
}
