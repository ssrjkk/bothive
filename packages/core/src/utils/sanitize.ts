/**
 * Replaces control characters (C0 range \u0000-\u001f and DEL \u007f) with a
 * single space. Used before persisting user-provided text so raw control bytes
 * never end up in logs, errors, or Prometheus labels.
 */
export function stripControlChars(value: string): string {
  let result = '';
  for (const ch of value) {
    const code = ch.charCodeAt(0);
    result += code < 0x20 || code === 0x7f ? ' ' : ch;
  }
  return result;
}
